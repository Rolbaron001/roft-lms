/**
 * Capturing a workbook the platform already holds.
 *
 * Roland, 21 September: "I don't see why this is a separate process. The
 * workbooks and assessments are in the folder, they have been read and linked.
 * Why can't they just be captured?"
 *
 * The documents in this fixture are named exactly as Curiosa name theirs -
 * `CA 121151 SU1 WB1.docx` beside `CA 121151 SU1 WB1 AG.docx` - because the
 * pairing is the part that fails silently. A workbook captured without its
 * answer guide produces a paper with no correct answers and no marks, which
 * looks like a successful capture on every screen and is useless.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { zipSync, strToU8 } from "fflate";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  assessments,
  courses,
  organisations,
  studyUnits,
  userRoles,
  users,
} from "@/db/schema";
import {
  assessmentForPaper,
  capturableDocuments,
  captureFiledDocument,
  captureProgress,
  courseForStudyUnit,
} from "@/lib/capture-from-documents";
import {
  readProgrammeDocument,
  readProgrammeDocumentForAuthoring,
  uploadProgrammeDocument,
} from "@/lib/programme-documents";
import {
  addAssessmentCriterion,
  addCurriculumModule,
  createQualification,
} from "@/lib/authoring";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let qualificationId: string;

/** A real .docx: a zip with the one part the reader looks at. */
function wordFile(text: string): Uint8Array {
  const paragraphs = text
    .split(/\n/)
    .map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`)
    .join("");

  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(
      `<?xml version="1.0"?><w:document><w:body>${paragraphs}</w:body></w:document>`,
    ),
  });
}

beforeAll(async () => {
  const slug = `capfiled-${Date.now()}`;

  const made = await withPlatformScope("capture fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Capture Provider",
        status: "active",
      })
      .returning({ id: organisations.id });

    const [person] = await tx
      .insert(users)
      .values({
        organisationId: organisation.id,
        email: `admin@${slug}.test`,
        firstName: "Cap",
        lastName: "Ture",
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
  admin = {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId: made.userId,
    organisationId,
    email: "admin@capfiled.test",
    firstName: "Cap",
    lastName: "Ture",
    roles: ["tenant_admin"] as Role[],
    permissions: permissionsFor({ roles: ["tenant_admin"] as Role[] }),
    mustChangePassword: false,
    aiOn: false,
  };

  const qualification = await createQualification(admin, {
    title: "HRM Officer",
  });
  qualificationId = qualification.id;

  const knowledgeModule = await addCurriculumModule(admin, {
    qualificationId,
    component: "knowledge",
    code: "KM01",
    title: "A module",
  });

  /*
   * A criterion, and the three documents a qualification is built from.
   *
   * Not decoration: `proposeCapture` refuses a qualification that is not ready
   * for material, on the stated grounds that questions captured before the
   * curriculum exists evidence nothing and are found at an audit. Leaving them
   * out made this fixture fail exactly the way it should have, which is how
   * the gate proved itself.
   */
  await addAssessmentCriterion(admin, {
    curriculumModuleId: knowledgeModule.id,
    code: "KM01-IAC1",
    description: "The learner explains the thing.",
  });

  for (const kind of [
    "qualification_document",
    "curriculum_document",
    "assessment_specification",
  ]) {
    await uploadProgrammeDocument(
      admin,
      { kind: kind as never, title: kind, qualificationId },
      {
        filename: `${kind}.docx`,
        bytes: wordFile(`The ${kind}.`),
      },
    );
  }

  const [unit] = await withTenant(organisationId, (tx) =>
    tx
      .insert(studyUnits)
      .values({
        organisationId,
        qualificationId,
        code: "SU1",
        title: "Organisational Architecture",
      })
      .returning({ id: studyUnits.id }),
  );

  // Filed the way a folder import files them: under their kind, against their
  // study unit, with the provider's own filenames.
  const filed: [string, string][] = [
    ["CA 121151 SU1 WB1.docx", "workbook"],
    ["CA 121151 SU1 WB1 AG.docx", "workbook_memorandum"],
    ["CA 121151 SU1 WB2.docx", "workbook"],
    // WB2's guide is deliberately absent.
    ["CA 121151 SU1 SA1 V1.docx", "summative_assessment"],
    ["CA 121151 SU1 SA1 V1 AG.docx", "summative_memorandum"],
  ];

  for (const [filename, kind] of filed) {
    await uploadProgrammeDocument(
      admin,
      {
        kind: kind as never,
        title: filename.replace(/\.docx$/, ""),
        studyUnitId: unit.id,
      },
      { filename, bytes: wordFile(`Question 1\nA paper called ${filename}.`) },
    );
  }
}, 180_000);

afterAll(async () => {
  await withPlatformScope("capture teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("what can be captured without uploading anything again", () => {
  it("offers the papers, not the memoranda", async () => {
    const found = await capturableDocuments(admin, qualificationId);

    // Three papers: two workbooks and a summative. The two answer guides are
    // not papers - offering them would invite somebody to capture the answers
    // as though they were the questions.
    expect(found.map((one) => one.filename).sort()).toEqual([
      "CA 121151 SU1 SA1 V1.docx",
      "CA 121151 SU1 WB1.docx",
      "CA 121151 SU1 WB2.docx",
    ]);
  });

  it("finds each paper's answer guide by the naming convention", async () => {
    const found = await capturableDocuments(admin, qualificationId);
    const wb1 = found.find((one) => one.filename === "CA 121151 SU1 WB1.docx");
    const sa1 = found.find((one) => one.filename === "CA 121151 SU1 SA1 V1.docx");

    expect(wb1?.guide?.filename).toBe("CA 121151 SU1 WB1 AG.docx");
    expect(sa1?.guide?.filename).toBe("CA 121151 SU1 SA1 V1 AG.docx");
  });

  it("does not pair a workbook with another workbook's guide", async () => {
    /*
     * The failure that would be invisible. WB2 has no guide filed, and the
     * wrong answer is to hand it WB1's - a paper marked against another
     * paper's memorandum is confidently and silently wrong.
     */
    const found = await capturableDocuments(admin, qualificationId);
    const wb2 = found.find((one) => one.filename === "CA 121151 SU1 WB2.docx");

    expect(wb2?.guide).toBeNull();
  });

  it("does not pair a workbook with a summative's guide", async () => {
    const found = await capturableDocuments(admin, qualificationId);
    for (const paper of found) {
      if (!paper.guide) continue;
      const wantsSummative = paper.kind === "summative_assessment";
      expect(paper.guide.filename.includes("SA")).toBe(wantsSummative);
    }
  });

  it("knows the study unit each paper belongs to", async () => {
    const found = await capturableDocuments(admin, qualificationId);
    expect(found.every((one) => one.studyUnitCode === "SU1")).toBe(true);
  });

  it("reports how far the qualification has got", async () => {
    const progress = await captureProgress(admin, qualificationId);

    expect(progress.total).toBe(3);
    expect(progress.captured).toBe(0);
    // And which ones will produce a paper with no answers in it, so somebody
    // can file the guide before capturing rather than after.
    expect(progress.withoutGuide).toBe(1);
  });
});

/**
 * Who may read a summative in order to build an assessment from it.
 *
 * Found by pressing the button. Capturing a summative from the qualification
 * page was refused with "Marking memoranda and summative assessments are
 * limited to assessors" - for the tenant administrator who had just filed it.
 *
 * That rule is right for a *download*: a facilitator must not be able to pull
 * the summative out of the library, and a learner with a guessed address
 * certainly must not. It is about distribution.
 *
 * Capture is not distribution. Its permission is `assessment:author`, and the
 * review screen it produces shows the correct answers, because those are what
 * is being confirmed. Insisting on `assessment:assess` would have meant only
 * an assessor could author an assessment - backwards from the assessor role's
 * own definition, which is that they mark evidence and "cannot author the
 * assessment they mark".
 */
describe("reading a restricted paper in order to author from it", () => {
  function sessionWith(permissions: string[]): AuthenticatedSession {
    return { ...admin, permissions: permissions as never };
  }

  it("is refused to a plain download, as it always was", async () => {
    const [summative] = (await capturableDocuments(admin, qualificationId))
      .filter((one) => one.kind === "summative_assessment");

    const facilitator = sessionWith(["course:read", "assessment:author"]);

    await expect(
      readProgrammeDocument(facilitator, summative.documentId),
    ).rejects.toThrow(/limited to assessors/i);
  });

  it("is allowed to somebody authoring an assessment", async () => {
    const [summative] = (await capturableDocuments(admin, qualificationId))
      .filter((one) => one.kind === "summative_assessment");

    const author = sessionWith(["course:read", "assessment:author"]);
    const read = await readProgrammeDocumentForAuthoring(
      author,
      summative.documentId,
    );

    expect(read.filename).toBe("CA 121151 SU1 SA1 V1.docx");
  });

  it("is still refused to somebody who cannot author", async () => {
    // The widening is to `assessment:author` and to nothing else. A learner or
    // a facilitator without it is exactly where they were.
    const [summative] = (await capturableDocuments(admin, qualificationId))
      .filter((one) => one.kind === "summative_assessment");

    const reader = sessionWith(["course:read"]);

    await expect(
      readProgrammeDocumentForAuthoring(reader, summative.documentId),
    ).rejects.toThrow();
  });

  it("captures the paper it was refused, end to end", async () => {
    const [summative] = (await capturableDocuments(admin, qualificationId))
      .filter((one) => one.kind === "summative_assessment");

    const { jobId } = await captureFiledDocument(admin, {
      qualificationId,
      documentId: summative.documentId,
    });

    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);

    // And it is not offered a second time, because the digest matches.
    const after = await capturableDocuments(admin, qualificationId);
    expect(
      after.find((one) => one.documentId === summative.documentId)?.captured,
    ).toBe(true);
  }, 120_000);
});

/**
 * Somewhere for a captured paper to land.
 *
 * A capture commits into a draft assessment, an assessment belongs to a
 * course, and a folder import creates study units and no courses. So the
 * review screen offered an empty list and the work stopped one step from the
 * end: the paper read, the questions checked, and nowhere to put them.
 *
 * It is also what blocks Heidi walking a qualification as a learner, which is
 * item 3.1 on the job sheet. A learner is put onto a course.
 */
describe("the course a study unit is delivered by", () => {
  it("is created once and found thereafter", async () => {
    /*
     * The failure worth guarding. Capturing four workbooks from one study unit
     * must not leave four courses with the same name and the material split
     * between them, which looks tidy in a list and is unusable.
     */
    const [unit] = await withTenant(organisationId, (tx) =>
      tx
        .select({ id: studyUnits.id })
        .from(studyUnits)
        .where(eq(studyUnits.qualificationId, qualificationId)),
    );

    const first = await courseForStudyUnit(admin, unit.id);
    const second = await courseForStudyUnit(admin, unit.id);
    const third = await courseForStudyUnit(admin, unit.id);

    expect(second).toBe(first);
    expect(third).toBe(first);

    const made = await withTenant(organisationId, (tx) =>
      tx
        .select({ id: courses.id, title: courses.title })
        .from(courses)
        .where(eq(courses.studyUnitId, unit.id)),
    );
    expect(made).toHaveLength(1);
  });

  it("is named after the study unit, not after the paper", async () => {
    // Somebody reading a list of these is looking for SU1. A course called
    // "Workbook 2" says nothing about where it belongs.
    const [unit] = await withTenant(organisationId, (tx) =>
      tx
        .select({ id: studyUnits.id })
        .from(studyUnits)
        .where(eq(studyUnits.qualificationId, qualificationId)),
    );

    const courseId = await courseForStudyUnit(admin, unit.id);
    const [course] = await withTenant(organisationId, (tx) =>
      tx.select({ title: courses.title }).from(courses).where(eq(courses.id, courseId)),
    );

    expect(course.title).toContain("SU1");
    expect(course.title).toContain("Organisational Architecture");
  });
});

describe("the assessment a paper commits into", () => {
  async function courseId() {
    const [unit] = await withTenant(organisationId, (tx) =>
      tx
        .select({ id: studyUnits.id })
        .from(studyUnits)
        .where(eq(studyUnits.qualificationId, qualificationId)),
    );
    return courseForStudyUnit(admin, unit.id);
  }

  it("is made once per paper, not once per capture", async () => {
    const course = await courseId();

    const first = await assessmentForPaper(admin, {
      courseId: course,
      title: "CA 121151 SU1 WB1",
      kind: "workbook",
    });
    const again = await assessmentForPaper(admin, {
      courseId: course,
      title: "CA 121151 SU1 WB1",
      kind: "workbook",
    });

    expect(again).toBe(first);
  });

  it("marks a summative as one, which decides how it is moderated", async () => {
    /*
     * Not a label. A summative is moderated in full and a formative is
     * sampled, so getting this wrong silences the moderation a qualification
     * depends on, quietly, on every paper captured that way.
     */
    const course = await courseId();

    const summative = await assessmentForPaper(admin, {
      courseId: course,
      title: "CA 121151 SU1 SA1 V1",
      kind: "summative_assessment",
    });
    const workbook = await assessmentForPaper(admin, {
      courseId: course,
      title: "CA 121151 SU1 WB2",
      kind: "workbook",
    });

    const rows = await withTenant(organisationId, (tx) =>
      tx
        .select({
          id: assessments.id,
          purpose: assessments.purpose,
          status: assessments.status,
        })
        .from(assessments)
        .where(eq(assessments.courseId, course)),
    );

    expect(rows.find((r) => r.id === summative)?.purpose).toBe("summative");
    expect(rows.find((r) => r.id === workbook)?.purpose).toBe("formative");

    // Draft, always. An assessment that published itself the moment a workbook
    // was read would put an unreviewed paper in front of a learner.
    for (const row of rows) expect(row.status).toBe("draft");
  });

  it("is handed back by a capture, so the review screen can preselect it", async () => {
    const paper = (await capturableDocuments(admin, qualificationId)).find(
      (one) => one.kind === "workbook" && one.guide && !one.captured,
    );

    if (!paper) return; // every workbook already captured by an earlier test

    const result = await captureFiledDocument(admin, {
      qualificationId,
      documentId: paper.documentId,
    });

    expect(result.assessmentId).toMatch(/^[0-9a-f-]{36}$/);
  }, 120_000);
});
