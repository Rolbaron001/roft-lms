/**
 * Work Integrated Learning, against a live database.
 *
 * The workplace sign-off is the part of an occupational qualification the provider does
 * not witness. Everything an external verifier probes about it is here: that
 * the coach is not the learner, that the order learner → coach → assessor
 * cannot be jumped, and that "supporting evidence" means a file rather than a
 * ticked box.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  curriculumModules,
  organisations,
  userRoles,
  users,
  workplaceAgreements,
  workplaceLogbookEntries,
} from "@/db/schema";
import { importCurriculum } from "@/lib/curriculum-import";
import {
  acceptLogbook,
  coachSignOff,
  createAgreement,
  getLogbook,
  openLogbook,
  outstandingOf,
  setEntryCompleted,
  submitToCoach,
  WorkplaceError,
} from "@/lib/workplace";
import { uploadLogbookEvidence } from "@/lib/uploads";
import { PermissionDeniedError, permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let learner: AuthenticatedSession;
let coach: AuthenticatedSession;
let assessor: AuthenticatedSession;

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

async function createPerson(email: string, roles: Role[]) {
  return withPlatformScope("workplace test fixture", async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        organisationId,
        email,
        firstName: email.split("@")[0],
        lastName: "Tester",
        status: "active",
      })
      .returning({ id: users.id });

    for (const role of roles) {
      await tx
        .insert(userRoles)
        .values({ organisationId, userId: user.id, role });
    }

    return user.id;
  });
}

function suffix() {
  return Math.random().toString(36).slice(2, 8);
}

/** A qualification with one work experience module shaped like a real one. */
async function workExperienceModule() {
  const code = `wpl-${suffix()}`;
  const imported = await importCurriculum(admin, {
    title: `Workplace Qualification ${code}`,
    qctoCode: code,
    modules: [
      {
        component: "workplace",
        code: `${code}-WM-01`,
        title: "HRM Data Collection Processes",
        credits: 8,
        topics: [
          {
            code: "WE0101",
            title: "Use appropriate information technology to collect HRM data",
            elements: [
              {
                kind: "work_activity",
                code: "WA0101",
                description: "Receive coaching on the organisation's HRM systems.",
              },
              {
                kind: "contextual_knowledge",
                code: "WK01",
                description: "Site specific policies.",
              },
              {
                kind: "supporting_evidence",
                code: "SE01",
                description: "Performance reports.",
              },
            ],
            criteria: [
              { code: "IAC0101", description: "Evidence of the work performed." },
            ],
          },
        ],
      },
    ],
  });

  return imported;
}

beforeAll(async () => {
  const slug = `wpl-${Date.now()}`;

  organisationId = await withPlatformScope("workplace test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Workplace Test Co",
        status: "active",
      })
      .returning({ id: organisations.id });
    return organisation.id;
  });

  admin = sessionFor(
    ["tenant_admin"],
    await createPerson("admin@wpl.test", ["tenant_admin"]),
  );
  learner = sessionFor(
    ["learner"],
    await createPerson("learner@wpl.test", ["learner"]),
  );
  coach = sessionFor(
    ["workplace_coach"],
    await createPerson("coach@wpl.test", ["workplace_coach"]),
  );
  assessor = sessionFor(
    ["assessor"],
    await createPerson("assessor@wpl.test", ["assessor"]),
  );
});

afterAll(async () => {
  await withPlatformScope("workplace test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

/** Builds an agreement and an open logbook for the shared learner. */
async function freshLogbook() {
  const imported = await workExperienceModule();

  const moduleId = await withTenant(organisationId, async (tx) => {
    const rows = await tx
      .select({ id: curriculumModules.id })
      .from(curriculumModules)
      .where(eq(curriculumModules.qualificationId, imported.qualificationId));
    return rows[0].id;
  });

  const agreement = await createAgreement(admin, {
    learnerId: learner.userId,
    coachId: coach.userId,
    employerName: "Acme Mining Services",
    coachDesignation: "HR Manager",
  });

  const logbook = await openLogbook(admin, agreement.id, moduleId);
  const view = await getLogbook(learner, logbook.id);

  return { agreement, logbook, entries: view.entries };
}

describe("the workplace agreement", () => {
  it("refuses to make somebody their own coach", async () => {
    await expect(
      createAgreement(admin, {
        learnerId: learner.userId,
        coachId: learner.userId,
        employerName: "Acme",
      }),
    ).rejects.toBeInstanceOf(WorkplaceError);
  });

  it("is refused at the database even if the check above were bypassed", async () => {
    // The application check is convenience; this is the guarantee. An
    // accreditation reviewer is entitled to ask what stops it, and "the
    // interface doesn't offer the button" is not an answer.
    // Drizzle wraps the driver error, so the trigger's own message is on the
    // cause rather than the message.
    const attempt = withTenant(organisationId, async (tx) => {
      await tx.insert(workplaceAgreements).values({
        organisationId,
        learnerId: learner.userId,
        coachId: learner.userId,
        employerName: "Acme",
        coachName: "Self",
        coachEmail: "self@wpl.test",
      });
    });

    await expect(attempt).rejects.toThrow();
    const error = await attempt.catch((caught: unknown) => caught);
    expect(String((error as { cause?: unknown }).cause)).toMatch(
      /Segregation of duties/,
    );
  });

  it("keeps the coach's name and role as they were at the time", async () => {
    const agreement = await createAgreement(admin, {
      learnerId: learner.userId,
      coachId: coach.userId,
      employerName: "Harbour Freight",
      coachDesignation: "Operations Supervisor",
    });

    expect(agreement.coachName).toContain("coach");
    expect(agreement.coachDesignation).toBe("Operations Supervisor");
    expect(agreement.employerName).toBe("Harbour Freight");
  });
});

describe("the logbook", () => {
  it("is generated from the curriculum, not typed", async () => {
    const { entries } = await freshLogbook();

    expect(entries.map((entry) => entry.code).sort()).toEqual([
      "SE01",
      "WA0101",
      "WK01",
    ]);
  });

  it("refuses to open one for a module that is not work experience", async () => {
    const code = `knw-${suffix()}`;
    const imported = await importCurriculum(admin, {
      title: `Knowledge Only ${code}`,
      qctoCode: code,
      modules: [
        {
          component: "knowledge",
          code: `${code}-KM-01`,
          title: "Knowledge module",
          topics: [
            {
              code: "KM0101",
              title: "A topic",
              elements: [
                { kind: "knowledge_topic", code: "KT0101", description: "Teach." },
              ],
              criteria: [{ code: "IAC0101", description: "Achieve." }],
            },
          ],
        },
      ],
    });

    const moduleId = await withTenant(organisationId, async (tx) => {
      const rows = await tx
        .select({ id: curriculumModules.id })
        .from(curriculumModules)
        .where(eq(curriculumModules.qualificationId, imported.qualificationId));
      return rows[0].id;
    });

    const agreement = await createAgreement(admin, {
      learnerId: learner.userId,
      coachId: coach.userId,
      employerName: "Acme",
    });

    await expect(
      openLogbook(admin, agreement.id, moduleId),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("lets only the learner tick their own lines", async () => {
    const { entries } = await freshLogbook();
    const activity = entries.find((entry) => entry.code === "WA0101")!;

    await expect(
      setEntryCompleted(coach, activity.entryId, true),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("stops the learner changing it once it is with the coach", async () => {
    const { logbook, entries } = await freshLogbook();
    for (const entry of entries) {
      await setEntryCompleted(learner, entry.entryId, true);
    }
    await submitToCoach(learner, logbook.id, 120);

    await expect(
      setEntryCompleted(learner, entries[0].entryId, false),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });
});

describe("what counts as complete", () => {
  it("treats supporting evidence without a file as outstanding", () => {
    // A checklist that can be finished by ticking boxes is not evidence.
    expect(
      outstandingOf([
        { kind: "work_activity", code: "WA0101", completed: true, evidence: [] },
        {
          kind: "supporting_evidence",
          code: "SE01",
          completed: true,
          evidence: [],
        },
      ]),
    ).toEqual(["SE01 (no file attached)"]);
  });

  it("is satisfied once the file is attached", () => {
    expect(
      outstandingOf([
        {
          kind: "supporting_evidence",
          code: "SE01",
          completed: true,
          evidence: [{ id: "a" }],
        },
      ]),
    ).toEqual([]);
  });
});

describe("signing off", () => {
  it("refuses to sign a logbook whose evidence has no file", async () => {
    const { logbook, entries } = await freshLogbook();
    for (const entry of entries) {
      await setEntryCompleted(learner, entry.entryId, true);
    }
    await submitToCoach(learner, logbook.id, 118);

    await expect(
      coachSignOff(coach, logbook.id, { outcome: "signed" }),
    ).rejects.toMatchObject({ code: "incomplete" });
  });

  it("signs once everything is done and evidence is attached", async () => {
    const { logbook, entries } = await freshLogbook();

    for (const entry of entries) {
      await setEntryCompleted(learner, entry.entryId, true);
    }

    const evidenceEntry = entries.find((entry) => entry.code === "SE01")!;
    await uploadLogbookEvidence(learner, evidenceEntry.entryId, [
      { filename: "report.txt", bytes: new TextEncoder().encode("A report.") },
    ]);

    await submitToCoach(learner, logbook.id, 120);
    await coachSignOff(coach, logbook.id, {
      outcome: "signed",
      comments: "Checked and witnessed.",
    });

    const view = await getLogbook(assessor, logbook.id);
    expect(view.logbook.status).toBe("coach_signed");
    expect(view.logbook.coachSignatureHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses a signature from anyone but the named coach", async () => {
    const { logbook, entries } = await freshLogbook();
    for (const entry of entries) {
      await setEntryCompleted(learner, entry.entryId, true);
    }
    await submitToCoach(learner, logbook.id);

    const otherCoach = sessionFor(
      ["workplace_coach"],
      await createPerson(`other-${suffix()}@wpl.test`, ["workplace_coach"]),
    );

    await expect(
      coachSignOff(otherCoach, logbook.id, { outcome: "signed" }),
    ).rejects.toMatchObject({ code: "not_permitted" });
  });

  it("sends it back, and lets the learner work on it again", async () => {
    const { logbook, entries } = await freshLogbook();
    for (const entry of entries) {
      await setEntryCompleted(learner, entry.entryId, true);
    }
    await submitToCoach(learner, logbook.id);

    await coachSignOff(coach, logbook.id, {
      outcome: "returned",
      comments: "The report is from the wrong month.",
    });

    const view = await getLogbook(learner, logbook.id);
    expect(view.logbook.status).toBe("returned_by_coach");
    expect(view.canEdit).toBe(true);
  });
});

describe("reaching the assessor", () => {
  it("refuses a logbook the coach has not signed", async () => {
    const { logbook, entries } = await freshLogbook();
    for (const entry of entries) {
      await setEntryCompleted(learner, entry.entryId, true);
    }
    await submitToCoach(learner, logbook.id);

    // This is the document an external verifier rejects: workplace experience
    // taken on the learner's word alone.
    await expect(acceptLogbook(assessor, logbook.id)).rejects.toMatchObject({
      code: "invalid_state",
    });
  });

  it("accepts one that is signed", async () => {
    const { logbook, entries } = await freshLogbook();
    for (const entry of entries) {
      await setEntryCompleted(learner, entry.entryId, true);
    }
    const evidenceEntry = entries.find((entry) => entry.code === "SE01")!;
    await uploadLogbookEvidence(learner, evidenceEntry.entryId, [
      { filename: "report.txt", bytes: new TextEncoder().encode("A report.") },
    ]);
    await submitToCoach(learner, logbook.id);
    await coachSignOff(coach, logbook.id, { outcome: "signed" });

    await acceptLogbook(assessor, logbook.id);

    const view = await getLogbook(assessor, logbook.id);
    expect(view.logbook.status).toBe("accepted_by_assessor");
    expect(view.logbook.assessorId).toBe(assessor.userId);
  });
});

describe("who can see a logbook", () => {
  it("hides it from a coach who is not on the agreement", async () => {
    const { logbook } = await freshLogbook();

    const otherCoach = sessionFor(
      ["workplace_coach"],
      await createPerson(`nosy-${suffix()}@wpl.test`, ["workplace_coach"]),
    );

    // One employer's supervisor has no business seeing another's people.
    await expect(getLogbook(otherCoach, logbook.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("shows it to the learner it belongs to", async () => {
    const { logbook } = await freshLogbook();
    await expect(getLogbook(learner, logbook.id)).resolves.toBeDefined();
  });
});

describe("the entries table", () => {
  it("has one row per curriculum requirement and no more", async () => {
    const { logbook } = await freshLogbook();

    const count = await withTenant(organisationId, async (tx) => {
      const rows = await tx
        .select({ id: workplaceLogbookEntries.id })
        .from(workplaceLogbookEntries)
        .where(eq(workplaceLogbookEntries.logbookId, logbook.id));
      return rows.length;
    });

    expect(count).toBe(3);
  });
});
