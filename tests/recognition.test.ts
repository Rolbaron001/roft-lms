import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import {
  curriculumModules,
  organisations,
  qualifications,
  users,
} from "@/db/schema";
import {
  RecognitionError,
  exemptionWouldExceed,
  learnerExemptions,
  moderateRplJudgement,
  openRplApplication,
  recordAdvisory,
  recordCreditTransfer,
  recordRplJudgement,
} from "@/lib/recognition";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

// ---------------------------------------------------------------------------
// The limit, as pure arithmetic
// ---------------------------------------------------------------------------

describe("exemptionWouldExceed", () => {
  const modules = [
    { moduleId: "a", credits: 10 },
    { moduleId: "b", credits: 10 },
    { moduleId: "c", credits: 10 },
    { moduleId: "d", credits: 10 },
  ];

  it("allows exemptions up to the limit", () => {
    const result = exemptionWouldExceed({
      moduleCredits: modules,
      alreadyExempt: ["a"],
      proposed: "b",
      maxPercent: 50,
    });
    expect(result.wouldBePercent).toBe(50);
    expect(result.exceeds).toBe(false);
  });

  it("refuses the one that crosses it", () => {
    const result = exemptionWouldExceed({
      moduleCredits: modules,
      alreadyExempt: ["a", "b"],
      proposed: "c",
      maxPercent: 50,
    });
    expect(result.wouldBePercent).toBe(75);
    expect(result.exceeds).toBe(true);
  });

  /**
   * By credits, not by module count. A learner exempted from every small
   * module has not been exempted from half the qualification, and counting
   * modules would say they had.
   */
  it("counts credits rather than modules", () => {
    const uneven = [
      { moduleId: "big", credits: 80 },
      { moduleId: "small1", credits: 5 },
      { moduleId: "small2", credits: 5 },
      { moduleId: "small3", credits: 10 },
    ];

    // Three of four modules, but only 20 per cent of the qualification.
    const result = exemptionWouldExceed({
      moduleCredits: uneven,
      alreadyExempt: ["small1", "small2"],
      proposed: "small3",
      maxPercent: 50,
    });
    expect(result.wouldBePercent).toBe(20);
    expect(result.exceeds).toBe(false);
  });

  /**
   * A qualification captured without credits must not silently have no limit.
   * Counting a missing credit as zero would make every exemption free.
   */
  it("does not let a missing credit value remove the limit", () => {
    const uncaptured = [
      { moduleId: "a", credits: null },
      { moduleId: "b", credits: null },
      { moduleId: "c", credits: null },
    ];

    const result = exemptionWouldExceed({
      moduleCredits: uncaptured,
      alreadyExempt: ["a"],
      proposed: "b",
      maxPercent: 50,
    });
    expect(result.wouldBePercent).toBe(67);
    expect(result.exceeds).toBe(true);
  });

  it("honours a qualification with a different limit", () => {
    const result = exemptionWouldExceed({
      moduleCredits: modules,
      alreadyExempt: ["a", "b"],
      proposed: "c",
      maxPercent: 75,
    });
    expect(result.exceeds).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Against the database
// ---------------------------------------------------------------------------

let organisationId: string;
let coordinator: AuthenticatedSession;
let assessor: AuthenticatedSession;
let moderator: AuthenticatedSession;
let learnerId: string;
let qualificationId: string;
let modules: string[] = [];

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "test@example.test",
    firstName: "Test",
    lastName: "User",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

beforeAll(async () => {
  const slug = `rpl-${Date.now()}`;

  const made = await withPlatformScope("rpl test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "RPL Test Co",
        status: "active",
      })
      .returning({ id: organisations.id });

    const [qualification] = await tx
      .insert(qualifications)
      .values({
        organisationId: organisation.id,
        title: "Test Qualification",
        maxExemptPercent: 50,
      })
      .returning({ id: qualifications.id });

    const made: string[] = [];
    for (const code of ["KM-01", "KM-02", "KM-03", "KM-04"]) {
      const [row] = await tx
        .insert(curriculumModules)
        .values({
          organisationId: organisation.id,
          qualificationId: qualification.id,
          component: "knowledge",
          code,
          title: `Module ${code}`,
          credits: 10,
        })
        .returning({ id: curriculumModules.id });
      made.push(row.id);
    }

    const person = async (first: string) => {
      const [row] = await tx
        .insert(users)
        .values({
          organisationId: organisation.id,
          email: `${first.toLowerCase()}.${slug}@example.test`,
          firstName: first,
          lastName: "Person",
          status: "active",
        })
        .returning({ id: users.id });
      return row.id;
    };

    return {
      organisationId: organisation.id,
      qualificationId: qualification.id,
      modules: made,
      coordinatorId: await person("Coordinator"),
      assessorId: await person("Assessor"),
      moderatorId: await person("Moderator"),
      learnerId: await person("Learner"),
    };
  });

  organisationId = made.organisationId;
  qualificationId = made.qualificationId;
  modules = made.modules;
  learnerId = made.learnerId;
  coordinator = sessionFor(["tenant_admin"], made.coordinatorId);
  assessor = sessionFor(["assessor"], made.assessorId);
  moderator = sessionFor(["moderator"], made.moderatorId);
});

describe("the advisory session", () => {
  let applicationId: string;

  beforeAll(async () => {
    const application = await openRplApplication(coordinator, {
      learnerId,
      qualificationId,
      appliedOn: "2026-03-01",
    });
    applicationId = application.id;
  });

  /**
   * The step candidates are failed by when it is skipped: somebody assembles a
   * folder of certificates nobody told them were the wrong kind of evidence.
   */
  it("refuses a judgement before the candidate has been advised", async () => {
    await expect(
      recordRplJudgement(assessor, {
        applicationId,
        curriculumModuleId: modules[0],
        competent: true,
        rationale:
          "Fifteen years in the role and a detailed portfolio covering every criterion in the module.",
        judgedOn: "2026-03-15",
      }),
    ).rejects.toThrow(/advisory session/);
  });

  it("refuses advice recorded as a formality", async () => {
    await expect(
      recordAdvisory(coordinator, {
        applicationId,
        advisedOn: "2026-03-05",
        adviceGiven: "Advised on requirements.",
      }),
    ).rejects.toThrow();
  });

  it("accepts advice that says what was asked for", async () => {
    const updated = await recordAdvisory(coordinator, {
      applicationId,
      advisedOn: "2026-03-05",
      adviceGiven:
        "Explained that testimonials alone are not evidence. Asked for dated work samples per criterion, a signed employer statement of duties, and the two industry certificates.",
    });
    expect(updated.status).toBe("advised");
  });

  it("then allows the judgement", async () => {
    const judgement = await recordRplJudgement(assessor, {
      applicationId,
      curriculumModuleId: modules[0],
      competent: true,
      rationale:
        "Dated work samples cover every criterion, corroborated by the employer statement and the two certificates.",
      judgedOn: "2026-03-15",
    });
    expect(judgement.competent).toBe(true);
  });

  /**
   * The judgement grants nothing. An unmoderated RPL judgement that already
   * exempted a module would leave the moderator unwinding something rather
   * than deciding it.
   */
  it("grants no exemption until it is moderated", async () => {
    const exempt = await learnerExemptions(coordinator, learnerId);
    expect(exempt).toHaveLength(0);
  });

  it("refuses an assessor moderating their own judgement", async () => {
    const [judgement] = await withPlatformScope("find judgement", async (tx) => {
      const { rplJudgements } = await import("@/db/schema");
      return tx
        .select()
        .from(rplJudgements)
        .where(eq(rplJudgements.applicationId, applicationId));
    });

    await expect(
      moderateRplJudgement(sessionFor(["moderator"], assessor.userId), {
        judgementId: judgement.id,
        agreed: true,
        comment: "Looks fine to me.",
        grantedOn: "2026-03-20",
      }),
    ).rejects.toThrow(/your own/i);
  });

  it("grants the exemption once a moderator agrees", async () => {
    const [judgement] = await withPlatformScope("find judgement", async (tx) => {
      const { rplJudgements } = await import("@/db/schema");
      return tx
        .select()
        .from(rplJudgements)
        .where(eq(rplJudgements.applicationId, applicationId));
    });

    await moderateRplJudgement(moderator, {
      judgementId: judgement.id,
      agreed: true,
      comment:
        "Reviewed the portfolio against the criteria. The evidence supports the judgement.",
      grantedOn: "2026-03-20",
    });

    const exempt = await learnerExemptions(coordinator, learnerId);
    expect(exempt).toHaveLength(1);
    expect(exempt[0].source).toBe("rpl");
  });
});

describe("credit transfer", () => {
  it("refuses a transfer with no mapping", async () => {
    await expect(
      recordCreditTransfer(coordinator, {
        learnerId,
        curriculumModuleId: modules[1],
        sourceQualification: "National Certificate in Business Administration",
        mapping: "Same thing.",
        approvedOn: "2026-03-21",
      }),
    ).rejects.toThrow();
  });

  it("records one with a mapping and grants the exemption", async () => {
    await recordCreditTransfer(coordinator, {
      learnerId,
      curriculumModuleId: modules[1],
      sourceQualification: "National Certificate in Business Administration",
      sourceSaqaId: "12345",
      mapping:
        "Unit standards 8648 and 110023 of the source qualification cover every internal assessment criterion in this module, at the same NQF level.",
      approvedOn: "2026-03-21",
    });

    const exempt = await learnerExemptions(coordinator, learnerId);
    expect(exempt).toHaveLength(2);
    expect(exempt.map((row) => row.source).sort()).toEqual(["cat", "rpl"]);
  });

  /**
   * The limit, enforced at the point an exemption comes into existence rather
   * than checked at the end - by the end the learner has been told they are
   * exempt.
   */
  it("refuses the exemption that would cross the limit", async () => {
    await expect(
      recordCreditTransfer(coordinator, {
        learnerId,
        curriculumModuleId: modules[2],
        sourceQualification: "Another National Certificate",
        mapping:
          "The outcomes of the source qualification are argued to cover this module's criteria in full.",
        approvedOn: "2026-03-22",
      }),
    ).rejects.toThrow(/limit on this qualification is 50/);
  });

  /**
   * A refused transfer must leave nothing behind. Otherwise the record shows a
   * credit transfer that granted no exemption, which reads as an error nobody
   * can explain.
   */
  it("leaves no transfer behind when the limit refuses it", async () => {
    const rows = await withPlatformScope("count transfers", async (tx) => {
      const { creditTransfers } = await import("@/db/schema");
      return tx
        .select()
        .from(creditTransfers)
        .where(eq(creditTransfers.learnerId, learnerId));
    });
    expect(rows).toHaveLength(1);
  });

  it("refuses exempting a module twice", async () => {
    await expect(
      recordCreditTransfer(coordinator, {
        learnerId,
        curriculumModuleId: modules[1],
        sourceQualification: "A third certificate",
        mapping:
          "Argued again against the same module, which has already been recognised on other grounds.",
        approvedOn: "2026-03-23",
      }),
    ).rejects.toThrow(RecognitionError);
  });
});

describe("cleanup", () => {
  it("removes the fixture organisation", async () => {
    await withPlatformScope("rpl test teardown", (tx) =>
      tx.delete(organisations).where(eq(organisations.id, organisationId)),
    );
    expect(true).toBe(true);
  });
});
