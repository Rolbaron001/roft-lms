import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { assessments, organisations, users } from "@/db/schema";
import {
  SupportError,
  learnerSupport,
  recordAdditionalDateOutcome,
  recordMissedAssessment,
  recordSupportNeed,
  recordSupportReview,
} from "@/lib/support";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let coordinator: AuthenticatedSession;
let assessor: AuthenticatedSession;
let learnerId: string;
let assessmentId: string;

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
  };
}

beforeAll(async () => {
  const slug = `support-${Date.now()}`;

  const made = await withPlatformScope("support test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Support Test Co",
        status: "active",
      })
      .returning({ id: organisations.id });

    const person = async (first: string, last: string) => {
      const [row] = await tx
        .insert(users)
        .values({
          organisationId: organisation.id,
          email: `${first.toLowerCase()}.${slug}@example.test`,
          firstName: first,
          lastName: last,
          status: "active",
        })
        .returning({ id: users.id });
      return row.id;
    };

    const [assessment] = await tx
      .insert(assessments)
      .values({
        organisationId: organisation.id,
        title: "Summative 1",
      })
      .returning({ id: assessments.id });

    return {
      organisationId: organisation.id,
      coordinatorId: await person("Coordinator", "One"),
      assessorId: await person("Assessor", "Two"),
      learnerId: await person("Learner", "Three"),
      assessmentId: assessment.id,
    };
  });

  organisationId = made.organisationId;
  learnerId = made.learnerId;
  assessmentId = made.assessmentId;
  coordinator = sessionFor(["tenant_admin"], made.coordinatorId);
  assessor = sessionFor(["assessor"], made.assessorId);
});

describe("recording a support need", () => {
  it("refuses without the learner's consent", async () => {
    await expect(
      recordSupportNeed(coordinator, {
        learnerId,
        category: "psychological",
        accommodation: "A quiet room during assessments.",
        need: "Diagnosed anxiety disorder.",
        learnerConsented: false,
      }),
    ).rejects.toThrow(SupportError);
  });

  it("refuses an accommodation that says nothing", async () => {
    await expect(
      recordSupportNeed(coordinator, {
        learnerId,
        category: "mobility",
        accommodation: "n/a",
        learnerConsented: true,
      }),
    ).rejects.toThrow();
  });
});

/**
 * The confidentiality split, tested through the query rather than through the
 * permission table. This is the thing that would actually leak.
 */
describe("who sees what", () => {
  beforeAll(async () => {
    await recordSupportNeed(coordinator, {
      learnerId,
      category: "psychological",
      accommodation: "Allow a break every 40 minutes.",
      need: "Diagnosed anxiety disorder; panic attacks under time pressure.",
      learnerConsented: true,
    });
  });

  it("gives the coordinator both halves", async () => {
    const [record] = await learnerSupport(coordinator, learnerId);
    expect(record.accommodation).toContain("break every 40 minutes");
    expect(record.need).toContain("anxiety");
    expect(record.detailWithheld).toBe(false);
  });

  /**
   * The assessor has to allow the breaks and must not learn why. If this ever
   * returns the diagnosis, the platform has committed the breach on the
   * provider's behalf.
   */
  it("gives the assessor the accommodation and never the reason", async () => {
    const [record] = await learnerSupport(assessor, learnerId);
    expect(record.accommodation).toContain("break every 40 minutes");
    expect(record.need).toBeNull();
  });

  /**
   * Told that something is being withheld, rather than shown nothing. A
   * facilitator who cannot tell "nothing more to know" from "not mine to see"
   * has no reason to go and ask, which is sometimes what they should do.
   */
  it("tells the assessor that detail exists without disclosing it", async () => {
    const [record] = await learnerSupport(assessor, learnerId);
    expect(record.detailWithheld).toBe(true);
  });
});

describe("the one additional date", () => {
  it("sets the first one", async () => {
    const created = await recordMissedAssessment(coordinator, {
      learnerId,
      assessmentId,
      missedOn: "2026-03-10",
      additionalDate: "2026-03-24",
    });
    expect(created.outcome).toBe("additional_date_set");
  });

  /**
   * The rule the table exists for. Nobody grants a fourth date deliberately;
   * they grant a second one twice, months apart, because the first was
   * arranged in a conversation nobody wrote down.
   */
  it("refuses a second, and says what was already granted", async () => {
    await expect(
      recordMissedAssessment(coordinator, {
        learnerId,
        assessmentId,
        missedOn: "2026-04-01",
        additionalDate: "2026-04-14",
      }),
    ).rejects.toThrow(/already set/i);
  });

  it("refuses an additional date before the one that was missed", async () => {
    await expect(
      recordMissedAssessment(coordinator, {
        learnerId,
        assessmentId: assessmentId,
        missedOn: "2026-05-10",
        additionalDate: "2026-05-01",
      }),
    ).rejects.toThrow();
  });
});

describe("what became of the additional date", () => {
  let recordId: string;

  beforeAll(async () => {
    const made = await withPlatformScope("second miss fixture", async (tx) => {
      const [assessment] = await tx
        .insert(assessments)
        .values({ organisationId, title: "Summative 2" })
        .returning({ id: assessments.id });
      return assessment.id;
    });

    const created = await recordMissedAssessment(coordinator, {
      learnerId,
      assessmentId: made,
      missedOn: "2026-06-10",
      additionalDate: "2026-06-24",
    });
    recordId = created.id;
  });

  /**
   * "Missed it again" is otherwise an unlimited supply of further chances
   * wearing a different name, so the oral route is gated on the ground the
   * procedure actually names.
   */
  it("refuses an oral assessment without a medical ground", async () => {
    await expect(
      recordAdditionalDateOutcome(coordinator, {
        missedAssessmentId: recordId,
        outcome: "oral_authorised",
        medical: false,
      }),
    ).rejects.toThrow(/medical/i);
  });

  it("refuses a medical authorisation with no reason recorded", async () => {
    await expect(
      recordAdditionalDateOutcome(coordinator, {
        missedAssessmentId: recordId,
        outcome: "oral_authorised",
        medical: true,
      }),
    ).rejects.toThrow();
  });

  it("authorises the oral route on a recorded medical ground", async () => {
    const updated = await recordAdditionalDateOutcome(coordinator, {
      missedAssessmentId: recordId,
      outcome: "oral_authorised",
      medical: true,
      note: "Admitted to hospital; discharge letter on file.",
    });
    expect(updated.outcome).toBe("oral_authorised");
    expect(updated.secondMissMedical).toBe(true);
  });

  it("allows a forfeit with no medical ground at all", async () => {
    const made = await withPlatformScope("forfeit fixture", async (tx) => {
      const [assessment] = await tx
        .insert(assessments)
        .values({ organisationId, title: "Summative 3" })
        .returning({ id: assessments.id });
      return assessment.id;
    });

    const created = await recordMissedAssessment(coordinator, {
      learnerId,
      assessmentId: made,
      missedOn: "2026-07-10",
      additionalDate: "2026-07-24",
    });

    const updated = await recordAdditionalDateOutcome(coordinator, {
      missedAssessmentId: created.id,
      outcome: "forfeited",
    });
    expect(updated.outcome).toBe("forfeited");
  });
});

describe("reviewing a support plan", () => {
  let needId: string;

  beforeAll(async () => {
    const created = await recordSupportNeed(coordinator, {
      learnerId,
      category: "economic",
      accommodation: "Transport allowance arranged with the employer.",
      learnerConsented: true,
      reviewDue: "2026-05-01",
    });
    needId = created.id;
  });

  /**
   * A review that records a failure and adjusts nothing reads as diligence and
   * is the opposite of it.
   */
  it("refuses to record a failure with nothing changed", async () => {
    await expect(
      recordSupportReview(coordinator, {
        supportNeedId: needId,
        reviewedOn: "2026-05-01",
        working: false,
        note: "The learner is still missing sessions.",
      }),
    ).rejects.toThrow(/changing/i);
  });

  it("accepts a failure with an adjustment against it", async () => {
    const review = await recordSupportReview(coordinator, {
      supportNeedId: needId,
      reviewedOn: "2026-05-01",
      working: false,
      note: "The learner is still missing sessions.",
      adjustment: "Moved to the morning cohort and confirmed the taxi route.",
    });
    expect(review.working).toBe(false);
    expect(review.adjustment).toContain("morning cohort");
  });

  it("accepts a review that found it working, with no adjustment", async () => {
    const review = await recordSupportReview(coordinator, {
      supportNeedId: needId,
      reviewedOn: "2026-06-01",
      working: true,
      note: "Attendance is now full.",
    });
    expect(review.working).toBe(true);
  });
});

describe("cleanup", () => {
  it("removes the fixture organisation", async () => {
    await withPlatformScope("support test teardown", (tx) =>
      tx.delete(organisations).where(eq(organisations.id, organisationId)),
    );
    expect(true).toBe(true);
  });
});
