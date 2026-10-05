/**
 * What a learner can reach on a study unit's page (5 October 2026): the
 * theory guide and the library's material, each only once the cohort has
 * released it, and never another learner's or another unit's.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { withPlatformScope, withTenant } from "@/db/client";
import { courses, enrolments, organisations, qualifications, studyUnits, userRoles, users } from "@/db/schema";
import { createCourse } from "@/lib/authoring";
import { addStep } from "@/lib/spine";
import { addMember, createCohort, setStepReleased } from "@/lib/cohorts";
import { uploadProgrammeDocument } from "@/lib/programme-documents";
import { linkLibraryItem, uploadLibraryItem } from "@/lib/library";
import { learnerMaterial, readLearnerDocument, readLearnerLibraryItem } from "@/lib/learner-unit";
import { stepsForLearner } from "@/lib/spine";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let learner: AuthenticatedSession;
let other: AuthenticatedSession;

const session = (roles: Role[], userId: string): AuthenticatedSession => ({
  sessionId: "00000000-0000-0000-0000-000000000000",
  userId,
  organisationId,
  email: "x@unit.test",
  firstName: "T",
  lastName: "U",
  roles,
  permissions: permissionsFor({ roles }),
  mustChangePassword: false,
  aiOn: false,
});

const wordFile = (text: string) =>
  zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(`<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`),
  });
// The smallest PNG there is: one transparent pixel.
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));

let enrolmentId: string;
let otherEnrolmentId: string;
let guideId: string;
let guideStepId: string;
let itemId: string;
let cohortId: string;

beforeAll(async () => {
  const slug = `unit-${Date.now()}`;
  const made = await withPlatformScope("learner unit fixture", async (tx) => {
    const [org] = await tx.insert(organisations).values({ slug, legalName: `${slug} Ltd`, displayName: "Unit Co", status: "active" }).returning({ id: organisations.id });
    const person = async (email: string, role: Role) => {
      const [user] = await tx.insert(users).values({ organisationId: org.id, email, firstName: "P", lastName: "Q", status: "active" }).returning({ id: users.id });
      await tx.insert(userRoles).values({ organisationId: org.id, userId: user.id, role });
      return user.id;
    };
    return { org: org.id, admin: await person(`a@${slug}.test`, "tenant_admin"), learner: await person(`l@${slug}.test`, "learner"), other: await person(`o@${slug}.test`, "learner") };
  });
  organisationId = made.org;
  admin = session(["tenant_admin"], made.admin);
  learner = session(["learner"], made.learner);
  other = session(["learner"], made.other);

  const course = await createCourse(admin, { title: "SU1" });
  const unitId = await withTenant(organisationId, async (tx) => {
    const [qualification] = await tx.insert(qualifications).values({ organisationId, title: "Qual" }).returning({ id: qualifications.id });
    const [unit] = await tx.insert(studyUnits).values({ organisationId, qualificationId: qualification.id, code: "SU1", title: "Unit" }).returning({ id: studyUnits.id });
    // Published directly: what is under test is what a learner reaches, not
    // the publishing checks.
    await tx.update(courses).set({ studyUnitId: unit.id, status: "published" }).where(eq(courses.id, course.id));
    return unit.id;
  });
  guideId = (await uploadProgrammeDocument(admin, { kind: "theory_guide", title: "Guide", studyUnitId: unitId }, { filename: "guide.docx", bytes: wordFile("The guide.") })).id;
  guideStepId = (await addStep(admin, { courseId: course.id, kind: "document", programmeDocumentId: guideId, release: "open" })).id;
  itemId = (await uploadLibraryItem(admin, { title: "Diagram" }, { filename: "diagram.png", bytes: png })).id;
  await linkLibraryItem(admin, itemId, unitId, null);

  cohortId = (await createCohort(admin, { courseId: course.id, name: "Intake", startDate: "2026-01-05" })).id;
  await addMember(admin, cohortId, learner.userId);
  await addMember(admin, cohortId, other.userId);
  const rows = await withTenant(organisationId, (tx) => tx.select({ id: enrolments.id, userId: enrolments.userId }).from(enrolments).where(eq(enrolments.courseId, course.id)));
  enrolmentId = rows.find((row) => row.userId === learner.userId)!.id;
  otherEnrolmentId = rows.find((row) => row.userId === other.userId)!.id;
}, 120_000);

afterAll(async () => {
  await withPlatformScope("learner unit teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

describe("a study unit's guide and material", () => {
  it("are refused until the cohort releases them", async () => {
    await expect(readLearnerDocument(learner, enrolmentId, guideId)).rejects.toThrow(/not open yet/);
    await expect(readLearnerLibraryItem(learner, enrolmentId, itemId)).rejects.toThrow(/not open yet/);
    const steps = await stepsForLearner(learner, (await withTenant(organisationId, (tx) => tx.select({ courseId: enrolments.courseId }).from(enrolments).where(eq(enrolments.id, enrolmentId))))[0].courseId!, learner.userId);
    const material = await learnerMaterial(learner, (await withTenant(organisationId, (tx) => tx.select({ id: studyUnits.id }).from(studyUnits)))[0].id, steps);
    expect(material[0].open).toBe(false);
  });

  it("open once released, to the learner whose enrolment it is", async () => {
    await setStepReleased(admin, cohortId, guideStepId, true);
    const guide = await readLearnerDocument(learner, enrolmentId, guideId);
    expect(guide.filename).toBe("guide.docx");
    const item = await readLearnerLibraryItem(learner, enrolmentId, itemId);
    expect(item.mimeType).toBe("image/png");
  });

  it("never through somebody else's enrolment", async () => {
    await expect(readLearnerDocument(learner, otherEnrolmentId, guideId)).rejects.toThrow(/someone else/);
    await expect(readLearnerLibraryItem(learner, otherEnrolmentId, itemId)).rejects.toThrow(/someone else/);
  });
});
