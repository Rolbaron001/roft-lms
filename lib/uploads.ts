import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  assessmentSubmissions,
  courseSections,
  courses,
  evidenceArtifacts,
  workplaceLogbookEntries,
  workplaceLogbooks,
  lessons,
  organisations,
} from "@/db/schema";
import { readDocxText, OfficeReadError } from "./office";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { can } from "./rbac";
import {
  detectMedia,
  describeSize,
  lessonContentTypeFor,
  SIZE_LIMITS,
  type DetectedMedia,
} from "./media";
import { buildStorageKey, getObject, putObject } from "./storage";

/**
 * Uploading course material and reading it back.
 *
 * Two rules run through this file:
 *
 *   1. What a file *is* comes from its contents, never its name or the
 *      content type the browser sent. Both are supplied by the uploader.
 *   2. Nothing is served from storage without checking, on that request, that
 *      the person asking is entitled to it. Storage keys begin with the
 *      organisation id, but a key is not a permission — it is only a name, and
 *      names leak.
 */

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "rejected"
      | "too_large"
      | "not_found"
      | "not_permitted",
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export type StoredMedia = DetectedMedia & {
  storageKey: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
};

/**
 * Checks a file and writes it to storage.
 *
 * The size limit is applied after detection, because the ceiling depends on
 * what the file turned out to be: half a gigabyte is reasonable for a recorded
 * practical assessment and absurd for a diagram.
 */
async function acceptFile(
  organisationId: string,
  scope: string,
  file: { filename: string; bytes: Uint8Array },
): Promise<StoredMedia> {
  const detected = detectMedia(file.bytes, file.filename);

  if (!detected.ok) {
    throw new UploadError(detected.reason, "rejected");
  }

  const limit = SIZE_LIMITS[detected.kind];
  if (file.bytes.byteLength > limit) {
    throw new UploadError(
      `That ${detected.label.toLowerCase()} is ${describeSize(file.bytes.byteLength)}. The limit for this kind of file is ${describeSize(limit)}.`,
      "too_large",
    );
  }

  const key = buildStorageKey(organisationId, scope, file.filename);
  const stored = await putObject(key, file.bytes);

  return {
    ...detected,
    storageKey: stored.storageKey,
    filename: file.filename,
    sizeBytes: stored.sizeBytes,
    sha256: stored.sha256,
  };
}

/**
 * Attaches a file to a lesson, and sets the lesson's type to match what the
 * file turned out to be — so a slide deck uploaded to a lesson marked "text"
 * corrects itself rather than rendering as nothing.
 */
export async function uploadLessonMedia(
  session: AuthenticatedSession,
  lessonId: string,
  file: { filename: string; bytes: Uint8Array },
) {
  assertSessionCan(session, "course:author");

  const lesson = await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({
        id: lessons.id,
        courseId: courseSections.courseId,
        courseStatus: courses.status,
      })
      .from(lessons)
      .innerJoin(courseSections, eq(courseSections.id, lessons.sectionId))
      .innerJoin(courses, eq(courses.id, courseSections.courseId))
      .where(eq(lessons.id, lessonId));

    return row;
  });

  if (!lesson) {
    throw new UploadError("Lesson not found.", "not_found");
  }

  if (lesson.courseStatus === "published") {
    throw new UploadError(
      "This course is published. Create a new version to change its content.",
      "not_permitted",
    );
  }

  const stored = await acceptFile(
    session.organisationId,
    `lessons/${lessonId}`,
    file,
  );

  // A Word document is read, not merely attached.
  //
  // Learning material is written in Word and always will be. Left as an
  // attachment, a chapter becomes a download: the learner leaves the platform
  // to read it, the text cannot be searched, and progress through it cannot be
  // observed. Pulling the text into the lesson body means it renders as a
  // lesson, while the original file stays attached for anyone who wants the
  // formatted version.
  //
  // Only when the lesson has no body already. Overwriting something an author
  // typed, because they later attached the source document, would be the
  // upload destroying work.
  let extracted: string | null = null;

  if (stored.mimeType.includes("wordprocessingml")) {
    try {
      const text = readDocxText(file.bytes).trim();
      if (text.length > 0) extracted = text.slice(0, 200_000);
    } catch (error) {
      // A file that cannot be read is still worth attaching. The lesson simply
      // keeps the download and no body, which is the truth.
      if (!(error instanceof OfficeReadError)) throw error;
    }
  }

  await withTenant(session.organisationId, async (tx) => {
    const [current] = await tx
      .select({ body: lessons.body })
      .from(lessons)
      .where(eq(lessons.id, lessonId));

    const keepsExistingBody = Boolean(current?.body?.trim());

    await tx
      .update(lessons)
      .set({
        storageKey: stored.storageKey,
        mediaMimeType: stored.mimeType,
        mediaFilename: stored.filename,
        mediaSizeBytes: stored.sizeBytes,
        mediaSha256: stored.sha256,
        // A document whose text was read renders as a readable lesson with the
        // file attached, rather than as a bare download.
        contentType:
          extracted && !keepsExistingBody
            ? ("text" as "video")
            : (lessonContentTypeFor(stored.kind) as "video"),
        ...(extracted && !keepsExistingBody ? { body: extracted } : {}),
      })
      .where(eq(lessons.id, lessonId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "lesson.media_uploaded",
      entityType: "lesson",
      entityId: lessonId,
      after: {
        filename: stored.filename,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        textExtracted: extracted !== null,
      },
    });
  });

  return { ...stored, textExtracted: extracted !== null };
}

/**
 * Attaches evidence to a submission.
 *
 * Same detection as course material, plus the SHA-256 hash that makes a
 * Portfolio of Evidence defensible. Only the learner who owns the submission
 * may add to it: evidence somebody else could attach is not evidence.
 */
export async function uploadEvidence(
  session: AuthenticatedSession,
  submissionId: string,
  files: { filename: string; bytes: Uint8Array }[],
  context: { ipAddress?: string | null } = {},
) {
  assertSessionCan(session, "evidence:submit");

  if (files.length === 0) {
    throw new UploadError("Choose at least one file.", "rejected");
  }

  const submission = await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select()
      .from(assessmentSubmissions)
      .where(eq(assessmentSubmissions.id, submissionId));
    return row;
  });

  if (!submission) {
    throw new UploadError("Submission not found.", "not_found");
  }

  if (submission.userId !== session.userId) {
    throw new UploadError(
      "That submission belongs to somebody else.",
      "not_permitted",
    );
  }

  if (submission.status !== "draft" && submission.status !== "submitted") {
    throw new UploadError(
      "This submission has already been assessed, so evidence cannot be added to it.",
      "not_permitted",
    );
  }

  const stored: StoredMedia[] = [];
  for (const file of files) {
    stored.push(
      await acceptFile(
        session.organisationId,
        `evidence/${submissionId}`,
        file,
      ),
    );
  }

  await withTenant(session.organisationId, async (tx) => {
    await tx.insert(evidenceArtifacts).values(
      stored.map((item) => ({
        organisationId: session.organisationId,
        submissionId,
        filename: item.filename,
        storageKey: item.storageKey,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        sha256: item.sha256,
        uploadedById: session.userId,
        uploadedIp: context.ipAddress ?? null,
      })),
    );

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "evidence.uploaded",
      entityType: "assessment_submission",
      entityId: submissionId,
      after: {
        files: stored.map((item) => ({
          filename: item.filename,
          mimeType: item.mimeType,
          sha256: item.sha256,
        })),
      },
    });
  });

  return stored;
}

/**
 * Attaches supporting evidence to a work experience logbook entry.
 *
 * Same store, same hashing and same limits as assessment evidence: to an
 * external verifier the Portfolio of Evidence is one thing, and a second
 * upload path would be a second place for the integrity check to be missing.
 *
 * Only the learner may attach, and only while the logbook is theirs to edit.
 * Once the coach has signed, the evidence they attested to is fixed.
 */
export async function uploadLogbookEvidence(
  session: AuthenticatedSession,
  entryId: string,
  files: { filename: string; bytes: Uint8Array }[],
  context: { ipAddress?: string | null } = {},
) {
  assertSessionCan(session, "workplace:log");

  if (files.length === 0) {
    throw new UploadError("Choose at least one file.", "rejected");
  }

  const entry = await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({
        id: workplaceLogbookEntries.id,
        logbookId: workplaceLogbookEntries.logbookId,
        learnerId: workplaceLogbooks.learnerId,
        status: workplaceLogbooks.status,
      })
      .from(workplaceLogbookEntries)
      .innerJoin(
        workplaceLogbooks,
        eq(workplaceLogbooks.id, workplaceLogbookEntries.logbookId),
      )
      .where(eq(workplaceLogbookEntries.id, entryId));
    return row;
  });

  if (!entry) {
    throw new UploadError("Logbook entry not found.", "not_found");
  }

  if (entry.learnerId !== session.userId) {
    throw new UploadError("That is not your logbook.", "not_permitted");
  }

  if (entry.status !== "draft" && entry.status !== "returned_by_coach") {
    throw new UploadError(
      "This logbook has been submitted, so evidence cannot be added to it.",
      "not_permitted",
    );
  }

  const stored: StoredMedia[] = [];
  for (const file of files) {
    stored.push(
      await acceptFile(
        session.organisationId,
        `logbook/${entry.logbookId}`,
        file,
      ),
    );
  }

  await withTenant(session.organisationId, async (tx) => {
    await tx.insert(evidenceArtifacts).values(
      stored.map((item) => ({
        organisationId: session.organisationId,
        logbookEntryId: entryId,
        filename: item.filename,
        storageKey: item.storageKey,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        sha256: item.sha256,
        uploadedById: session.userId,
        uploadedIp: context.ipAddress ?? null,
      })),
    );

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "workplace_evidence.uploaded",
      entityType: "workplace_logbook_entry",
      entityId: entryId,
      after: {
        files: stored.map((item) => ({
          filename: item.filename,
          sha256: item.sha256,
        })),
      },
    });
  });

  return stored;
}

export type ServableFile = {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
  /** False for anything that could carry script, which is sent as a download. */
  safeToEmbed: boolean;
};

/**
 * Fetches a stored file for someone, having first established that they are
 * entitled to it.
 *
 * Authorisation is decided from the database record that points at the file,
 * never from the storage key itself. Anyone who has seen a key could otherwise
 * replay it, and keys appear in page source.
 */
export async function readLessonMedia(
  session: AuthenticatedSession,
  lessonId: string,
): Promise<ServableFile> {
  const lesson = await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({
        storageKey: lessons.storageKey,
        mimeType: lessons.mediaMimeType,
        filename: lessons.mediaFilename,
      })
      .from(lessons)
      .where(eq(lessons.id, lessonId));
    return row;
  });

  // The tenant scope above already limits this to the reader's organisation:
  // another client's lesson id simply returns nothing.
  if (!lesson?.storageKey) {
    throw new UploadError("No file here.", "not_found");
  }

  const bytes = await getObject(lesson.storageKey);
  const detected = detectMedia(bytes, lesson.filename ?? "file");

  return {
    bytes,
    // Served as what the bytes are, re-checked on the way out. If a stored
    // file were ever swapped, it still could not be served as something it is
    // not.
    mimeType: detected.ok ? detected.mimeType : "application/octet-stream",
    filename: lesson.filename ?? "file",
    safeToEmbed: detected.ok ? detected.safeToEmbed : false,
  };
}

export async function readEvidence(
  session: AuthenticatedSession,
  artifactId: string,
): Promise<ServableFile> {
  const artifact = await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({
        storageKey: evidenceArtifacts.storageKey,
        filename: evidenceArtifacts.filename,
        sha256: evidenceArtifacts.sha256,
        uploadedById: evidenceArtifacts.uploadedById,
        submissionUserId: assessmentSubmissions.userId,
      })
      .from(evidenceArtifacts)
      .innerJoin(
        assessmentSubmissions,
        eq(assessmentSubmissions.id, evidenceArtifacts.submissionId),
      )
      .where(eq(evidenceArtifacts.id, artifactId));
    return row;
  });

  if (!artifact) {
    throw new UploadError("No file here.", "not_found");
  }

  // Yours, or you hold the permission that lets an assessor, moderator or
  // external verifier read a portfolio.
  const isOwn = artifact.submissionUserId === session.userId;
  if (!isOwn && !can(session, "evidence:read_all")) {
    throw new UploadError(
      "That evidence belongs to somebody else.",
      "not_permitted",
    );
  }

  const bytes = await getObject(artifact.storageKey);
  const detected = detectMedia(bytes, artifact.filename);

  return {
    bytes,
    mimeType: detected.ok ? detected.mimeType : "application/octet-stream",
    filename: artifact.filename,
    safeToEmbed: detected.ok ? detected.safeToEmbed : false,
  };
}

/** Removes a file from a lesson, leaving the lesson itself in place. */
export async function removeLessonMedia(
  session: AuthenticatedSession,
  lessonId: string,
) {
  assertSessionCan(session, "course:author");

  await withTenant(session.organisationId, async (tx) => {
    const [lesson] = await tx
      .select({ courseStatus: courses.status })
      .from(lessons)
      .innerJoin(courseSections, eq(courseSections.id, lessons.sectionId))
      .innerJoin(courses, eq(courses.id, courseSections.courseId))
      .where(eq(lessons.id, lessonId));

    if (!lesson) {
      throw new UploadError("Lesson not found.", "not_found");
    }

    if (lesson.courseStatus === "published") {
      throw new UploadError(
        "This course is published. Create a new version to change its content.",
        "not_permitted",
      );
    }

    // The stored object is deliberately left in place. Detaching is a common
    // mistake and the file may be re-attached; storage is cheap and an
    // unrecoverable deletion is not.
    await tx
      .update(lessons)
      .set({
        storageKey: null,
        mediaMimeType: null,
        mediaFilename: null,
        mediaSizeBytes: null,
        mediaSha256: null,
        contentType: "text",
      })
      .where(and(eq(lessons.id, lessonId)));
  });
}

/**
 * A tenant's logo, uploaded rather than linked.
 *
 * Branding changes. A logo held as an address somewhere else on the web means
 * changing it requires somewhere to host the new one first, and it breaks
 * silently the day that host goes away — so the usual path is to upload the
 * file here and let the platform serve it.
 *
 * Images only, and small ones: a logo sits in a 36-pixel-high header, and a
 * tenant uploading a 10 MB photograph of their signage has made a mistake
 * worth telling them about rather than quietly accepting.
 */
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export async function uploadTenantLogo(
  session: AuthenticatedSession,
  file: { filename: string; bytes: Uint8Array },
): Promise<{ logoUrl: string; label: string; sizeBytes: number }> {
  assertSessionCan(session, "tenant:manage_branding");

  const detected = detectMedia(file.bytes, file.filename);
  if (!detected.ok) {
    throw new UploadError(detected.reason, "rejected");
  }
  if (detected.kind !== "image") {
    throw new UploadError(
      `A logo has to be an image. That file is ${detected.label.toLowerCase()}.`,
      "rejected",
    );
  }
  if (file.bytes.byteLength > LOGO_MAX_BYTES) {
    throw new UploadError(
      `That image is ${describeSize(file.bytes.byteLength)}. A logo is displayed small, so the limit is ${describeSize(LOGO_MAX_BYTES)}. A PNG with a transparent background works best.`,
      "too_large",
    );
  }

  const key = buildStorageKey(session.organisationId, "branding", file.filename);
  const stored = await putObject(key, file.bytes);

  // The served address carries the file's own hash, so a browser holding the
  // previous logo fetches the new one immediately rather than showing the old
  // one until its cache expires.
  const logoUrl = `/api/branding/logo?v=${stored.sha256.slice(0, 12)}`;

  await withTenant(session.organisationId, async (tx) => {
    const [before] = await tx
      .select({
        logoUrl: organisations.logoUrl,
        logoStorageKey: organisations.logoStorageKey,
      })
      .from(organisations)
      .where(eq(organisations.id, session.organisationId));

    await tx
      .update(organisations)
      .set({
        logoUrl,
        logoStorageKey: stored.storageKey,
        logoMimeType: detected.mimeType,
        updatedAt: new Date(),
      })
      .where(eq(organisations.id, session.organisationId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "tenant.logo_uploaded",
      entityType: "organisation",
      entityId: session.organisationId,
      before: { logoUrl: before?.logoUrl ?? null },
      after: { logoUrl, filename: file.filename, sha256: stored.sha256 },
    });
  });

  return { logoUrl, label: detected.label, sizeBytes: stored.sizeBytes };
}

/**
 * Serves a logo to anyone at all, including a browser that has not signed in —
 * the sign-in page itself carries the tenant's branding.
 *
 * That is safe only because the tenant is not named by the caller: it comes
 * from the hostname the request arrived on, resolved before this is called. So
 * there is no id to guess and nothing to enumerate, and the only thing on
 * offer is a logo its owner chose to display on a public page.
 */
export async function readTenantLogo(
  organisationId: string,
): Promise<ServableFile> {
  const org = await withTenant(organisationId, async (tx) => {
    const [row] = await tx
      .select({
        storageKey: organisations.logoStorageKey,
        mimeType: organisations.logoMimeType,
      })
      .from(organisations)
      .where(eq(organisations.id, organisationId));
    return row;
  });

  if (!org?.storageKey) {
    throw new UploadError("No logo here.", "not_found");
  }

  const bytes = await getObject(org.storageKey);
  const detected = detectMedia(bytes, "logo");

  // Re-checked on the way out, and refused unless it is still an image. A
  // stored file that was somehow swapped cannot be served as something else.
  if (!detected.ok || detected.kind !== "image") {
    throw new UploadError("No logo here.", "not_found");
  }

  return {
    bytes,
    mimeType: detected.mimeType,
    filename: "logo",
    safeToEmbed: detected.safeToEmbed,
  };
}
