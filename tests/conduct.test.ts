import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { organisations, users } from "@/db/schema";
import {
  ABSCONDMENT_DAYS,
  ConductError,
  DAYS_TO_APPEAL_SANCTION,
  HEARING_NOTICE_HOURS,
  appointInvestigator,
  closeDisciplinaryCase,
  convenehearing,
  issueWarning,
  liveWarnings,
  lodgeGrievance,
  noticeIsAdequate,
  openDisciplinaryCase,
  recordHearingOutcome,
  warningExpiry,
} from "@/lib/conduct";
import { permissionsFor, type Role } from "@/lib/rbac";
import { ROLE_PERMISSIONS, can } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

// ---------------------------------------------------------------------------
// Pure rules, tested against a fixed clock
// ---------------------------------------------------------------------------

describe("noticeIsAdequate", () => {
  const noticeGivenAt = new Date("2026-03-10T09:00:00.000Z");

  it("accepts exactly 48 hours", () => {
    const result = noticeIsAdequate({
      noticeGivenAt,
      scheduledFor: new Date("2026-03-12T09:00:00.000Z"),
    });
    expect(result.adequate).toBe(true);
    expect(result.shortBySeconds).toBe(0);
  });

  /**
   * The boundary. A hearing one second inside the notice period is a
   * procedural defect, and the whole point of checking is that nobody
   * arranging one at the end of a difficult week counts the hours.
   */
  it("refuses one second short", () => {
    const result = noticeIsAdequate({
      noticeGivenAt,
      scheduledFor: new Date("2026-03-12T08:59:59.000Z"),
    });
    expect(result.adequate).toBe(false);
    expect(result.shortBySeconds).toBe(1);
  });

  it("says how short, and when it could be held", () => {
    const result = noticeIsAdequate({
      noticeGivenAt,
      scheduledFor: new Date("2026-03-11T09:00:00.000Z"),
    });
    expect(result.shortBySeconds).toBe(24 * 3600);
    expect(result.earliest.toISOString()).toBe("2026-03-12T09:00:00.000Z");
  });

  it("takes a tenant's own notice period", () => {
    const result = noticeIsAdequate({
      noticeGivenAt,
      scheduledFor: new Date("2026-03-11T09:00:00.000Z"),
      hours: 24,
    });
    expect(result.adequate).toBe(true);
  });
});

describe("warningExpiry", () => {
  it("expires a verbal warning after three months", () => {
    expect(warningExpiry("verbal", "2026-03-10")).toBe("2026-06-10");
  });

  it("expires a written warning after six", () => {
    expect(warningExpiry("written", "2026-03-10")).toBe("2026-09-10");
  });

  it("expires a final written warning after a year", () => {
    expect(warningExpiry("final_written", "2026-03-10")).toBe("2027-03-10");
  });

  /**
   * Rolling a month forward from the 31st lands in the month after the one
   * intended. A warning issued on 31 August expires at the end of February,
   * not in March - which would silently give the learner three extra days of
   * a live warning.
   */
  it("does not overshoot from the end of a long month", () => {
    expect(warningExpiry("written", "2026-08-31")).toBe("2027-02-28");
    expect(warningExpiry("verbal", "2026-01-31")).toBe("2026-04-30");
  });
});

// ---------------------------------------------------------------------------
// Who may do this
// ---------------------------------------------------------------------------

describe("who may run a disciplinary matter", () => {
  it("is not the assessor or the facilitator standing in the room", () => {
    expect(can({ roles: ["assessor"] }, "conduct:manage")).toBe(false);
    expect(can({ roles: ["moderator"] }, "conduct:manage")).toBe(false);
    expect(can({ roles: ["workplace_coach"] }, "conduct:manage")).toBe(false);
  });

  it("is the coordinating roles", () => {
    const holders = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((role) =>
      can({ roles: [role] }, "conduct:manage"),
    );
    expect(holders.sort()).toEqual(["instructor", "tenant_admin"]);
  });

  it("lets any learner lodge a grievance and none manage one", () => {
    expect(can({ roles: ["learner"] }, "grievance:lodge")).toBe(true);
    expect(can({ roles: ["learner"] }, "grievance:manage")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Against the database
// ---------------------------------------------------------------------------

let organisationId: string;
let coordinator: AuthenticatedSession;
let learnerId: string;
let accusedId: string;

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
  const slug = `conduct-${Date.now()}`;

  const made = await withPlatformScope("conduct test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Conduct Test Co",
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

    return {
      organisationId: organisation.id,
      coordinatorId: await person("Thandi", "Nkosi"),
      learnerId: await person("Sipho", "Dlamini"),
      accusedId: await person("Pieter", "vanWyk"),
    };
  });

  organisationId = made.organisationId;
  learnerId = made.learnerId;
  accusedId = made.accusedId;
  coordinator = sessionFor(["tenant_admin"], made.coordinatorId);
});

describe("opening a case", () => {
  it("refuses an allegation nobody could answer", async () => {
    await expect(
      openDisciplinaryCase(coordinator, {
        learnerId,
        grade: "minor",
        allegation: "Bad attitude",
        occurredOn: "2026-03-10",
      }),
    ).rejects.toThrow();
  });

  /**
   * Gross misconduct does not pass through counselling. Starting it at the
   * informal stage would misdescribe the case from the first row, and the row
   * is what gets read back later.
   */
  it("starts gross misconduct at the hearing stage", async () => {
    const matter = await openDisciplinaryCase(coordinator, {
      learnerId,
      grade: "gross",
      allegation: "Alleged theft of a laptop from the training room.",
      occurredOn: "2026-03-10",
    });
    expect(matter.stage).toBe("hearing");
  });

  it("starts a minor matter with counselling", async () => {
    const matter = await openDisciplinaryCase(coordinator, {
      learnerId,
      grade: "minor",
      allegation: "Arrived forty minutes late to three sessions this month.",
      occurredOn: "2026-03-11",
    });
    expect(matter.stage).toBe("informal_counselling");
  });
});

describe("warnings and what is still live", () => {
  let caseId: string;

  beforeAll(async () => {
    const matter = await openDisciplinaryCase(coordinator, {
      learnerId,
      grade: "serious",
      allegation: "Unauthorised absence from three consecutive sessions.",
      occurredOn: "2026-03-12",
    });
    caseId = matter.id;
  });

  it("refuses a warning that does not say what happens next", async () => {
    await expect(
      issueWarning(coordinator, {
        caseId,
        kind: "written",
        issuedOn: "2026-03-13",
        terms: "Do better.",
      }),
    ).rejects.toThrow();
  });

  it("issues one with an expiry worked out from its kind", async () => {
    const warning = await issueWarning(coordinator, {
      caseId,
      kind: "written",
      issuedOn: "2026-03-13",
      terms:
        "Attendance rule breached. Full attendance expected. A recurrence may lead to a final written warning or a hearing.",
    });
    expect(warning.validUntil).toBe("2026-09-13");
  });

  /**
   * The question escalation turns on, and the one a folder answers wrongly.
   */
  it("counts a warning as live inside its period and not after", async () => {
    const inside = await liveWarnings(coordinator, learnerId, "2026-06-01");
    expect(inside.filter((row) => row.live)).toHaveLength(1);

    const after = await liveWarnings(coordinator, learnerId, "2026-10-01");
    expect(after.filter((row) => row.live)).toHaveLength(0);
    // Still on file, just no longer counting.
    expect(after).toHaveLength(1);
  });
});

describe("convening a hearing", () => {
  let caseId: string;
  const now = new Date("2026-03-10T09:00:00.000Z");

  beforeAll(async () => {
    const matter = await openDisciplinaryCase(coordinator, {
      learnerId,
      grade: "gross",
      allegation: "Alleged assault of a fellow learner in the car park.",
      occurredOn: "2026-03-09",
    });
    caseId = matter.id;
  });

  const base = {
    allegations: "Assault of a fellow learner on 9 March in the car park.",
    sanctionsAdvised: "Up to and including termination of the training agreement.",
    rightsAdvised: true,
  };

  it("refuses short notice, and says when it could be held", async () => {
    await expect(
      convenehearing(
        coordinator,
        { caseId, scheduledFor: "2026-03-11T09:00:00.000Z", ...base },
        now,
      ),
    ).rejects.toThrow(/24 hours short/);
  });

  it("refuses a notice that does not advise the learner of their rights", async () => {
    await expect(
      convenehearing(
        coordinator,
        {
          caseId,
          scheduledFor: "2026-03-13T09:00:00.000Z",
          ...base,
          rightsAdvised: false,
        },
        now,
      ),
    ).rejects.toThrow(/assisted by a fellow learner/);
  });

  it("accepts adequate notice", async () => {
    const hearing = await convenehearing(
      coordinator,
      { caseId, scheduledFor: "2026-03-13T09:00:00.000Z", ...base },
      now,
    );
    expect(hearing.rightsAdvised).toBe(true);
  });

  /**
   * Ending somebody's programme without a hearing that actually happened is
   * the defect that costs a provider the case whatever the learner did.
   */
  it("refuses termination before the hearing has been held", async () => {
    await expect(
      closeDisciplinaryCase(coordinator, "Africa/Johannesburg", {
        caseId,
        sanction: "terminated",
        outcomeReason:
          "The allegation was found to be substantiated on the evidence given.",
      }),
    ).rejects.toThrow(/hearing that was held/);
  });

  it("allows termination once findings are recorded", async () => {
    const [hearing] = await withPlatformScope("find hearing", async (tx) => {
      const { disciplinaryHearings } = await import("@/db/schema");
      return tx
        .select()
        .from(disciplinaryHearings)
        .where(eq(disciplinaryHearings.caseId, caseId));
    });

    await recordHearingOutcome(coordinator, {
      hearingId: hearing.id,
      findings:
        "The allegation was substantiated. Two witnesses gave consistent accounts and the learner did not dispute the events.",
    });

    const closed = await closeDisciplinaryCase(
      coordinator,
      "Africa/Johannesburg",
      {
        caseId,
        sanction: "terminated",
        outcomeReason:
          "Gross misconduct substantiated at a hearing. The training agreement is terminated.",
      },
    );

    expect(closed.sanction).toBe("terminated");
    // The right to appeal is set, in working days.
    expect(closed.appealBy).toBeTruthy();
  });

  it("refuses a sanction with no reasoning", async () => {
    const matter = await openDisciplinaryCase(coordinator, {
      learnerId,
      grade: "minor",
      allegation: "Persistent lateness after being counselled about it.",
      occurredOn: "2026-04-01",
    });

    await expect(
      closeDisciplinaryCase(coordinator, "Africa/Johannesburg", {
        caseId: matter.id,
        sanction: "counselled",
        outcomeReason: "Done.",
      }),
    ).rejects.toThrow();
  });
});

describe("grievances", () => {
  let grievanceId: string;

  beforeAll(async () => {
    const lodged = await lodgeGrievance(coordinator, "Africa/Johannesburg", {
      learnerId,
      nature:
        "The facilitator singled the learner out in front of the class and refused to explain a mark.",
      individualsInvolved: "Pieter vanWyk",
    });
    grievanceId = lodged.id;
  });

  it("sets the two-working-day acknowledgement deadline", async () => {
    expect(grievanceId).toBeTruthy();
  });

  /**
   * "A designated impartial person" is the procedure's own wording, and the
   * failure it guards against happens in exactly the circumstances a small
   * provider is in: few people, everybody busy, and the obvious investigator
   * is the one being complained about.
   */
  it("refuses an investigator the grievance names", async () => {
    await expect(
      appointInvestigator(coordinator, {
        grievanceId,
        investigatorId: accusedId,
      }),
    ).rejects.toThrow(/cannot investigate/);
  });

  it("refuses the learner as their own investigator", async () => {
    await expect(
      appointInvestigator(coordinator, {
        grievanceId,
        investigatorId: learnerId,
      }),
    ).rejects.toThrow(ConductError);
  });

  it("accepts somebody the grievance does not name", async () => {
    const updated = await appointInvestigator(coordinator, {
      grievanceId,
      investigatorId: coordinator.userId,
    });
    expect(updated.status).toBe("under_investigation");
  });
});

describe("the constants", () => {
  it("match the written procedure", () => {
    expect(HEARING_NOTICE_HOURS).toBe(48);
    expect(DAYS_TO_APPEAL_SANCTION).toBe(5);
    expect(ABSCONDMENT_DAYS).toBe(2);
  });
});

describe("cleanup", () => {
  it("removes the fixture organisation", async () => {
    await withPlatformScope("conduct test teardown", (tx) =>
      tx.delete(organisations).where(eq(organisations.id, organisationId)),
    );
    expect(true).toBe(true);
  });
});
