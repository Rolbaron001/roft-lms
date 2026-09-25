import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat, statfs } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { and, asc, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { Unzip, UnzipPassThrough } from "fflate";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  assessmentCriteria,
  assessmentDecisions,
  assessmentSubmissions,
  assessments,
  certificates,
  cohortArchives,
  cohortMembers,
  cohorts,
  courses,
  curriculumModules,
  enrolmentDocuments,
  enrolments,
  evidenceArtifacts,
  moderationRecords,
  organisations,
  qualificationModules,
  qualifications,
  statementsOfResults,
  studyUnits,
  users,
  workplaceLogbookEntries,
  workplaceLogbooks,
} from "@/db/schema";
import {
  ARCHIVE_FORMAT_VERSION,
  ChunkedFingerprint,
  renderArchiveIndex,
  renderLearnerIndex,
  safeName,
  uniquePath,
  type ArchivedFile,
  type ArchivedLearner,
  type ArchiveManifest,
} from "./archive-format";
import {
  ArchiveTooLargeError,
  MAX_ARCHIVE_BYTES,
  writeArchive,
  type ArchiveEntry,
} from "./archive-writer";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { deleteObject, getObject, hashBytes, putObject } from "./storage";

/**
 * Archiving a cohort's evidence off the server. Job sheet 4.3.
 *
 * Decided by Roland on 25 September, on the recommendations in
 * FOR-ROLAND-archiving-cohort-evidence.md:
 *
 * 1. The provider keeps the archive.
 * 2. Nothing is removed until the provider's own saved copy has been checked.
 * 3. Only a provider administrator may archive (`records:manage`).
 * 4. The archive is one file that opens in a browser, without the platform.
 * 5. A cohort is archived without anyone still waiting on a certificate; they
 *    follow in a later archive once theirs is issued. Marked for Heidi, who
 *    may still overturn it.
 *
 * The life of an archive, each step a deliberate act by an administrator:
 *
 *   building  written in the background, one file at a time
 *   built     waiting on the server to be downloaded
 *   verified  the provider's browser fingerprinted their saved copy and it
 *             matched, byte for byte
 *   removed   the files have left the server; every record of them remains
 *   restored  the archive was uploaded again, checked, and the files put back
 *
 * The check in step 2 is done where the copy is. The browser reads the saved
 * file in pieces and sends only the fingerprint, so an archive of any size can
 * be checked without travelling back. See lib/archive-format.ts.
 */

export class ArchiveError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "not_found"
      | "no_qualification"
      | "nobody_eligible"
      | "busy"
      | "no_space"
      | "wrong_state"
      | "mismatch"
      | "upload",
  ) {
    super(message);
    this.name = "ArchiveError";
  }
}

/**
 * Where archives wait on the server between being built and being checked.
 *
 * Inside the storage volume, so it survives a restart of the container, and
 * under a name no storage key can take: every key begins with an organisation
 * id. backup.sh leaves this folder out. Everything in it is a copy of evidence
 * the backup already holds, and a second copy would halve the disk for nothing.
 */
export function archiveWorkRoot(): string {
  return resolve(
    process.env.ARCHIVE_WORK_ROOT ??
      join(process.env.STORAGE_LOCAL_ROOT ?? "storage", "_archives"),
  );
}

/** Left free on the disk after the archive is written, for everything else. */
export const DISK_HEADROOM_BYTES = 512 * 1024 * 1024;

/** A build still "building" after this long has died with its process. */
const STALE_BUILD_MS = 6 * 60 * 60 * 1000;

/** Archives whose learners are spoken for: nobody else may archive them. */
const HOLDING = ["building", "built", "verified", "removed"] as const;

const sha256 = async (bytes: Uint8Array) =>
  new Uint8Array(createHash("sha256").update(bytes).digest());

function fullName(row: { firstName: string; lastName: string }): string {
  return `${row.firstName} ${row.lastName}`.trim();
}

// ---------------------------------------------------------------------------
// What a qualification covers
// ---------------------------------------------------------------------------

/**
 * The qualification a cohort works towards.
 *
 * A course reaches it through the curriculum module it teaches or the study
 * unit it delivers, the same two roads the tracker follows. A cohort whose
 * course answers to no qualification has no certificate to wait for and so
 * nothing that marks its learners finished.
 */
async function cohortQualification(tx: TenantDatabase, courseId: string) {
  const [row] = await tx
    .select({
      moduleQualification: curriculumModules.qualificationId,
      unitQualification: studyUnits.qualificationId,
    })
    .from(courses)
    .leftJoin(curriculumModules, eq(curriculumModules.id, courses.curriculumModuleId))
    .leftJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
    .where(eq(courses.id, courseId));

  const id = row?.unitQualification ?? row?.moduleQualification ?? null;
  if (!id) return null;

  const [qualification] = await tx
    .select({ id: qualifications.id, title: qualifications.title })
    .from(qualifications)
    .where(eq(qualifications.id, id));
  return qualification ?? null;
}

/**
 * Every course and module that counts towards the qualification.
 *
 * A part qualification owns no modules: it selects some of its parent's, so
 * the selected ones count as well as any it does own.
 */
async function qualificationScope(tx: TenantDatabase, qualificationId: string) {
  const owned = await tx
    .select({ id: curriculumModules.id })
    .from(curriculumModules)
    .where(eq(curriculumModules.qualificationId, qualificationId));
  const selected = await tx
    .select({ id: qualificationModules.curriculumModuleId })
    .from(qualificationModules)
    .where(eq(qualificationModules.qualificationId, qualificationId));
  const moduleIds = [...new Set([...owned, ...selected].map((row) => row.id))];

  const units = await tx
    .select({ id: studyUnits.id })
    .from(studyUnits)
    .where(eq(studyUnits.qualificationId, qualificationId));
  const unitIds = units.map((row) => row.id);

  const conditions = [
    moduleIds.length ? inArray(courses.curriculumModuleId, moduleIds) : undefined,
    unitIds.length ? inArray(courses.studyUnitId, unitIds) : undefined,
  ].filter(Boolean);

  const courseIds = conditions.length
    ? (
        await tx
          .select({ id: courses.id })
          .from(courses)
          .where(or(...conditions))
      ).map((row) => row.id)
    : [];

  const assessmentConditions = [
    courseIds.length ? inArray(assessments.courseId, courseIds) : undefined,
    moduleIds.length ? inArray(assessments.curriculumModuleId, moduleIds) : undefined,
  ].filter(Boolean);

  const assessmentIds = assessmentConditions.length
    ? (
        await tx
          .select({ id: assessments.id })
          .from(assessments)
          .where(or(...assessmentConditions))
      ).map((row) => row.id)
    : [];

  return { moduleIds, courseIds, assessmentIds };
}

/** Whether an enrolment counts towards the qualification. */
function enrolmentInScope(
  enrolment: { qualificationId: string | null; courseId: string | null },
  qualificationId: string,
  courseIds: string[],
): boolean {
  return (
    enrolment.qualificationId === qualificationId ||
    (enrolment.courseId !== null && courseIds.includes(enrolment.courseId))
  );
}

// ---------------------------------------------------------------------------
// Who can be archived
// ---------------------------------------------------------------------------

export type CohortArchiveState = {
  cohort: { id: string; name: string; code: string | null };
  qualification: { id: string; title: string } | null;
  /** Certificated, with a statement of results, and in no archive yet. */
  ready: { userId: string; name: string }[];
  /** Still waiting on something, with what it is. */
  waiting: { userId: string; name: string; reason: string }[];
  /** In an archive already. */
  archived: { userId: string; name: string; archiveId: string }[];
  archives: {
    id: string;
    status: string;
    filename: string;
    learners: number;
    files: number;
    filesKept: number;
    sizeBytes: number | null;
    fingerprint: string | null;
    failureReason: string | null;
    startedAt: Date;
    builtAt: Date | null;
    builtBy: string | null;
    verifiedAt: Date | null;
    removedAt: Date | null;
    restoredAt: Date | null;
  }[];
};

/**
 * Marks as failed any build that has been running far longer than any build
 * takes. The work happens in the server process, so a restart part-way through
 * leaves the row saying "building" for ever unless something says otherwise.
 */
async function sweepStaleBuilds(tx: TenantDatabase, organisationId: string) {
  const stale = await tx
    .update(cohortArchives)
    .set({
      status: "failed",
      failureReason:
        "The build stopped without finishing, most likely because the platform restarted while it ran. Nothing was removed. Build the archive again.",
    })
    .where(
      and(
        eq(cohortArchives.organisationId, organisationId),
        eq(cohortArchives.status, "building"),
        lt(cohortArchives.startedAt, new Date(Date.now() - STALE_BUILD_MS)),
      ),
    )
    .returning({ id: cohortArchives.id });

  for (const row of stale) {
    await rm(partialPath(organisationId, row.id), { force: true });
  }
}

function archivePath(organisationId: string, archiveId: string): string {
  return join(archiveWorkRoot(), organisationId, `${archiveId}.zip`);
}

function partialPath(organisationId: string, archiveId: string): string {
  return `${archivePath(organisationId, archiveId)}.part`;
}

function restorePath(organisationId: string, archiveId: string): string {
  return `${archivePath(organisationId, archiveId)}.restore`;
}

async function readState(
  tx: TenantDatabase,
  organisationId: string,
  cohortId: string,
): Promise<CohortArchiveState> {
  await sweepStaleBuilds(tx, organisationId);

  const [cohort] = await tx
    .select({
      id: cohorts.id,
      name: cohorts.name,
      code: cohorts.code,
      courseId: cohorts.courseId,
    })
    .from(cohorts)
    .where(eq(cohorts.id, cohortId));
  if (!cohort) throw new ArchiveError("No such cohort.", "not_found");

  const qualification = await cohortQualification(tx, cohort.courseId);

  const members = await tx
    .select({
      userId: cohortMembers.userId,
      leftAt: cohortMembers.leftAt,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(cohortMembers)
    .innerJoin(users, eq(users.id, cohortMembers.userId))
    .where(eq(cohortMembers.cohortId, cohortId))
    .orderBy(asc(users.lastName), asc(users.firstName));

  const archiveRows = await tx
    .select({
      id: cohortArchives.id,
      status: cohortArchives.status,
      filename: cohortArchives.filename,
      learnerIds: cohortArchives.learnerIds,
      manifest: cohortArchives.manifest,
      sizeBytes: cohortArchives.sizeBytes,
      fingerprint: cohortArchives.fingerprint,
      failureReason: cohortArchives.failureReason,
      startedAt: cohortArchives.startedAt,
      builtAt: cohortArchives.builtAt,
      verifiedAt: cohortArchives.verifiedAt,
      removedAt: cohortArchives.removedAt,
      restoredAt: cohortArchives.restoredAt,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(cohortArchives)
    .leftJoin(users, eq(users.id, cohortArchives.builtById))
    .where(eq(cohortArchives.cohortId, cohortId))
    .orderBy(desc(cohortArchives.startedAt));

  const heldBy = new Map<string, string>();
  for (const row of archiveRows) {
    if (!(HOLDING as readonly string[]).includes(row.status)) continue;
    for (const userId of row.learnerIds) {
      if (!heldBy.has(userId)) heldBy.set(userId, row.id);
    }
  }

  const archives = archiveRows.map((row) => {
    const manifest = row.manifest as ArchiveManifest;
    const files = manifest.learners.flatMap((learner) => learner.files);
    return {
      id: row.id,
      status: row.status,
      filename: row.filename,
      learners: row.learnerIds.length,
      files: files.length,
      filesKept: files.filter((file) => !file.removeFromServer).length,
      sizeBytes: row.sizeBytes,
      fingerprint: row.fingerprint,
      failureReason: row.failureReason,
      startedAt: row.startedAt,
      builtAt: row.builtAt,
      builtBy: row.firstName ? fullName({ firstName: row.firstName, lastName: row.lastName ?? "" }) : null,
      verifiedAt: row.verifiedAt,
      removedAt: row.removedAt,
      restoredAt: row.restoredAt,
    };
  });

  const state: CohortArchiveState = {
    cohort: { id: cohort.id, name: cohort.name, code: cohort.code },
    qualification,
    ready: [],
    waiting: [],
    archived: [],
    archives,
  };

  if (members.length === 0) return state;

  if (!qualification) {
    for (const member of members) {
      if (heldBy.has(member.userId)) continue;
      state.waiting.push({
        userId: member.userId,
        name: fullName(member),
        reason: "This cohort's course counts towards no qualification, so there is no certificate to wait for.",
      });
    }
    return state;
  }

  const { courseIds } = await qualificationScope(tx, qualification.id);
  const memberIds = members.map((member) => member.userId);

  const statements = await tx
    .select({ userId: statementsOfResults.userId })
    .from(statementsOfResults)
    .where(
      and(
        inArray(statementsOfResults.userId, memberIds),
        eq(statementsOfResults.qualificationId, qualification.id),
        isNull(statementsOfResults.revokedAt),
      ),
    );
  const hasStatement = new Set(statements.map((row) => row.userId));

  const certified = await tx
    .select({
      userId: certificates.userId,
      qualificationId: enrolments.qualificationId,
      courseId: enrolments.courseId,
    })
    .from(certificates)
    .innerJoin(enrolments, eq(enrolments.id, certificates.enrolmentId))
    .where(and(inArray(certificates.userId, memberIds), isNull(certificates.revokedAt)));
  const hasCertificate = new Set(
    certified
      .filter((row) => enrolmentInScope(row, qualification.id, courseIds))
      .map((row) => row.userId),
  );

  for (const member of members) {
    const name = fullName(member);
    const held = heldBy.get(member.userId);
    if (held) {
      state.archived.push({ userId: member.userId, name, archiveId: held });
      continue;
    }
    const missing = [
      hasCertificate.has(member.userId) ? null : "a certificate",
      hasStatement.has(member.userId) ? null : "a statement of results",
    ].filter(Boolean);
    if (missing.length === 0) {
      state.ready.push({ userId: member.userId, name });
    } else {
      state.waiting.push({
        userId: member.userId,
        name,
        reason: `Waiting on ${missing.join(" and ")}${member.leftAt ? ". Left the cohort" : ""}.`,
      });
    }
  }

  return state;
}

/** The archive screen for one cohort. */
export async function cohortArchiveState(
  session: AuthenticatedSession,
  cohortId: string,
): Promise<CohortArchiveState> {
  assertSessionCan(session, "records:manage");
  return withTenant(session.organisationId, (tx) =>
    readState(tx, session.organisationId, cohortId),
  );
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

type PlannedFile = ArchivedFile & {
  /** The fingerprint recorded at upload, where one was. */
  recordedSha256: string | null;
};

type PlannedLearner = Omit<ArchivedLearner, "files"> & { files: PlannedFile[] };

async function planLearners(
  tx: TenantDatabase,
  qualificationId: string,
  learnerIds: string[],
): Promise<PlannedLearner[]> {
  const { moduleIds, courseIds, assessmentIds } = await qualificationScope(tx, qualificationId);

  const people = await tx
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    })
    .from(users)
    .where(inArray(users.id, learnerIds))
    .orderBy(asc(users.lastName), asc(users.firstName));

  const folders = new Set<string>();
  const learners: PlannedLearner[] = [];

  for (const person of people) {
    const name = fullName(person);
    let folder = safeName(name, "Learner");
    for (let n = 2; folders.has(folder.toLowerCase()); n += 1) {
      folder = `${safeName(name, "Learner")} (${n})`;
    }
    folders.add(folder.toLowerCase());
    const taken = new Set<string>([`${folder}/index.html`]);
    const files: PlannedFile[] = [];

    // Certificates for this qualification.
    const certificateRows = (
      await tx
        .select({
          id: certificates.id,
          title: certificates.title,
          reference: certificates.verificationReference,
          issuedAt: certificates.issuedAt,
          storageKey: certificates.storageKey,
          archivedAt: certificates.archivedAt,
          qualificationId: enrolments.qualificationId,
          courseId: enrolments.courseId,
        })
        .from(certificates)
        .innerJoin(enrolments, eq(enrolments.id, certificates.enrolmentId))
        .where(and(eq(certificates.userId, person.id), isNull(certificates.revokedAt)))
        .orderBy(asc(certificates.issuedAt))
    ).filter((row) => enrolmentInScope(row, qualificationId, courseIds));

    for (const row of certificateRows) {
      if (!row.storageKey || row.archivedAt) continue;
      files.push({
        path: uniquePath(taken, `${folder}/Certificates`, `${row.reference}.pdf`),
        sha256: "",
        sizeBytes: 0,
        label: `Certificate: ${row.title}`,
        source: { table: "certificates", id: row.id, storageKey: row.storageKey },
        removeFromServer: true,
        recordedSha256: null,
      });
    }

    // Statements of results, which are records rather than files.
    const statementRows = await tx
      .select({
        reference: statementsOfResults.verificationReference,
        issuedAt: statementsOfResults.issuedAt,
        statement: statementsOfResults.statement,
      })
      .from(statementsOfResults)
      .where(
        and(
          eq(statementsOfResults.userId, person.id),
          eq(statementsOfResults.qualificationId, qualificationId),
          isNull(statementsOfResults.revokedAt),
        ),
      )
      .orderBy(asc(statementsOfResults.issuedAt));

    // Assessment evidence, and the decision on every attempt.
    const submissions = assessmentIds.length
      ? await tx
          .select({
            id: assessmentSubmissions.id,
            attempt: assessmentSubmissions.attemptNumber,
            title: assessments.title,
          })
          .from(assessmentSubmissions)
          .innerJoin(assessments, eq(assessments.id, assessmentSubmissions.assessmentId))
          .where(
            and(
              eq(assessmentSubmissions.userId, person.id),
              inArray(assessmentSubmissions.assessmentId, assessmentIds),
            ),
          )
          .orderBy(asc(assessments.title), asc(assessmentSubmissions.attemptNumber))
      : [];

    const decisions: ArchivedLearner["decisions"] = [];

    for (const submission of submissions) {
      const evidence = await tx
        .select()
        .from(evidenceArtifacts)
        .where(
          and(
            eq(evidenceArtifacts.submissionId, submission.id),
            isNull(evidenceArtifacts.archivedAt),
          ),
        )
        .orderBy(asc(evidenceArtifacts.uploadedAt));

      for (const artefact of evidence) {
        files.push({
          path: uniquePath(
            taken,
            `${folder}/${safeName(`${submission.title} attempt ${submission.attempt}`)}`,
            artefact.filename,
          ),
          sha256: artefact.sha256,
          sizeBytes: artefact.sizeBytes,
          label: `Evidence for ${submission.title}, attempt ${submission.attempt}`,
          source: { table: "evidence_artifacts", id: artefact.id, storageKey: artefact.storageKey },
          removeFromServer: true,
          recordedSha256: artefact.sha256,
        });
      }

      const decisionRows = await tx
        .select({
          id: assessmentDecisions.id,
          outcome: assessmentDecisions.outcome,
          signedAt: assessmentDecisions.signedAt,
          criterionOutcomes: assessmentDecisions.criterionOutcomes,
          criterionNotes: assessmentDecisions.criterionNotes,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(assessmentDecisions)
        .innerJoin(users, eq(users.id, assessmentDecisions.assessorId))
        .where(eq(assessmentDecisions.submissionId, submission.id))
        .orderBy(asc(assessmentDecisions.signedAt));

      if (decisionRows.length === 0) {
        decisions.push({
          assessment: submission.title,
          attempt: submission.attempt,
          outcome: "No decision recorded",
          decidedAt: null,
          decidedBy: null,
          moderation: null,
        });
      }

      for (const decision of decisionRows) {
        const [moderation] = await tx
          .select({
            outcome: moderationRecords.outcome,
            revisedOutcome: moderationRecords.revisedOutcome,
            actionedAt: moderationRecords.actionedAt,
            firstName: users.firstName,
            lastName: users.lastName,
          })
          .from(moderationRecords)
          .innerJoin(users, eq(users.id, moderationRecords.moderatorId))
          .where(eq(moderationRecords.decisionId, decision.id));

        const judged = Object.entries(decision.criterionOutcomes ?? {});
        const criterionRows = judged.length
          ? await tx
              .select({
                id: assessmentCriteria.id,
                code: assessmentCriteria.code,
                description: assessmentCriteria.description,
              })
              .from(assessmentCriteria)
              .where(inArray(assessmentCriteria.id, judged.map(([id]) => id)))
          : [];
        const byId = new Map(criterionRows.map((row) => [row.id, row]));

        decisions.push({
          assessment: submission.title,
          attempt: submission.attempt,
          outcome: words(decision.outcome),
          decidedAt: decision.signedAt.toISOString(),
          decidedBy: fullName(decision),
          moderation: moderation
            ? `${words(moderation.outcome)}${moderation.revisedOutcome ? `, revised to ${words(moderation.revisedOutcome)}` : ""}, ${fullName(moderation)}, ${moderation.actionedAt.toISOString().slice(0, 10)}`
            : null,
          criteria: judged.map(([id, judgement]) => ({
            code: byId.get(id)?.code ?? "",
            description: byId.get(id)?.description ?? "A criterion since removed from the curriculum",
            judgement: words(judgement),
            note: decision.criterionNotes?.[id] ?? null,
          })),
        });
      }
    }

    // Work experience evidence, attached to logbook lines.
    if (moduleIds.length) {
      const logbookEvidence = await tx
        .select({
          artefact: evidenceArtifacts,
          moduleCode: curriculumModules.code,
        })
        .from(evidenceArtifacts)
        .innerJoin(
          workplaceLogbookEntries,
          eq(workplaceLogbookEntries.id, evidenceArtifacts.logbookEntryId),
        )
        .innerJoin(workplaceLogbooks, eq(workplaceLogbooks.id, workplaceLogbookEntries.logbookId))
        .innerJoin(curriculumModules, eq(curriculumModules.id, workplaceLogbooks.curriculumModuleId))
        .where(
          and(
            eq(workplaceLogbooks.learnerId, person.id),
            inArray(workplaceLogbooks.curriculumModuleId, moduleIds),
            isNull(evidenceArtifacts.archivedAt),
          ),
        )
        .orderBy(asc(evidenceArtifacts.uploadedAt));

      for (const { artefact, moduleCode } of logbookEvidence) {
        files.push({
          path: uniquePath(taken, `${folder}/${safeName(`Workplace logbook ${moduleCode}`)}`, artefact.filename),
          sha256: artefact.sha256,
          sizeBytes: artefact.sizeBytes,
          label: `Workplace logbook evidence, ${moduleCode}`,
          source: { table: "evidence_artifacts", id: artefact.id, storageKey: artefact.storageKey },
          removeFromServer: true,
          recordedSha256: artefact.sha256,
        });
      }
    }

    // Enrolment documents. They belong to the person rather than the
    // qualification, so they stay on the server while any other programme of
    // theirs might still ask for them. They go in the archive either way.
    const otherEnrolments = (
      await tx
        .select({
          qualificationId: enrolments.qualificationId,
          courseId: enrolments.courseId,
          status: enrolments.status,
        })
        .from(enrolments)
        .where(eq(enrolments.userId, person.id))
    ).filter(
      (row) =>
        !enrolmentInScope(row, qualificationId, courseIds) &&
        row.status !== "withdrawn" &&
        row.status !== "superseded",
    );
    const documentsStillNeeded = otherEnrolments.length > 0;

    const documents = await tx
      .select()
      .from(enrolmentDocuments)
      .where(and(eq(enrolmentDocuments.userId, person.id), isNull(enrolmentDocuments.archivedAt)))
      .orderBy(asc(enrolmentDocuments.createdAt));

    for (const document of documents) {
      files.push({
        path: uniquePath(taken, `${folder}/Enrolment documents`, document.filename),
        sha256: document.sha256,
        sizeBytes: document.sizeBytes ?? 0,
        label: `Enrolment document: ${words(document.kind)}${documentsStillNeeded ? ". Kept on the platform as well, for the learner's other programme" : ""}`,
        source: { table: "enrolment_documents", id: document.id, storageKey: document.storageKey },
        removeFromServer: !documentsStillNeeded,
        recordedSha256: document.sha256,
      });
    }

    learners.push({
      userId: person.id,
      name,
      email: person.email,
      folder,
      certificates: certificateRows.map((row) => ({
        reference: row.reference,
        title: row.title,
        issuedAt: row.issuedAt.toISOString(),
      })),
      statements: statementRows.map((row) => ({
        reference: row.reference,
        issuedAt: row.issuedAt.toISOString(),
        statement: describeStatement(row.statement),
      })),
      decisions,
      files,
    });
  }

  return learners;
}

/** "not_yet_competent" to "Not yet competent". */
function words(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function describeStatement(
  statement: (typeof statementsOfResults.$inferSelect)["statement"],
): string {
  const scope = statement.studyUnit
    ? `${statement.studyUnit.code} ${statement.studyUnit.title}`
    : `${statement.qualification.title}, whole qualification`;
  const modules = statement.modules
    .map((m) => `${m.code} ${m.result}${m.achievedAt ? ` (${m.achievedAt.slice(0, 10)})` : ""}`)
    .join("; ");
  return modules ? `${scope}: ${modules}` : scope;
}

/**
 * Starts an archive of every learner in the cohort who is ready.
 *
 * Checks what can be checked before anything is written: that there is
 * somebody to archive, that no other archive of this provider's is being
 * written, that it fits in one zip, and that the disk can hold it. The writing
 * itself runs in the background and the row says how it went.
 *
 * `wait` is for tests and scripts, which need to know it finished.
 */
export async function startCohortArchive(
  session: AuthenticatedSession,
  cohortId: string,
  options: { wait?: boolean } = {},
): Promise<{ archiveId: string; done: Promise<void> }> {
  assertSessionCan(session, "records:manage");
  const organisationId = session.organisationId;

  const planned = await withTenant(organisationId, async (tx) => {
    const state = await readState(tx, organisationId, cohortId);
    if (!state.qualification) {
      throw new ArchiveError(
        "This cohort's course counts towards no qualification, so nobody in it can be shown to have finished.",
        "no_qualification",
      );
    }
    if (state.ready.length === 0) {
      throw new ArchiveError(
        "Nobody in this cohort is ready to archive. A learner is ready once they hold a certificate and a statement of results for the qualification.",
        "nobody_eligible",
      );
    }

    const [busy] = await tx
      .select({ id: cohortArchives.id })
      .from(cohortArchives)
      .where(
        and(
          eq(cohortArchives.organisationId, organisationId),
          eq(cohortArchives.status, "building"),
        ),
      );
    if (busy) {
      throw new ArchiveError(
        "Another archive is being written. One at a time, because each needs its own room on the disk. Try again when it has finished.",
        "busy",
      );
    }

    const learnerIds = state.ready.map((row) => row.userId);
    const learners = await planLearners(tx, state.qualification.id, learnerIds);

    const [organisation] = await tx
      .select({
        displayName: organisations.displayName,
        years: organisations.dataRetentionYears,
      })
      .from(organisations)
      .where(eq(organisations.id, organisationId));

    return { state, learners, organisation };
  });

  const { state, learners, organisation } = planned;

  // Sizes as recorded. A certificate's size is not, so it is allowed for
  // generously; certificates are small.
  const estimate =
    learners.reduce(
      (sum, learner) =>
        sum +
        learner.files.reduce((n, file) => n + (file.sizeBytes || 2 * 1024 * 1024) + 256, 0) +
        64 * 1024,
      0,
    ) +
    1024 * 1024;
  if (estimate > MAX_ARCHIVE_BYTES) throw new ArchiveTooLargeError(estimate);

  const root = archiveWorkRoot();
  await mkdir(join(root, organisationId), { recursive: true });
  const disk = await statfs(root);
  const free = Number(disk.bavail) * Number(disk.bsize);
  if (free < estimate + DISK_HEADROOM_BYTES) {
    throw new ArchiveError(
      `The server has ${(free / 1024 ** 3).toFixed(1)} GB free and this archive needs about ${((estimate + DISK_HEADROOM_BYTES) / 1024 ** 3).toFixed(1)} GB, counting room left for everything else. Archive fewer learners at once, or ask for more disk.`,
      "no_space",
    );
  }

  const archiveId = randomUUID();
  const builtAt = new Date();
  const builtBy = fullName(session);
  const stamp = builtAt.toISOString().slice(0, 10);
  const filename = `${safeName(state.cohort.code || state.cohort.name, "Cohort")} archive ${stamp}.zip`;

  const manifest: ArchiveManifest = {
    formatVersion: ARCHIVE_FORMAT_VERSION,
    archiveId,
    provider: organisation?.displayName ?? "",
    cohort: state.cohort,
    qualification: state.qualification?.title ?? null,
    builtAt: builtAt.toISOString(),
    builtBy,
    retentionYears: organisation?.years ?? 5,
    learners: learners.map((learner) => ({
      ...learner,
      files: learner.files.map(stripPlanned),
    })),
  };

  await withTenant(organisationId, async (tx) => {
    await tx.insert(cohortArchives).values({
      id: archiveId,
      organisationId,
      cohortId,
      status: "building",
      learnerIds: learners.map((learner) => learner.userId),
      filename,
      manifest,
      builtById: session.userId,
      startedAt: builtAt,
    });
    await recordAudit(tx, {
      organisationId,
      actorId: session.userId,
      action: "archive.started",
      entityType: "cohort_archive",
      entityId: archiveId,
      after: { cohortId, learners: learners.length, filename },
    });
  });

  const done = writeCohortArchive(organisationId, archiveId, manifest, learners);
  if (options.wait) await done;
  return { archiveId, done };
}

function stripPlanned(file: PlannedFile): ArchivedFile {
  return {
    path: file.path,
    sha256: file.sha256,
    sizeBytes: file.sizeBytes,
    label: file.label,
    source: file.source,
    removeFromServer: file.removeFromServer,
  };
}

/**
 * Writes the zip, then records how it went. Never throws: a failure is written
 * to the row, with the partial file removed, because nobody is waiting on this
 * promise to hear about it.
 */
async function writeCohortArchive(
  organisationId: string,
  archiveId: string,
  manifest: ArchiveManifest,
  learners: PlannedLearner[],
): Promise<void> {
  const partial = partialPath(organisationId, archiveId);
  const finished = archivePath(organisationId, archiveId);

  try {
    const handle = await open(partial, "w");
    let result: { fingerprint: string; bytes: number };
    try {
      result = await writeArchive(
        entriesFor(manifest, learners),
        async (piece) => {
          await handle.write(piece);
        },
        sha256,
      );
    } finally {
      await handle.close();
    }
    await rename(partial, finished);

    await withTenant(organisationId, async (tx) => {
      await tx
        .update(cohortArchives)
        .set({
          status: "built",
          sizeBytes: result.bytes,
          fingerprint: result.fingerprint,
          manifest,
          workingPath: finished,
          builtAt: new Date(),
        })
        .where(eq(cohortArchives.id, archiveId));
      await recordAudit(tx, {
        organisationId,
        action: "archive.built",
        entityType: "cohort_archive",
        entityId: archiveId,
        after: { bytes: result.bytes, fingerprint: result.fingerprint },
      });
    });
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    await rm(finished, { force: true }).catch(() => undefined);
    const reason =
      error instanceof Error ? error.message : "The archive could not be written.";
    await withTenant(organisationId, async (tx) => {
      await tx
        .update(cohortArchives)
        .set({ status: "failed", failureReason: reason, workingPath: null })
        .where(eq(cohortArchives.id, archiveId));
      await recordAudit(tx, {
        organisationId,
        action: "archive.failed",
        entityType: "cohort_archive",
        entityId: archiveId,
        after: { reason },
      });
    }).catch(() => undefined);
  }
}

/**
 * The archive's contents, in the order they are written.
 *
 * Each learner's files first, then their page, which by then can show the
 * fingerprint of every file as it was actually read. The manifest and the
 * front page go last for the same reason.
 */
async function* entriesFor(
  manifest: ArchiveManifest,
  learners: PlannedLearner[],
): AsyncGenerator<ArchiveEntry> {
  const encoder = new TextEncoder();

  for (const [index, learner] of learners.entries()) {
    const archived = manifest.learners[index];

    for (const [fileIndex, file] of learner.files.entries()) {
      const entry = archived.files[fileIndex];
      yield {
        path: file.path,
        read: async () => {
          let bytes: Uint8Array;
          try {
            bytes = await getObject(file.source.storageKey);
          } catch {
            throw new ArchiveError(
              `${learner.name}'s file "${file.path.split("/").pop()}" could not be read from storage, so the archive was not finished and nothing was removed. The file needs to be found or its record corrected before this learner can be archived.`,
              "not_found",
            );
          }
          const actual = hashBytes(bytes);
          entry.sha256 = actual;
          entry.sizeBytes = bytes.byteLength;
          if (file.recordedSha256 && file.recordedSha256 !== actual) {
            // Recorded, not refused: the archive must say what the file is,
            // and that it is not what was uploaded.
            entry.label = `${entry.label}. This file no longer matches the fingerprint recorded when it was uploaded, which was ${file.recordedSha256}`;
          }
          return bytes;
        },
      };
    }

    yield {
      path: `${learner.folder}/index.html`,
      read: async () => encoder.encode(renderLearnerIndex(manifest, archived)),
    };
  }

  yield {
    path: "manifest.json",
    read: async () => encoder.encode(JSON.stringify(manifest, null, 2)),
  };
  yield {
    path: "index.html",
    read: async () => encoder.encode(renderArchiveIndex(manifest)),
  };
}

// ---------------------------------------------------------------------------
// Downloading and checking the provider's copy
// ---------------------------------------------------------------------------

async function loadArchive(tx: TenantDatabase, archiveId: string) {
  const [row] = await tx
    .select()
    .from(cohortArchives)
    .where(eq(cohortArchives.id, archiveId));
  if (!row) throw new ArchiveError("No such archive.", "not_found");
  return row;
}

/** The built file, for the download route to stream. */
export async function archiveForDownload(session: AuthenticatedSession, archiveId: string) {
  assertSessionCan(session, "records:manage");
  const row = await withTenant(session.organisationId, (tx) => loadArchive(tx, archiveId));
  if (!row.workingPath || (row.status !== "built" && row.status !== "verified")) {
    throw new ArchiveError(
      "This archive is not on the server to download. Only a built archive that has not had its files removed can be downloaded.",
      "wrong_state",
    );
  }
  return {
    path: row.workingPath,
    filename: row.filename,
    sizeBytes: row.sizeBytes ?? (await stat(row.workingPath)).size,
    stream: () => createReadStream(row.workingPath!),
  };
}

/**
 * Records the fingerprint the provider's browser took of the copy they saved.
 *
 * A match is the only thing that allows files to be removed. A mismatch is
 * recorded too: a damaged copy found now, while the originals still exist, is
 * the check doing its job.
 */
export async function confirmArchiveCopy(
  session: AuthenticatedSession,
  archiveId: string,
  copy: { fingerprint: string; bytes: number },
) {
  assertSessionCan(session, "records:manage");

  return withTenant(session.organisationId, async (tx) => {
    const row = await loadArchive(tx, archiveId);
    if (row.status !== "built" && row.status !== "verified") {
      throw new ArchiveError("Only a built archive can be checked.", "wrong_state");
    }

    const matches = copy.fingerprint === row.fingerprint && copy.bytes === row.sizeBytes;
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: matches ? "archive.copy_verified" : "archive.copy_mismatch",
      entityType: "cohort_archive",
      entityId: archiveId,
      after: { fingerprint: copy.fingerprint, bytes: copy.bytes },
    });

    if (!matches) {
      throw new ArchiveError(
        copy.bytes !== row.sizeBytes
          ? `The file you chose is ${copy.bytes.toLocaleString("en-ZA")} bytes; the archive is ${(row.sizeBytes ?? 0).toLocaleString("en-ZA")}. It may be a different file, or a download that did not finish. Nothing has been removed. Download the archive again and check that copy.`
          : "The file you chose is the right size but its contents differ from the archive. It has been damaged since it was downloaded. Nothing has been removed. Download the archive again and check that copy.",
        "mismatch",
      );
    }

    const [updated] = await tx
      .update(cohortArchives)
      .set({ status: "verified", verifiedById: session.userId, verifiedAt: new Date() })
      .where(eq(cohortArchives.id, archiveId))
      .returning();
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Removing and restoring
// ---------------------------------------------------------------------------

function filesOf(manifest: ArchiveManifest): ArchivedFile[] {
  return manifest.learners.flatMap((learner) => learner.files);
}

async function markArchived(
  tx: TenantDatabase,
  file: ArchivedFile,
  archiveId: string | null,
  at: Date | null,
) {
  const values = { archivedAt: at, archiveId };
  const { table, id } = file.source;
  if (table === "evidence_artifacts") {
    await tx.update(evidenceArtifacts).set(values).where(eq(evidenceArtifacts.id, id));
  } else if (table === "enrolment_documents") {
    await tx.update(enrolmentDocuments).set(values).where(eq(enrolmentDocuments.id, id));
  } else {
    await tx.update(certificates).set(values).where(eq(certificates.id, id));
  }
}

/**
 * Takes the archived files off the server, once the provider's copy matched.
 *
 * Every record is marked before any file is removed, so a removal cut short
 * leaves records that say where their files went rather than files that
 * silently vanished; running it again finishes the job. Enrolment documents a
 * learner's other programme still needs are left where they are.
 */
export async function removeArchivedFiles(session: AuthenticatedSession, archiveId: string) {
  assertSessionCan(session, "records:manage");
  const organisationId = session.organisationId;

  const row = await withTenant(organisationId, async (tx) => {
    const archive = await loadArchive(tx, archiveId);
    if (archive.status !== "verified") {
      throw new ArchiveError(
        "Files are removed only once the provider's saved copy has been checked against the archive. Check the copy first.",
        "wrong_state",
      );
    }
    const now = new Date();
    for (const file of filesOf(archive.manifest as ArchiveManifest)) {
      if (file.removeFromServer) await markArchived(tx, file, archiveId, now);
    }
    return archive;
  });

  const manifest = row.manifest as ArchiveManifest;
  let removed = 0;
  for (const file of filesOf(manifest)) {
    if (!file.removeFromServer) continue;
    await deleteObject(file.source.storageKey);
    removed += 1;
  }

  if (row.workingPath) await rm(row.workingPath, { force: true });

  return withTenant(organisationId, async (tx) => {
    const [updated] = await tx
      .update(cohortArchives)
      .set({
        status: "removed",
        removedById: session.userId,
        removedAt: new Date(),
        workingPath: null,
      })
      .where(eq(cohortArchives.id, archiveId))
      .returning();
    await recordAudit(tx, {
      organisationId,
      actorId: session.userId,
      action: "archive.files_removed",
      entityType: "cohort_archive",
      entityId: archiveId,
      after: { removed, kept: filesOf(manifest).length - removed },
    });
    return updated;
  });
}

/**
 * Gives up on an archive before its files are removed.
 *
 * The working file is deleted and the learners become ready again. Nothing on
 * the platform changes, since nothing had been removed.
 */
export async function abandonArchive(session: AuthenticatedSession, archiveId: string) {
  assertSessionCan(session, "records:manage");

  return withTenant(session.organisationId, async (tx) => {
    const row = await loadArchive(tx, archiveId);
    if (!["built", "verified", "failed"].includes(row.status)) {
      throw new ArchiveError(
        row.status === "building"
          ? "This archive is still being written. Wait for it to finish, then set it aside."
          : "This archive's files have already left the server. Restore it instead.",
        "wrong_state",
      );
    }
    if (row.workingPath) await rm(row.workingPath, { force: true });
    const [updated] = await tx
      .update(cohortArchives)
      .set({ status: "abandoned", workingPath: null })
      .where(eq(cohortArchives.id, archiveId))
      .returning();
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "archive.abandoned",
      entityType: "cohort_archive",
      entityId: archiveId,
    });
    return updated;
  });
}

/** Pieces of a restore upload, well inside the proxy's 512 MB limit. */
export const RESTORE_CHUNK_BYTES = 16 * 1024 * 1024;

async function restoreTarget(session: AuthenticatedSession, archiveId: string) {
  assertSessionCan(session, "records:manage");
  const row = await withTenant(session.organisationId, (tx) => loadArchive(tx, archiveId));
  if (row.status !== "removed") {
    throw new ArchiveError("Only an archive whose files were removed can be restored.", "wrong_state");
  }
  return row;
}

/** How much of a restore upload has arrived, so an interrupted one can resume. */
export async function restoreProgress(session: AuthenticatedSession, archiveId: string) {
  const row = await restoreTarget(session, archiveId);
  const path = restorePath(session.organisationId, archiveId);
  const received = await stat(path).then((s) => s.size, () => 0);
  return { received, expected: row.sizeBytes ?? 0 };
}

/**
 * Appends one piece of the archive being given back.
 *
 * The offset must be exactly what has arrived so far, so a piece sent twice
 * or out of order is refused rather than written into the wrong place.
 */
export async function appendRestoreChunk(
  session: AuthenticatedSession,
  archiveId: string,
  offset: number,
  bytes: Uint8Array,
) {
  const row = await restoreTarget(session, archiveId);
  const path = restorePath(session.organisationId, archiveId);
  await mkdir(dirname(path), { recursive: true });

  const received = await stat(path).then((s) => s.size, () => 0);
  if (offset === 0 && received > 0) {
    await rm(path, { force: true });
  } else if (offset !== received) {
    throw new ArchiveError(
      `The upload is out of step: ${received} bytes have arrived and this piece starts at ${offset}. Carry on from ${received}.`,
      "upload",
    );
  }
  if (offset + bytes.byteLength > (row.sizeBytes ?? 0)) {
    throw new ArchiveError(
      "This file is larger than the archive being restored. It is not the same archive.",
      "upload",
    );
  }

  const handle = await open(path, "a");
  try {
    await handle.write(bytes);
  } finally {
    await handle.close();
  }
  return { received: offset + bytes.byteLength, expected: row.sizeBytes ?? 0 };
}

/**
 * Checks the uploaded archive and puts every file back where it came from.
 *
 * The whole archive must match the fingerprint taken when it was built, and
 * every file must match its own fingerprint in the manifest, before any
 * record is changed. A file is written back under its original storage key,
 * so every link to it works again as though it had never left.
 */
export async function finishRestore(session: AuthenticatedSession, archiveId: string) {
  const row = await restoreTarget(session, archiveId);
  const organisationId = session.organisationId;
  const path = restorePath(organisationId, archiveId);
  const manifest = row.manifest as ArchiveManifest;

  const size = await stat(path).then((s) => s.size, () => 0);
  if (size !== row.sizeBytes) {
    throw new ArchiveError(
      `${size} of ${row.sizeBytes} bytes have arrived. Finish the upload first.`,
      "upload",
    );
  }

  const fingerprint = new ChunkedFingerprint(sha256);
  for await (const piece of createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })) {
    await fingerprint.update(new Uint8Array(piece as Buffer));
  }
  if ((await fingerprint.finish()).fingerprint !== row.fingerprint) {
    await rm(path, { force: true });
    throw new ArchiveError(
      "The uploaded file is not this archive, or it has been changed since it was made. Nothing was restored.",
      "mismatch",
    );
  }

  const wanted = new Map(
    filesOf(manifest)
      .filter((file) => file.removeFromServer)
      .map((file) => [file.path, file]),
  );
  const restored = new Set<string>();

  await readZip(path, async (name, bytes) => {
    const file = wanted.get(name);
    if (!file) return;
    if (hashBytes(bytes) !== file.sha256) {
      throw new ArchiveError(
        `"${name}" in the archive does not match its own fingerprint. Nothing was restored.`,
        "mismatch",
      );
    }
    await putObject(file.source.storageKey, bytes);
    restored.add(name);
  });

  const missing = [...wanted.keys()].filter((name) => !restored.has(name));
  if (missing.length) {
    throw new ArchiveError(
      `The archive is missing ${missing.length} of its own files, starting with "${missing[0]}". Nothing on the platform was changed.`,
      "mismatch",
    );
  }

  await rm(path, { force: true });

  return withTenant(organisationId, async (tx) => {
    for (const file of wanted.values()) await markArchived(tx, file, null, null);
    const [updated] = await tx
      .update(cohortArchives)
      .set({ status: "restored", restoredById: session.userId, restoredAt: new Date() })
      .where(eq(cohortArchives.id, archiveId))
      .returning();
    await recordAudit(tx, {
      organisationId,
      actorId: session.userId,
      action: "archive.restored",
      entityType: "cohort_archive",
      entityId: archiveId,
      after: { restored: restored.size },
    });
    return updated;
  });
}

/**
 * Reads a stored zip from disk one entry at a time.
 *
 * Only stored entries, which is all this platform writes. Each file's bytes
 * are handed over when it is complete and awaited before the next piece of the
 * zip is read, so memory holds one file and one piece.
 */
async function readZip(
  path: string,
  onFile: (name: string, bytes: Uint8Array) => Promise<void>,
): Promise<void> {
  const ready: { name: string; bytes: Uint8Array }[] = [];
  let failure: unknown = null;

  const unzip = new Unzip((file) => {
    const parts: Uint8Array[] = [];
    file.ondata = (error, data, final) => {
      if (error) {
        failure = error;
        return;
      }
      parts.push(data);
      if (final) {
        const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let at = 0;
        for (const p of parts) {
          bytes.set(p, at);
          at += p.length;
        }
        ready.push({ name: file.name, bytes });
      }
    };
    file.start();
  });
  unzip.register(UnzipPassThrough);

  const drain = async () => {
    while (ready.length) {
      const next = ready.shift()!;
      await onFile(next.name, next.bytes);
    }
  };

  for await (const piece of createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })) {
    unzip.push(new Uint8Array(piece as Buffer), false);
    if (failure) throw failure;
    await drain();
  }
  unzip.push(new Uint8Array(0), true);
  if (failure) throw failure;
  await drain();
}

// ---------------------------------------------------------------------------
// Saying where a file went
// ---------------------------------------------------------------------------

/**
 * What to tell somebody who asks for a file that has been archived.
 *
 * The record stays on the platform; only the bytes left. So a request for the
 * file is answered with where it is, rather than with a failure that looks
 * like data loss.
 */
export async function archivedFileNotice(
  tx: TenantDatabase,
  archiveId: string,
  archivedAt: Date,
): Promise<string> {
  const [row] = await tx
    .select({ filename: cohortArchives.filename })
    .from(cohortArchives)
    .where(eq(cohortArchives.id, archiveId));
  const [organisation] = await tx
    .select({ displayName: organisations.displayName })
    .from(organisations)
    .innerJoin(cohortArchives, eq(cohortArchives.organisationId, organisations.id))
    .where(eq(cohortArchives.id, archiveId));
  return `This file was archived on ${archivedAt.toISOString().slice(0, 10)}${row ? `, in "${row.filename}"` : ""}, and is held by ${organisation?.displayName ?? "the provider"}. The record of it remains here. An administrator can restore the archive if the file is needed on the platform again.`;
}
