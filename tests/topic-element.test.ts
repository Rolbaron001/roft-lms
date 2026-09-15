/**
 * Opening one line of a curriculum.
 *
 * Roland, 15 September: "Under curriculum in qualifications there is a long
 * list of Topic Elements, which is great, but none of them can be accessed. So
 * as a user, how do I view these items?"
 *
 * What the screen has to answer is not "what does this line say" - that was
 * always on the page - but "is anything teaching it, and is anything testing
 * it". So that is what is asserted here, including the two ways it can be
 * answered badly: a coverage claim shown as a document that is not held, and a
 * line of one qualification read from another's address.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import {
  assessmentCriteria,
  curriculumModules,
  curriculumTopicElements,
  curriculumTopics,
  organisations,
  programmeDocuments,
  qualifications,
  topicElementAlignment,
  userRoles,
  users,
} from "@/db/schema";
import { TopicElementError, topicElementDetail } from "@/lib/topic-element";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let staff: AuthenticatedSession;
let learner: AuthenticatedSession;
let qualificationId: string;
let otherQualificationId: string;
let elementId: string;
let uncoveredId: string;

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "someone@example.test",
    firstName: "Element",
    lastName: "Reader",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

beforeAll(async () => {
  const slug = `element-${Date.now()}`;

  const made = await withPlatformScope("element fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Element Test Provider",
        status: "active",
      })
      .returning({ id: organisations.id });

    const orgId = organisation.id;

    const people: Record<string, string> = {};
    for (const key of ["staff", "learner"]) {
      const [person] = await tx
        .insert(users)
        .values({
          organisationId: orgId,
          email: `${key}@element.test`,
          firstName: "Element",
          lastName: key,
          status: "active",
        })
        .returning({ id: users.id });
      await tx.insert(userRoles).values({
        organisationId: orgId,
        userId: person.id,
        role: key === "staff" ? "tenant_admin" : "learner",
      });
      people[key] = person.id;
    }

    const [qualification] = await tx
      .insert(qualifications)
      .values({
        organisationId: orgId,
        title: "Occupational Certificate: Something",
        kind: "full",
        saqaId: "999001",
      })
      .returning({ id: qualifications.id });

    const [other] = await tx
      .insert(qualifications)
      .values({
        organisationId: orgId,
        title: "A different qualification entirely",
        kind: "full",
        saqaId: "999002",
      })
      .returning({ id: qualifications.id });

    const [curriculumModule] = await tx
      .insert(curriculumModules)
      .values({
        organisationId: orgId,
        qualificationId: qualification.id,
        component: "knowledge",
        code: "KM01",
        title: "A knowledge module",
        credits: 8,
      })
      .returning({ id: curriculumModules.id });

    const [topic] = await tx
      .insert(curriculumTopics)
      .values({
        organisationId: orgId,
        curriculumModuleId: curriculumModule.id,
        code: "KT0101",
        title: "A topic",
      })
      .returning({ id: curriculumTopics.id });

    const [covered] = await tx
      .insert(curriculumTopicElements)
      .values({
        organisationId: orgId,
        topicId: topic.id,
        kind: "knowledge_topic",
        code: "KT010101",
        description: "Definitions of different organisations.",
        sortOrder: 1,
      })
      .returning({ id: curriculumTopicElements.id });

    const [uncovered] = await tx
      .insert(curriculumTopicElements)
      .values({
        organisationId: orgId,
        topicId: topic.id,
        kind: "knowledge_topic",
        code: "KT010102",
        description: "Principles of management and leadership.",
        sortOrder: 2,
      })
      .returning({ id: curriculumTopicElements.id });

    await tx.insert(assessmentCriteria).values({
      organisationId: orgId,
      curriculumModuleId: curriculumModule.id,
      topicId: topic.id,
      code: "KM01-IAC1",
      description: "Discuss the definitions of different organisations.",
    });

    // One document held here, under the name the matrix uses for it.
    await tx.insert(programmeDocuments).values({
      organisationId: orgId,
      qualificationId: qualification.id,
      kind: "theory_guide",
      title: "SU1 Theory Guide",
      filename: "SU1 Theory Guide.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 2048,
      sha256: "0".repeat(64),
      storageKey: `test/${Date.now()}`,
      uploadedById: people.staff,
    });

    // Two claims against the covered element: one the provider holds, and one
    // they only planned.
    await tx.insert(topicElementAlignment).values([
      {
        organisationId: orgId,
        topicElementId: covered.id,
        kind: "theory_guide",
        reference: "SU1 Theory Guide, chapter 1",
      },
      {
        organisationId: orgId,
        topicElementId: covered.id,
        kind: "legislation",
        reference: "BCEA s.29",
      },
    ]);

    return {
      orgId,
      people,
      qualification: qualification.id,
      other: other.id,
      covered: covered.id,
      uncovered: uncovered.id,
    };
  });

  organisationId = made.orgId;
  staff = sessionFor(["tenant_admin"], made.people.staff);
  learner = sessionFor(["learner"], made.people.learner);
  qualificationId = made.qualification;
  otherQualificationId = made.other;
  elementId = made.covered;
  uncoveredId = made.uncovered;
});

afterAll(async () => {
  await withPlatformScope("element teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("opening a curriculum line", () => {
  it("says where it sits, so the page can be read without the one before it", async () => {
    const detail = await topicElementDetail(staff, qualificationId, elementId);

    expect(detail.element.code).toBe("KT010101");
    expect(detail.topic.code).toBe("KT0101");
    expect(detail.module.code).toBe("KM01");
    expect(detail.qualification.id).toBe(qualificationId);
  });

  it("resolves a matrix reference to the document it names", async () => {
    const detail = await topicElementDetail(staff, qualificationId, elementId);

    const guide = detail.coverage.find((c) => c.kind === "theory_guide");
    // "SU1 Theory Guide, chapter 1" names a document called "SU1 Theory
    // Guide". The chapter is where to look inside it, not part of its name.
    expect(guide?.document?.title).toBe("SU1 Theory Guide");
  });

  /**
   * The failure that would matter most. A legislation reference is a citation,
   * not a file the provider uploaded, and showing it as a document would have
   * somebody tick a coverage check against nothing.
   */
  it("leaves a reference that names nothing held as a reference", async () => {
    const detail = await topicElementDetail(staff, qualificationId, elementId);

    const act = detail.coverage.find((c) => c.kind === "legislation");
    expect(act?.reference).toBe("BCEA s.29");
    expect(act?.document).toBeNull();
  });

  it("shows what assesses the topic the line belongs to", async () => {
    const detail = await topicElementDetail(staff, qualificationId, elementId);

    expect(detail.criteria).toHaveLength(1);
    expect(detail.criteria[0].code).toBe("KM01-IAC1");
  });

  it("reports nothing covering a line rather than inventing something", async () => {
    const detail = await topicElementDetail(staff, qualificationId, uncoveredId);

    expect(detail.coverage).toEqual([]);
  });

  it("carries the rest of the topic, so the list can be walked", async () => {
    const detail = await topicElementDetail(staff, qualificationId, elementId);

    expect(detail.siblings.map((one) => one.code)).toEqual([
      "KT010101",
      "KT010102",
    ]);
  });
});

describe("who may open one, and from where", () => {
  /**
   * A published curriculum is the QCTO's. A facilitator seeing what a module
   * requires is the ordinary case, not a privilege.
   */
  it("is open to anybody who may read a course", async () => {
    const detail = await topicElementDetail(learner, qualificationId, elementId);
    expect(detail.element.code).toBe("KT010101");
  });

  it("refuses a line read from a qualification it does not belong to", async () => {
    await expect(
      topicElementDetail(staff, otherQualificationId, elementId),
    ).rejects.toThrow(TopicElementError);
  });
});
