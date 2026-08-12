import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  assessmentSubmissions,
  courseSections,
  courses,
  evidenceArtifacts,
  lessons,
} from "@/db/schema";
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

  await withTenant(session.organisationId, async (tx) => {
    await tx
      .update(lessons)
      .set({
        storageKey: stored.storageKey,
        mediaMimeType: stored.mimeType,
        mediaFilename: stored.filename,
        mediaSizeBytes: stored.sizeBytes,
        mediaSha256: stored.sha256,
        contentType: lessonContentTypeFor(stored.kind) as "video",
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
      },
    });
  });

  return stored;
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
