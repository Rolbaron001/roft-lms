/**
 * The Commercial Cleaner, all the way into the database.
 *
 * The parser tests next door assert what the reader makes of the document.
 * This asserts what a provider actually ends up holding, which is a different
 * question and the one that matters: a reading that never reaches a row helps
 * nobody, and the guards the writing path applies - duplicate codes, the shape
 * of a module - can turn away what the reader correctly found.
 *
 * It exists because of how the original fault hid. 118709 imported twenty-two
 * modules and ninety-two topics and not one assessment criterion, and looked
 * like it had worked. The count that would have caught that is the count of
 * rows, so that is what is counted here.
 *
 * Heidi imports this qualification for the first time this month. This is the
 * rehearsal.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  assessmentCriteria,
  curriculumModules,
  curriculumTopicElements,
  curriculumTopics,
  organisations,
  qualifications,
  userRoles,
  users,
} from "@/db/schema";
import {
  createQualificationFromDocuments,
  readQualificationSources,
} from "@/lib/qualification-from-document";
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
    firstName: "Commercial",
    lastName: "Cleaner",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(process.cwd(), "tests/fixtures", name)));
}

beforeAll(async () => {
  const slug = `cleaner-${Date.now()}`;

  const made = await withPlatformScope("commercial cleaner fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Commercial Cleaner Provider",
        status: "active",
      })
      .returning({ id: organisations.id });

    const [person] = await tx
      .insert(users)
      .values({
        organisationId: organisation.id,
        email: "admin@cleaner.test",
        firstName: "Commercial",
        lastName: "Cleaner",
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

  // Exactly what the screen does: read both documents, show what was found,
  // then write it with the header fields the person confirmed. Nothing here
  // goes round the application's own path.
  const documents = {
    qualification: {
      filename: "118709-qualification.pdf",
      bytes: fixture("118709-qualification.pdf"),
    },
    curriculum: {
      filename: "118709-curriculum.pdf",
      bytes: fixture("118709-curriculum.pdf"),
    },
  };

  const reading = await readQualificationSources(admin, documents);
  notes = reading.notes ?? [];

  const created = await createQualificationFromDocuments(admin, documents, {
    // What the confirmation screen would show, accepted as read. Only the
    // header fields are the person's to correct; the curriculum is the
    // document's.
    title: reading.details.title ?? "Commercial Cleaner",
    curriculumCode: reading.details.curriculumCode ?? undefined,
    saqaId: reading.details.saqaId ?? undefined,
    nqfLevel: reading.details.nqfLevel ?? undefined,
    totalCredits: reading.details.totalCredits ?? undefined,
  });
  qualificationId = created.qualificationId;
}, 120_000);

afterAll(async () => {
  await withPlatformScope("commercial cleaner teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

async function stored() {
  return withTenant(organisationId, async (tx) => {
    const modules = await tx
      .select({ id: curriculumModules.id, code: curriculumModules.code })
      .from(curriculumModules)
      .where(eq(curriculumModules.qualificationId, qualificationId));

    const moduleIds = modules.map((one) => one.id);

    const topics = moduleIds.length
      ? await tx
          .select({ id: curriculumTopics.id })
          .from(curriculumTopics)
          .where(inArray(curriculumTopics.curriculumModuleId, moduleIds))
      : [];

    const elements = topics.length
      ? await tx
          .select({ id: curriculumTopicElements.id })
          .from(curriculumTopicElements)
          .where(
            inArray(
              curriculumTopicElements.topicId,
              topics.map((one) => one.id),
            ),
          )
      : [];

    const criteria = moduleIds.length
      ? await tx
          .select({ id: assessmentCriteria.id })
          .from(assessmentCriteria)
          .where(inArray(assessmentCriteria.curriculumModuleId, moduleIds))
      : [];

    return {
      modules: modules.length,
      topics: topics.length,
      elements: elements.length,
      criteria: criteria.length,
    };
  });
}

describe("what a provider is left holding", () => {
  it("creates the qualification itself", async () => {
    const [row] = await withTenant(organisationId, (tx) =>
      tx
        .select({ title: qualifications.title, kind: qualifications.kind })
        .from(qualifications)
        .where(eq(qualifications.id, qualificationId)),
    );

    expect(row.title.toLowerCase()).toContain("commercial cleaner");
  });

  it("writes the whole curriculum, not most of it", async () => {
    const held = await stored();

    expect(held.modules).toBe(22);
    // The number that used to be zero, counted as rows this time.
    expect(held.criteria).toBeGreaterThan(150);
    expect(held.elements).toBeGreaterThan(500);
    expect(held.topics).toBeGreaterThan(80);
  });

  /**
   * The failure this whole file exists for. Every knowledge module having
   * topics but no criteria is what "imports thin" looked like, and it reads on
   * screen as a qualification that worked.
   */
  it("leaves no module with topics but nothing to assess against", async () => {
    const starved = await withTenant(organisationId, async (tx) => {
      const modules = await tx
        .select({ id: curriculumModules.id, code: curriculumModules.code })
        .from(curriculumModules)
        .where(eq(curriculumModules.qualificationId, qualificationId));

      const bad: string[] = [];
      for (const one of modules) {
        const topics = await tx
          .select({ id: curriculumTopics.id })
          .from(curriculumTopics)
          .where(eq(curriculumTopics.curriculumModuleId, one.id));

        const criteria = await tx
          .select({ id: assessmentCriteria.id })
          .from(assessmentCriteria)
          .where(eq(assessmentCriteria.curriculumModuleId, one.id));

        // A work experience module is evidenced by a signed record rather than
        // by criteria, so it is not expected to have any.
        const workplace = one.code.startsWith("WM");
        if (topics.length > 0 && criteria.length === 0 && !workplace) {
          bad.push(one.code);
        }
      }
      return bad;
    });

    expect(starved).toEqual([]);
  });

  it("keeps the page furniture out of what was stored", async () => {
    const polluted = await withTenant(organisationId, async (tx) => {
      const modules = await tx
        .select({ id: curriculumModules.id })
        .from(curriculumModules)
        .where(eq(curriculumModules.qualificationId, qualificationId));

      const rows = await tx
        .select({ description: assessmentCriteria.description })
        .from(assessmentCriteria)
        .where(
          inArray(
            assessmentCriteria.curriculumModuleId,
            modules.map((one) => one.id),
          ),
        );

      return rows
        .map((one) => one.description)
        .filter((text) => /811201-000|\(weight/i.test(text));
    });

    expect(polluted).toEqual([]);
  });
});

describe("what it tells the person importing it", () => {
  /**
   * The document contradicts itself, and Heidi will see these. They are not
   * the platform being unsure - they are faults in the document, and each
   * wants a decision rather than a fix.
   */
  it("still reports the document's own faults", () => {
    const said = notes.join(" ");

    expect(said.length).toBeGreaterThan(0);
    expect(said).toMatch(/more than once|not 100|nothing to teach/i);
  });
});
