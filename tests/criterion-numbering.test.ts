/**
 * Criteria that were being thrown away, and now are not.
 *
 * The HRM Officer curriculum (SAQA 121151) does not number its internal
 * assessment criteria the same way twice. Module PM03 numbers them
 * continuously across the module — IAC0101 under its first topic, IAC0201
 * under its second. Module PM01 restarts at IAC0101 under every topic. Both
 * are unambiguous on the page, because the topic is the context.
 *
 * The platform required a criterion code to be unique within its whole module,
 * so PM01's second topic collided with its first and kept four of its eight
 * criteria. The note blamed the document. It was not the document's fault, and
 * the consequence was not cosmetic: a learner in PM01 would have been assessed
 * against half of what the curriculum requires, and every readiness figure
 * derived from it would have been computed from half.
 *
 * Found on 16 September while chasing "11 of 30 items loaded" in Heidi's
 * notes from the failed test. That number is still unexplained; this is not
 * it, but it is real and it was underneath.
 *
 * Tested through the application's own import path, against the published
 * document, because a count in a parser is not a count of rows.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  assessmentCriteria,
  curriculumModules,
  curriculumTopics,
  organisations,
  userRoles,
  users,
} from "@/db/schema";
import {
  createQualificationFromDocuments,
  readQualificationSources,
} from "@/lib/qualification-from-document";
import { parseCurriculumText } from "@/lib/curriculum-parse";
import { readPdfText } from "@/lib/office";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let qualificationId: string;
let notes: string[] = [];

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "admin@example.test",
    firstName: "HRM",
    lastName: "Officer",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(join(process.cwd(), "tests/fixtures", name)),
  );
}

beforeAll(async () => {
  const slug = `hrm-${Date.now()}`;

  const made = await withPlatformScope("hrm fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "HRM Officer Provider",
        status: "active",
      })
      .returning({ id: organisations.id });

    const [person] = await tx
      .insert(users)
      .values({
        organisationId: organisation.id,
        email: "admin@hrm.test",
        firstName: "HRM",
        lastName: "Admin",
        status: "active",
      })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({
      organisationId: organisation.id,
      userId: person.id,
      role: "tenant_admin",
    });

    return { orgId: organisation.id, userId: person.id };
  });

  organisationId = made.orgId;
  admin = sessionFor(["tenant_admin"], made.userId);

  const documents = {
    qualification: {
      filename: "121151-qualification.pdf",
      bytes: fixture("121151-qualification.pdf"),
    },
    curriculum: {
      filename: "121151-curriculum.pdf",
      bytes: fixture("121151-curriculum.pdf"),
    },
  };

  const reading = await readQualificationSources(admin, documents);
  notes = reading.notes ?? [];

  const created = await createQualificationFromDocuments(admin, documents, {
    title: reading.details.title ?? "Advanced Occupational Certificate: HRM Officer",
    curriculumCode: reading.details.curriculumCode ?? undefined,
    saqaId: reading.details.saqaId ?? undefined,
    nqfLevel: reading.details.nqfLevel ?? undefined,
    totalCredits: reading.details.totalCredits ?? undefined,
  });
  qualificationId = created.qualificationId;
}, 120_000);

afterAll(async () => {
  await withPlatformScope("hrm teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

async function criteriaByTopic(moduleCode: string) {
  return withTenant(organisationId, async (tx) => {
    const [curriculumModule] = await tx
      .select({ id: curriculumModules.id })
      .from(curriculumModules)
      .where(eq(curriculumModules.code, moduleCode));

    if (!curriculumModule) return new Map<string, string[]>();

    const topics = await tx
      .select({ id: curriculumTopics.id, code: curriculumTopics.code })
      .from(curriculumTopics)
      .where(eq(curriculumTopics.curriculumModuleId, curriculumModule.id));

    const rows = topics.length
      ? await tx
          .select({
            topicId: assessmentCriteria.topicId,
            code: assessmentCriteria.code,
          })
          .from(assessmentCriteria)
          .where(
            inArray(
              assessmentCriteria.topicId,
              topics.map((one) => one.id),
            ),
          )
      : [];

    const byTopic = new Map<string, string[]>();
    for (const topic of topics) {
      byTopic.set(
        topic.code,
        rows.filter((row) => row.topicId === topic.id).map((row) => row.code),
      );
    }
    return byTopic;
  });
}

describe("a module that restarts its numbering under each topic", () => {
  /**
   * PM01 has two topics, and each carries IAC0101 to IAC0104. Eight criteria,
   * four codes. Four of them used to be refused as duplicates.
   */
  it("keeps every criterion, not just the first topic's", async () => {
    const byTopic = await criteriaByTopic("PM01");

    expect([...byTopic.keys()].sort()).toEqual(["PM0101", "PM0102"]);
    expect(byTopic.get("PM0101")?.sort()).toEqual([
      "IAC0101",
      "IAC0102",
      "IAC0103",
      "IAC0104",
    ]);
    expect(byTopic.get("PM0102")?.sort()).toEqual([
      "IAC0101",
      "IAC0102",
      "IAC0103",
      "IAC0104",
    ]);
  });

  it("stops calling that a fault in the document", () => {
    const said = notes.join(" ");
    expect(said).not.toContain("PM01: the document uses criterion IAC0101");
  });
});

describe("a module that numbers continuously across itself", () => {
  /**
   * PM03 does it the other way. Both house styles have to work, and the
   * change that fixed PM01 must not have loosened anything for PM03.
   */
  it("is unaffected", async () => {
    const byTopic = await criteriaByTopic("PM03");

    expect(byTopic.get("PM0301")).toContain("IAC0101");
    expect(byTopic.get("PM0302")).toContain("IAC0201");
  });
});

describe("what is still a genuine duplicate", () => {
  /**
   * Scoping to the topic must not mean anything goes. A code repeated within
   * one topic is still a clash, still refused, and still reported — 121151
   * really does use AK0105 twice under PM0301.
   */
  it("is still reported, within a topic", () => {
    const said = notes.join(" ");
    expect(said).toMatch(/AK0105 more than once/);
  });
});

describe("the curriculum as a whole", () => {
  it("lands in full", async () => {
    const stored = await withTenant(organisationId, async (tx) => {
      const modules = await tx
        .select({ id: curriculumModules.id })
        .from(curriculumModules)
        .where(eq(curriculumModules.qualificationId, qualificationId));

      const criteria = await tx
        .select({ id: assessmentCriteria.id })
        .from(assessmentCriteria)
        .where(
          inArray(
            assessmentCriteria.curriculumModuleId,
            modules.map((one) => one.id),
          ),
        );

      return { modules: modules.length, criteria: criteria.length };
    });

    expect(stored.modules).toBe(15);
    // 150 of the 154 the reader found were stored before the change; all 154
    // were after it. The four are PM01's second topic. 160 since 26 September,
    // when six KM-04 criteria the reader had been dropping were recovered (see
    // curriculum-parse-tolerance.test.ts).
    expect(stored.criteria).toBe(160);
  });

  /**
   * Counted against what the reader found, so the two can never drift apart
   * without this failing. A reading that does not reach a row is the failure
   * this whole file is about.
   */
  it("stores everything the reader found", async () => {
    const read = await readPdfText(fixture("121151-curriculum.pdf"));
    const parsed = parseCurriculumText(read.text);

    /*
     * What should survive: every criterion the reader found, less any code
     * repeated *within the same topic*, which is the only repeat that is still
     * a clash. Computed the same way the importer computes it rather than
     * hard-coded, so this keeps meaning the same thing if the document is
     * revised.
     */
    const expected = parsed.modules.reduce((total, one) => {
      return (
        total +
        one.topics.reduce((sum, topic) => {
          const seen = new Set(topic.criteria.map((c) => c.code));
          return sum + seen.size;
        }, 0)
      );
    }, 0);

    const stored = await withTenant(organisationId, async (tx) => {
      const modules = await tx
        .select({ id: curriculumModules.id })
        .from(curriculumModules)
        .where(eq(curriculumModules.qualificationId, qualificationId));

      return tx
        .select({ id: assessmentCriteria.id })
        .from(assessmentCriteria)
        .where(
          inArray(
            assessmentCriteria.curriculumModuleId,
            modules.map((one) => one.id),
          ),
        );
    });

    expect(stored.length).toBe(expected);
  }, 60_000);
});
