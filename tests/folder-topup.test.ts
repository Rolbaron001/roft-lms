/**
 * Pointing the platform at a fuller folder for a qualification it already has.
 *
 * Roland, 15 September: part of the HRM Officer qualification is already
 * loaded, and he wants to finish it by pointing at the completed folder rather
 * than deleting what is there and starting again.
 *
 * The answer was no until now. `commitPlan` added modules that were missing but
 * skipped any module already present, so a module loaded with three topics
 * stayed at three however complete the folder became. The comment in the code
 * said it "should add what is missing and leave the rest", which is what it now
 * does.
 *
 * Two things this has to get right, and they pull against each other: add
 * everything that is genuinely new, and add nothing twice.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  aiImportJobs,
  assessmentCriteria,
  curriculumModules,
  curriculumTopicElements,
  curriculumTopics,
  organisations,
  qualifications,
  userRoles,
  users,
} from "@/db/schema";
import { commitPlan } from "@/lib/folder-commit";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let qualificationId: string;

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "admin@example.test",
    firstName: "Top",
    lastName: "Up",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

/** A plan naming one module, as the folder reader would produce it. */
function planWith(topics: {
  code: string;
  title: string;
  elements: string[];
  criteria: string[];
}[]) {
  return {
    qualification: null,
    modules: [
      {
        component: "knowledge" as const,
        code: "KM01",
        title: "Creating and Implementing Organisational Architecture",
        credits: 8,
        topics: topics.map((topic) => ({
          code: topic.code,
          title: topic.title,
          elements: topic.elements,
          criteria: topic.criteria,
        })),
      },
    ],
    studyUnits: [],
    documents: [],
    unrecognised: [],
  };
}

/** Puts a plan in front of commitPlan the way the folder reader would. */
async function jobFor(plan: unknown): Promise<string> {
  const [job] = await withPlatformScope("top-up job", (tx) =>
    tx
      .insert(aiImportJobs)
      .values({
        organisationId,
        sourcePath: "/folders/hrm-officer",
        files: [],
        status: "proposed",
        // The table records who asked for the import, as an audit trail should.
        requestedById: admin.userId,
        proposal: plan as never,
      })
      .returning({ id: aiImportJobs.id }),
  );
  return job.id;
}

async function countsFor(moduleCode: string) {
  return withTenant(organisationId, async (tx) => {
    const [module] = await tx
      .select({ id: curriculumModules.id })
      .from(curriculumModules)
      .where(eq(curriculumModules.code, moduleCode));

    if (!module) return { topics: 0, elements: 0, criteria: 0 };

    const topics = await tx
      .select({ id: curriculumTopics.id })
      .from(curriculumTopics)
      .where(eq(curriculumTopics.curriculumModuleId, module.id));

    let elements = 0;
    for (const topic of topics) {
      const rows = await tx
        .select({ id: curriculumTopicElements.id })
        .from(curriculumTopicElements)
        .where(eq(curriculumTopicElements.topicId, topic.id));
      elements += rows.length;
    }

    const criteria = await tx
      .select({ id: assessmentCriteria.id })
      .from(assessmentCriteria)
      .where(eq(assessmentCriteria.curriculumModuleId, module.id));

    return { topics: topics.length, elements, criteria: criteria.length };
  });
}

beforeAll(async () => {
  const slug = `topup-${Date.now()}`;

  const made = await withPlatformScope("top-up fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Top Up Provider",
        status: "active",
      })
      .returning({ id: organisations.id });

    const [person] = await tx
      .insert(users)
      .values({
        organisationId: organisation.id,
        email: "admin@topup.test",
        firstName: "Top",
        lastName: "Up",
        status: "active",
      })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({
      organisationId: organisation.id,
      userId: person.id,
      role: "tenant_admin",
    });

    const [qualification] = await tx
      .insert(qualifications)
      .values({
        organisationId: organisation.id,
        title: "Advanced Occupational Certificate: HRM Officer",
        kind: "full",
        saqaId: "121151",
      })
      .returning({ id: qualifications.id });

    return { orgId: organisation.id, userId: person.id, qual: qualification.id };
  });

  organisationId = made.orgId;
  admin = sessionFor(["tenant_admin"], made.userId);
  qualificationId = made.qual;
});

afterAll(async () => {
  await withPlatformScope("top-up teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("a first, partial load", () => {
  it("creates the module and what the folder had at the time", async () => {
    const job = await jobFor(
      planWith([
        {
          code: "KM0101",
          title: "Fundamentals of Business and Strategic HRM",
          elements: ["Definitions of different organisations."],
          criteria: ["Discuss the definitions of different organisations."],
        },
      ]),
    );

    const report = await commitPlan(admin, { jobId: job, qualificationId });

    expect(report.modules).toBe(1);
    expect(await countsFor("KM01")).toEqual({
      topics: 1,
      elements: 1,
      criteria: 1,
    });
  });
});

describe("pointing at the completed folder afterwards", () => {
  /**
   * The case Roland asked about. The same module, now with a second topic and
   * more inside the first.
   */
  it("adds what is new without touching what was there", async () => {
    const job = await jobFor(
      planWith([
        {
          code: "KM0101",
          title: "Fundamentals of Business and Strategic HRM",
          elements: [
            // Already held - must not be added a second time.
            "Definitions of different organisations.",
            // New.
            "Principles of management and leadership.",
          ],
          criteria: [
            "Discuss the definitions of different organisations.",
            "Provide examples to clarify the fundamental definitions.",
          ],
        },
        {
          code: "KM0102",
          title: "Organisational design",
          elements: ["Basic macro and micro economic principles."],
          criteria: ["Explain the basic macro and micro economic principles."],
        },
      ]),
    );

    const report = await commitPlan(admin, { jobId: job, qualificationId });

    // The module was not created again.
    expect(report.modules).toBe(0);
    expect(report.alreadyHeld.join(" ")).toContain("KM01");
    expect(report.alreadyHeld.join(" ")).toContain("only what was missing");

    // One new topic, two new elements, two new criteria.
    expect(report.topics).toBe(1);
    expect(report.elements).toBe(2);
    expect(report.criteria).toBe(2);

    expect(await countsFor("KM01")).toEqual({
      topics: 2,
      elements: 3,
      criteria: 3,
    });
  });

  /**
   * The failure a top-up must never produce. Running the same folder twice
   * should be a no-op, not a second copy of everything.
   */
  it("changes nothing at all when run a second time", async () => {
    const before = await countsFor("KM01");

    const job = await jobFor(
      planWith([
        {
          code: "KM0101",
          title: "Fundamentals of Business and Strategic HRM",
          elements: [
            "Definitions of different organisations.",
            "Principles of management and leadership.",
          ],
          criteria: [
            "Discuss the definitions of different organisations.",
            "Provide examples to clarify the fundamental definitions.",
          ],
        },
        {
          code: "KM0102",
          title: "Organisational design",
          elements: ["Basic macro and micro economic principles."],
          criteria: ["Explain the basic macro and micro economic principles."],
        },
      ]),
    );

    const report = await commitPlan(admin, { jobId: job, qualificationId });

    expect(report.modules).toBe(0);
    expect(report.topics).toBe(0);
    expect(report.elements).toBe(0);
    expect(report.criteria).toBe(0);
    expect(await countsFor("KM01")).toEqual(before);
  });

  /**
   * Text matching, not code matching. Codes for elements and criteria are
   * generated from position here, so a document that gains a topic renumbers
   * everything after it - and a code match would then re-add the lot.
   */
  it("is not fooled by a renumbering", async () => {
    const before = await countsFor("KM01");

    const job = await jobFor(
      planWith([
        // A brand new topic inserted first, which shifts every number after it.
        {
          code: "KM0100",
          title: "An introduction added later",
          elements: ["What this module is for."],
          criteria: ["Explain what this module is for."],
        },
        {
          code: "KM0101",
          title: "Fundamentals of Business and Strategic HRM",
          elements: [
            "Definitions of different organisations.",
            "Principles of management and leadership.",
          ],
          criteria: [
            "Discuss the definitions of different organisations.",
            "Provide examples to clarify the fundamental definitions.",
          ],
        },
      ]),
    );

    const report = await commitPlan(admin, { jobId: job, qualificationId });

    // Nothing was turned away. A criterion refused as a duplicate code would
    // land here rather than in the counts, and read as "nothing new to add".
    expect(report.refused).toEqual([]);

    // Only the genuinely new topic and its contents.
    expect(report.topics).toBe(1);
    expect(report.elements).toBe(1);
    expect(report.criteria).toBe(1);

    const after = await countsFor("KM01");
    expect(after.elements).toBe(before.elements + 1);
    expect(after.criteria).toBe(before.criteria + 1);
  });
});
