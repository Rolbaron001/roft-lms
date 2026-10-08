import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  assessmentSubmissions,
  attendanceRecords,
  cohortFiles,
  cohortMembers,
  cohortSessions,
  cohorts,
  courseSteps,
  courses,
  enrolmentDocuments,
  evidenceArtifacts,
  feedbackRequests,
  programmeDocuments,
  statutoryNotifications,
  studyUnits,
  users,
  workplaceLogbooks,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { detectMedia } from "./media";
import { cohortCourseIds } from "./schedule";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { buildStorageKey, getObject, putObject } from "./storage";
import type { ArchiveEntry } from "./archive-writer";
import { COHORT_FILE_KINDS, type CohortFileKind } from "./cohort-file-kinds";

/**
 * A cohort's file, organised as the provider's own cohort folder is (job
 * sheet D20). Heidi's example folder of 8 October 2026 ("HRM Administrator
 * Cohort 28012026 - Example") is one folder per cohort, with the same
 * sections every time. Roland: the organisation and the processes in it are
 * to be carried into the platform.
 *
 * Most of what that folder holds the platform already keeps: enrolment
 * documents on each learner, evidence on each submission, registers on each
 * session, logbooks on work experience. The cohort file shows each of those
 * from where it is, with what is missing and a link to where it is worked
 * on, and stores only what had nowhere to go (facilitation plans, the
 * induction pack, attendance exports, assessor reports, feedback forms,
 * monitoring reports and correspondence). It can be downloaded as a zip laid
 * out exactly as the folder is.
 */

export class CohortFileError extends Error {
  constructor(message: string, public readonly code: "not_found" | "invalid") {
    super(message);
    this.name = "CohortFileError";
  }
}

export { COHORT_FILE_KINDS, type CohortFileKind } from "./cohort-file-kinds";

/** The folders, in the order Curiosa's cohort folder lists them. */
export const COHORT_FOLDERS = [
  "qualificationDocs",
  "learningMaterial",
  "leisa",
  "induction",
  "learnerDocs",
  "attendance",
  "facilitationPlans",
  "learnerEvidence",
  "assessorReports",
  "programmeFeedback",
  "wem",
  "monitoring",
] as const;
export type CohortFolder = (typeof COHORT_FOLDERS)[number];

/** Folder names in the downloaded zip, as the example folder names them. */
export const FOLDER_NAME: Record<CohortFolder, string> = {
  qualificationDocs: "Qualification Docs",
  learningMaterial: "Learning Material",
  leisa: "LEISA",
  induction: "Induction",
  learnerDocs: "Learner Docs",
  attendance: "Attendance Records",
  facilitationPlans: "Facilitation Plans",
  learnerEvidence: "Learner Evidence",
  assessorReports: "Assessor Reports",
  programmeFeedback: "Programme Feedback Forms",
  wem: "WEM",
  monitoring: "M&E",
};

/** Which folder a stored cohort file belongs in. */
const FOLDER_OF: Record<CohortFileKind, CohortFolder> = {
  facilitation_plan: "facilitationPlans",
  induction_pack: "induction",
  attendance_export: "attendance",
  assessor_report: "assessorReports",
  programme_feedback: "programmeFeedback",
  monitoring_report: "monitoring",
  correspondence: "monitoring",
  other: "monitoring",
};

const fileInput = z.object({
  cohortId: z.string().uuid(),
  kind: z.enum(COHORT_FILE_KINDS),
  sessionId: z.string().uuid().optional(),
  studyUnitId: z.string().uuid().optional(),
  title: z.string().trim().max(300).optional(),
  filename: z.string().trim().min(1).max(300),
});

export async function fileCohortDocument(
  session: AuthenticatedSession,
  input: z.input<typeof fileInput> & { bytes: Uint8Array },
) {
  assertSessionCan(session, "enrolment:manage");
  const parsed = fileInput.parse(input);
  const detected = detectMedia(input.bytes, parsed.filename);
  if (!detected.ok) throw new CohortFileError(`That file was not accepted: ${detected.reason}`, "invalid");

  return withTenant(session.organisationId, async (tx) => {
    const [cohort] = await tx.select({ id: cohorts.id }).from(cohorts).where(eq(cohorts.id, parsed.cohortId));
    if (!cohort) throw new CohortFileError("No such cohort.", "not_found");
    if (parsed.sessionId) {
      const [held] = await tx
        .select({ id: cohortSessions.id })
        .from(cohortSessions)
        .where(and(eq(cohortSessions.id, parsed.sessionId), eq(cohortSessions.cohortId, parsed.cohortId)));
      if (!held) throw new CohortFileError("That session is not on this cohort.", "invalid");
    }

    const key = buildStorageKey(session.organisationId, `cohort-${parsed.cohortId}`, parsed.filename, "programme");
    const put = await putObject(key, input.bytes, detected.mimeType);
    const [created] = await tx
      .insert(cohortFiles)
      .values({
        organisationId: session.organisationId,
        cohortId: parsed.cohortId,
        sessionId: parsed.sessionId ?? null,
        studyUnitId: parsed.studyUnitId ?? null,
        kind: parsed.kind,
        title: parsed.title || parsed.filename.replace(/\.[^.]+$/, ""),
        storageKey: key,
        filename: parsed.filename,
        mimeType: detected.mimeType,
        sizeBytes: input.bytes.byteLength,
        sha256: put.sha256,
        uploadedById: session.userId,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "cohort_file.filed",
      entityType: "cohort",
      entityId: parsed.cohortId,
      after: { fileId: created.id, kind: parsed.kind, filename: parsed.filename },
    });
    return created;
  });
}

export async function removeCohortFile(session: AuthenticatedSession, fileId: string) {
  assertSessionCan(session, "enrolment:manage");
  await withTenant(session.organisationId, async (tx) => {
    const [file] = await tx.select().from(cohortFiles).where(eq(cohortFiles.id, fileId));
    if (!file) throw new CohortFileError("No such file.", "not_found");
    await tx.delete(cohortFiles).where(eq(cohortFiles.id, fileId));
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "cohort_file.removed",
      entityType: "cohort",
      entityId: file.cohortId,
      before: { fileId, kind: file.kind, filename: file.filename, sha256: file.sha256 },
    });
  });
}

export async function readCohortFile(session: AuthenticatedSession, fileId: string) {
  assertSessionCan(session, "enrolment:read_all");
  const file = await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx.select().from(cohortFiles).where(eq(cohortFiles.id, fileId));
    return row;
  });
  if (!file) throw new CohortFileError("No such file.", "not_found");
  return { file, bytes: await getObject(file.storageKey) };
}

export type FolderItem = {
  label: string;
  href?: string;
  note?: string;
  /** A stored cohort file, which can be removed. */
  fileId?: string;
};

export type FolderView = {
  key: CohortFolder;
  /** How many things it holds. */
  count: number;
  items: FolderItem[];
  /** What it should hold and does not. */
  missing: string[];
};

export type CohortFileView = {
  cohort: { id: string; name: string; qualificationId: string | null };
  folders: FolderView[];
  sessions: { id: string; label: string; kind: string; date: string }[];
  units: { id: string; code: string; title: string }[];
};

const fullName = (row: { firstName: string; lastName: string }) => `${row.firstName} ${row.lastName}`.trim();

/** Everything the cohort's file holds, folder by folder, from where it is held. */
export async function cohortFileView(session: AuthenticatedSession, cohortId: string): Promise<CohortFileView> {
  assertSessionCan(session, "enrolment:read_all");
  return withTenant(session.organisationId, async (tx) => {
    const [cohort] = await tx.select().from(cohorts).where(eq(cohorts.id, cohortId));
    if (!cohort) throw new CohortFileError("No such cohort.", "not_found");
    const courseIds = await cohortCourseIds(tx, cohort);
    const courseRows = courseIds.length
      ? await tx
          .select({ id: courses.id, studyUnitId: courses.studyUnitId, code: studyUnits.code, title: studyUnits.title, qualificationId: studyUnits.qualificationId, sortOrder: studyUnits.sortOrder })
          .from(courses)
          .leftJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
          .where(inArray(courses.id, courseIds))
      : [];
    courseRows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const qualificationId = cohort.qualificationId ?? courseRows.find((row) => row.qualificationId)?.qualificationId ?? null;
    const unitIds = courseRows.map((row) => row.studyUnitId).filter((id): id is string => Boolean(id));
    const base = `/cohorts/${cohortId}`;

    const members = await tx
      .select({ userId: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(cohortMembers)
      .innerJoin(users, eq(users.id, cohortMembers.userId))
      .where(and(eq(cohortMembers.cohortId, cohortId), isNull(cohortMembers.leftAt)))
      .orderBy(asc(users.lastName));
    const memberIds = members.map((member) => member.userId);

    const sessions = await tx.select().from(cohortSessions).where(eq(cohortSessions.cohortId, cohortId)).orderBy(asc(cohortSessions.scheduledDate));
    const files = await tx.select().from(cohortFiles).where(eq(cohortFiles.cohortId, cohortId)).orderBy(asc(cohortFiles.createdAt));
    const fileItems = (folder: CohortFolder): FolderItem[] =>
      files
        .filter((file) => FOLDER_OF[file.kind] === folder)
        .map((file) => ({ label: file.title, href: `/api/cohort-files/${file.id}`, note: file.filename, fileId: file.id }));

    const today = new Date().toISOString().slice(0, 10);
    const sessionLabel = (row: (typeof sessions)[number]) =>
      `${row.scheduledDate}${row.kind === "lecture" && row.sequence ? ` · Lecture ${row.sequence}` : ` · ${row.title ?? row.kind.replace(/_/g, " ")}`}`;

    // Qualification Docs and Learning Material: from the qualification, linked.
    const documents = qualificationId
      ? await tx
          .select({ id: programmeDocuments.id, kind: programmeDocuments.kind, title: programmeDocuments.title, studyUnitId: programmeDocuments.studyUnitId })
          .from(programmeDocuments)
          .where(eq(programmeDocuments.qualificationId, qualificationId))
      : [];
    const unitDocuments = unitIds.length
      ? await tx
          .select({ id: programmeDocuments.id, kind: programmeDocuments.kind, title: programmeDocuments.title, studyUnitId: programmeDocuments.studyUnitId })
          .from(programmeDocuments)
          .where(inArray(programmeDocuments.studyUnitId, unitIds))
      : [];
    const qualificationKinds = ["qualification_document", "curriculum_document", "assessment_specification"];
    const qualificationDocs = documents.filter((doc) => qualificationKinds.includes(doc.kind));
    const guides = [...documents, ...unitDocuments].filter((doc, index, all) => doc.kind === "theory_guide" && all.findIndex((one) => one.id === doc.id) === index);

    // LEISA: the submissions drafted for this cohort.
    const notifications = await tx.select().from(statutoryNotifications).where(eq(statutoryNotifications.cohortId, cohortId));

    // Learner Docs: what each learner has on file.
    const enrolmentDocs = memberIds.length
      ? await tx
          .select({ id: enrolmentDocuments.id, userId: enrolmentDocuments.userId, kind: enrolmentDocuments.kind })
          .from(enrolmentDocuments)
          .where(inArray(enrolmentDocuments.userId, memberIds))
      : [];

    // Attendance: registers taken.
    const sessionIds = sessions.map((row) => row.id);
    const marks = sessionIds.length
      ? await tx.select({ sessionId: attendanceRecords.sessionId }).from(attendanceRecords).where(inArray(attendanceRecords.sessionId, sessionIds))
      : [];
    const held = sessions.filter((row) => row.status !== "cancelled" && row.scheduledDate <= today);
    const registered = held.filter((row) => marks.some((mark) => mark.sessionId === row.id));

    // Learner Evidence: work handed in, per study unit.
    const stepRows = courseIds.length
      ? await tx
          .select({ courseId: courseSteps.courseId, assessmentId: courseSteps.assessmentId })
          .from(courseSteps)
          .where(and(inArray(courseSteps.courseId, courseIds), ne(courseSteps.kind, "lesson")))
      : [];
    const assessmentIds = stepRows.map((row) => row.assessmentId).filter((id): id is string => Boolean(id));
    const submissions = assessmentIds.length && memberIds.length
      ? await tx
          .select({ id: assessmentSubmissions.id, assessmentId: assessmentSubmissions.assessmentId, userId: assessmentSubmissions.userId, status: assessmentSubmissions.status })
          .from(assessmentSubmissions)
          .where(and(inArray(assessmentSubmissions.assessmentId, assessmentIds), inArray(assessmentSubmissions.userId, memberIds), ne(assessmentSubmissions.status, "draft")))
      : [];

    // Programme feedback and WEM.
    const feedback = await tx.select({ id: feedbackRequests.id }).from(feedbackRequests).where(eq(feedbackRequests.cohortId, cohortId));
    const logbooks = memberIds.length
      ? await tx
          .select({ id: workplaceLogbooks.id, learnerId: workplaceLogbooks.learnerId, status: workplaceLogbooks.status })
          .from(workplaceLogbooks)
          .where(inArray(workplaceLogbooks.learnerId, memberIds))
      : [];

    const lectures = sessions.filter((row) => row.kind === "lecture" && row.status !== "cancelled");
    const plans = files.filter((file) => file.kind === "facilitation_plan");
    const inductions = sessions.filter((row) => row.kind === "induction");
    const qualificationHref = qualificationId ? `/qualifications/${qualificationId}` : undefined;

    const folders: FolderView[] = [
      {
        key: "qualificationDocs",
        count: qualificationDocs.length,
        items: qualificationDocs.map((doc) => ({ label: doc.title, href: `/api/programme-documents/${doc.id}` })),
        missing: qualificationKinds.filter((kind) => !qualificationDocs.some((doc) => doc.kind === kind)).map((kind) => `doc:${kind}`),
      },
      {
        key: "learningMaterial",
        count: guides.length,
        items: guides.map((doc) => ({ label: doc.title, href: `/api/programme-documents/${doc.id}` })),
        missing: courseRows.filter((row) => row.studyUnitId && !guides.some((doc) => doc.studyUnitId === row.studyUnitId)).map((row) => `guide:${row.code ?? ""}`),
      },
      {
        key: "leisa",
        count: notifications.length,
        items: notifications.map((row) => ({ label: row.title, href: "/statutory/notify#submissions", note: row.status })),
        missing: notifications.length === 0 && memberIds.length ? ["leisa"] : [],
      },
      {
        key: "induction",
        count: inductions.length + files.filter((file) => file.kind === "induction_pack").length,
        items: [
          ...inductions.map((row) => ({ label: sessionLabel(row), href: `${base}/sessions/${row.id}`, note: `register:${marks.filter((mark) => mark.sessionId === row.id).length}/${memberIds.length}` })),
          ...fileItems("induction"),
        ],
        missing: [...(inductions.length ? [] : ["inductionSession"]), ...(files.some((file) => file.kind === "induction_pack") ? [] : ["inductionPack"])],
      },
      {
        key: "learnerDocs",
        count: enrolmentDocs.length,
        items: members.map((member) => ({
          label: fullName(member),
          href: `/people/${member.userId}#documents`,
          note: `documents:${enrolmentDocs.filter((doc) => doc.userId === member.userId).length}`,
        })),
        missing: members.filter((member) => !enrolmentDocs.some((doc) => doc.userId === member.userId)).map((member) => `nodocs:${fullName(member)}`),
      },
      {
        key: "attendance",
        count: registered.length,
        items: [
          ...held.map((row) => ({ label: sessionLabel(row), href: `${base}/sessions/${row.id}`, note: `register:${marks.filter((mark) => mark.sessionId === row.id).length}/${memberIds.length}` })),
          ...fileItems("attendance"),
        ],
        missing: held.filter((row) => !marks.some((mark) => mark.sessionId === row.id)).map((row) => `register:${sessionLabel(row)}`),
      },
      {
        key: "facilitationPlans",
        count: plans.length,
        items: fileItems("facilitationPlans").map((item) => {
          const plan = plans.find((one) => one.id === item.fileId);
          const of = sessions.find((row) => row.id === plan?.sessionId);
          return of ? { ...item, note: sessionLabel(of) } : item;
        }),
        missing: lectures.filter((row) => !plans.some((plan) => plan.sessionId === row.id)).map((row) => `plan:${sessionLabel(row)}`),
      },
      {
        key: "learnerEvidence",
        count: submissions.length,
        items: courseRows.map((row) => {
          const ids = stepRows.filter((step) => step.courseId === row.id).map((step) => step.assessmentId);
          const handedIn = submissions.filter((one) => ids.includes(one.assessmentId));
          return {
            label: `${row.code ?? ""} ${row.title ?? ""}`.trim(),
            href: `${base}#results`,
            note: `evidence:${handedIn.length}:${new Set(handedIn.map((one) => one.userId)).size}`,
          };
        }),
        missing: [],
      },
      {
        key: "assessorReports",
        count: files.filter((file) => file.kind === "assessor_report").length,
        items: [
          ...courseRows
            .filter((row) => row.studyUnitId)
            .map((row) => ({ label: `${row.code ?? ""} ${row.title ?? ""}`.trim(), href: `${base}/assessor-report/${row.studyUnitId}`, note: "generated" })),
          ...fileItems("assessorReports"),
        ],
        missing: [],
      },
      {
        key: "programmeFeedback",
        count: feedback.length + files.filter((file) => file.kind === "programme_feedback").length,
        items: [...(feedback.length ? [{ label: `feedback:${feedback.length}`, href: `${base}#feedback` }] : []), ...fileItems("programmeFeedback")],
        missing: [],
      },
      {
        key: "wem",
        count: logbooks.length,
        items: [
          ...members.map((member) => ({
            label: fullName(member),
            href: "/workplace",
            note: `logbooks:${logbooks.filter((book) => book.learnerId === member.userId).length}:${logbooks.filter((book) => book.learnerId === member.userId && (book.status === "coach_signed" || book.status === "accepted_by_assessor")).length}`,
          })),
          ...sessions
            .filter((row) => row.kind === "workplace_induction")
            .map((row) => ({ label: sessionLabel(row), href: `${base}/sessions/${row.id}` })),
        ],
        missing: [],
      },
      {
        key: "monitoring",
        count: files.filter((file) => FOLDER_OF[file.kind] === "monitoring").length,
        items: fileItems("monitoring"),
        missing: [],
      },
    ];

    return {
      cohort: { id: cohort.id, name: cohort.name, qualificationId },
      folders: folders.map((folder) => (folder.key === "qualificationDocs" && !qualificationHref ? { ...folder, missing: [] } : folder)),
      sessions: sessions.map((row) => ({ id: row.id, label: sessionLabel(row), kind: row.kind, date: row.scheduledDate })),
      units: courseRows.filter((row) => row.studyUnitId).map((row) => ({ id: row.studyUnitId!, code: row.code ?? "", title: row.title ?? "" })),
    };
  });
}

/**
 * The cohort's file as zip entries, laid out as the provider's folder is:
 * Qualification Docs, Learning Material, Induction, Learner Docs/<learner>,
 * Attendance Records, Facilitation Plans, Learner Evidence/<unit>/<learner>,
 * Assessor Reports, Programme Feedback Forms, WEM, M&E. Each entry is read
 * only when it is written, so one file is in memory at a time.
 */
export async function cohortFileEntries(session: AuthenticatedSession, cohortId: string): Promise<{ name: string; entries: ArchiveEntry[] }> {
  assertSessionCan(session, "enrolment:read_all");
  return withTenant(session.organisationId, async (tx) => {
    const [cohort] = await tx.select().from(cohorts).where(eq(cohorts.id, cohortId));
    if (!cohort) throw new CohortFileError("No such cohort.", "not_found");
    const courseIds = await cohortCourseIds(tx, cohort);
    const courseRows = courseIds.length
      ? await tx
          .select({ id: courses.id, studyUnitId: courses.studyUnitId, code: studyUnits.code, qualificationId: studyUnits.qualificationId })
          .from(courses)
          .leftJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
          .where(inArray(courses.id, courseIds))
      : [];
    const qualificationId = cohort.qualificationId ?? courseRows.find((row) => row.qualificationId)?.qualificationId ?? null;
    const unitIds = courseRows.map((row) => row.studyUnitId).filter((id): id is string => Boolean(id));
    const safe = (text: string) => text.replace(/[\\/:*?"<>|]/g, "-").trim() || "Untitled";
    const entries: ArchiveEntry[] = [];
    const used = new Set<string>();
    const add = (path: string, storageKey: string) => {
      let unique = path;
      for (let n = 2; used.has(unique.toLowerCase()); n += 1) unique = path.replace(/(\.[^./]+)?$/, ` (${n})$1`);
      used.add(unique.toLowerCase());
      entries.push({ path: unique, read: () => getObject(storageKey) });
    };

    const documents = qualificationId
      ? await tx.select().from(programmeDocuments).where(eq(programmeDocuments.qualificationId, qualificationId))
      : [];
    const unitDocuments = unitIds.length ? await tx.select().from(programmeDocuments).where(inArray(programmeDocuments.studyUnitId, unitIds)) : [];
    for (const doc of documents.filter((one) => ["qualification_document", "curriculum_document", "assessment_specification"].includes(one.kind))) {
      add(`${FOLDER_NAME.qualificationDocs}/${safe(doc.filename)}`, doc.storageKey);
    }
    const guides = [...documents, ...unitDocuments].filter((doc, index, all) => doc.kind === "theory_guide" && all.findIndex((one) => one.id === doc.id) === index);
    for (const doc of guides) add(`${FOLDER_NAME.learningMaterial}/${safe(doc.filename)}`, doc.storageKey);

    const members = await tx
      .select({ userId: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(cohortMembers)
      .innerJoin(users, eq(users.id, cohortMembers.userId))
      .where(eq(cohortMembers.cohortId, cohortId));
    const nameOf = new Map(members.map((member) => [member.userId, safe(fullName(member))]));
    const memberIds = members.map((member) => member.userId);

    if (memberIds.length) {
      const docs = await tx.select().from(enrolmentDocuments).where(inArray(enrolmentDocuments.userId, memberIds));
      for (const doc of docs) add(`${FOLDER_NAME.learnerDocs}/${nameOf.get(doc.userId)}/${safe(doc.filename)}`, doc.storageKey);

      const stepRows = courseIds.length
        ? await tx.select({ courseId: courseSteps.courseId, assessmentId: courseSteps.assessmentId }).from(courseSteps).where(inArray(courseSteps.courseId, courseIds))
        : [];
      const unitOf = new Map(stepRows.filter((row) => row.assessmentId).map((row) => [row.assessmentId!, courseRows.find((course) => course.id === row.courseId)?.code || "Unit"]));
      const ids = [...unitOf.keys()];
      const evidence = ids.length
        ? await tx
            .select({ filename: evidenceArtifacts.filename, storageKey: evidenceArtifacts.storageKey, userId: assessmentSubmissions.userId, assessmentId: assessmentSubmissions.assessmentId })
            .from(evidenceArtifacts)
            .innerJoin(assessmentSubmissions, eq(assessmentSubmissions.id, evidenceArtifacts.submissionId))
            .where(and(inArray(assessmentSubmissions.assessmentId, ids), inArray(assessmentSubmissions.userId, memberIds)))
        : [];
      for (const item of evidence) {
        add(`${FOLDER_NAME.learnerEvidence}/${safe(unitOf.get(item.assessmentId) ?? "Unit")}/${nameOf.get(item.userId)}/${safe(item.filename)}`, item.storageKey);
      }
    }

    const files = await tx.select().from(cohortFiles).where(eq(cohortFiles.cohortId, cohortId));
    for (const file of files) add(`${FOLDER_NAME[FOLDER_OF[file.kind]]}/${safe(file.filename)}`, file.storageKey);

    return { name: safe(cohort.name), entries };
  });
}
