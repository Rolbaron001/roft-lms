/**
 * File type detection and uploads.
 *
 * This is a security boundary, not a convenience. Both the filename and the
 * content type a browser sends are supplied by whoever is uploading. If the
 * platform believed either, a file called `diagram.png` could contain HTML,
 * be served back as an image, and run as script inside an assessor's signed-in
 * session while they marked the learner's portfolio.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  competencies,
  competencyFrameworks,
  lessons,
  organisations,
  userRoles,
  users,
} from "@/db/schema";
import {
  addLesson,
  addSection,
  createCourse,
  publishCourse,
  tagCourseCompetency,
} from "@/lib/authoring";
import {
  detectMedia,
  extensionOf,
  lessonContentTypeFor,
  SIZE_LIMITS,
} from "@/lib/media";
import {
  readLessonMedia,
  removeLessonMedia,
  uploadLessonMedia,
  UploadError,
} from "@/lib/uploads";
import { PermissionDeniedError, permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

/** Minimal but genuine file headers. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const GIF = new Uint8Array([...Buffer.from("GIF89a"), 0x01, 0x00]);
const PDF = new Uint8Array([...Buffer.from("%PDF-1.7\n%âãÏÓ")]);
const MP4 = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, ...Buffer.from("ftypmp42"), 0x00, 0x00, 0x00, 0x00,
]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]);
const MP3 = new Uint8Array([...Buffer.from("ID3"), 0x03, 0x00, 0x00, 0x00]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
const WEBP = new Uint8Array([
  ...Buffer.from("RIFF"), 0x24, 0x00, 0x00, 0x00, ...Buffer.from("WEBP"),
]);

let organisationId: string;
let author: AuthenticatedSession;
let learner: AuthenticatedSession;
let lessonId: string;

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "test@example.test",
    firstName: "Test",
    lastName: "User",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
  };
}

function suffix() {
  return Math.random().toString(36).slice(2, 8);
}

beforeAll(async () => {
  const slug = `media-${Date.now()}`;

  const created = await withPlatformScope("media test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Media Test Co",
        status: "active",
      })
      .returning({ id: organisations.id });

    const [user] = await tx
      .insert(users)
      .values({
        organisationId: organisation.id,
        email: "author@media.test",
        firstName: "Ada",
        lastName: "Author",
        status: "active",
      })
      .returning({ id: users.id });

    await tx.insert(userRoles).values({
      organisationId: organisation.id,
      userId: user.id,
      role: "tenant_admin",
    });

    const [framework] = await tx
      .insert(competencyFrameworks)
      .values({ organisationId: organisation.id, name: "Framework" })
      .returning({ id: competencyFrameworks.id });

    const [competency] = await tx
      .insert(competencies)
      .values({
        organisationId: organisation.id,
        frameworkId: framework.id,
        code: "MED-01",
        name: "Test competency",
      })
      .returning({ id: competencies.id });

    return {
      organisationId: organisation.id,
      userId: user.id,
      competencyId: competency.id,
    };
  });

  organisationId = created.organisationId;
  author = sessionFor(["tenant_admin"], created.userId);
  learner = sessionFor(["learner"], created.userId);

  const course = await createCourse(author, { title: `Media ${suffix()}` });
  const section = await addSection(author, {
    courseId: course.id,
    title: "Section",
  });
  const lesson = await addLesson(author, {
    sectionId: section.id,
    title: "Lesson with a file",
  });
  lessonId = lesson.id;
});

afterAll(async () => {
  await withPlatformScope("media test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("recognising a file by its contents", () => {
  it.each([
    ["photo.png", PNG, "image/png", "image"],
    ["scan.jpg", JPEG, "image/jpeg", "image"],
    ["animation.gif", GIF, "image/gif", "image"],
    ["picture.webp", WEBP, "image/webp", "image"],
    ["handbook.pdf", PDF, "application/pdf", "document"],
    ["briefing.mp4", MP4, "video/mp4", "video"],
    ["recording.webm", WEBM, "video/webm", "video"],
    ["voiceover.mp3", MP3, "audio/mpeg", "audio"],
  ])("recognises %s", (filename, bytes, mimeType, kind) => {
    const result = detectMedia(bytes, filename);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mimeType).toBe(mimeType);
    expect(result.kind).toBe(kind);
  });

  /** Office formats share the ZIP container, so the extension separates them. */
  it.each([
    ["report.docx", "document"],
    ["deck.pptx", "slides"],
    ["figures.xlsx", "spreadsheet"],
    ["package.zip", "archive"],
  ])("tells %s apart inside its ZIP container", (filename, kind) => {
    const result = detectMedia(ZIP, filename);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe(kind);
  });

  it("refuses a ZIP with an extension it does not handle", () => {
    const result = detectMedia(ZIP, "something.jar");
    expect(result.ok).toBe(false);
  });
});

describe("files that lie about themselves", () => {
  /**
   * The attack this whole module exists to prevent: HTML wearing an image
   * extension, which would be served back as an image and run as a page.
   */
  it("refuses HTML named as a PNG", () => {
    const html = new Uint8Array(
      Buffer.from("<!DOCTYPE html><script>alert(1)</script>"),
    );
    const result = detectMedia(html, "innocent.png");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("scripts");
  });

  it("refuses an SVG, which can carry script", () => {
    const svg = new Uint8Array(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
    );
    const result = detectMedia(svg, "diagram.svg");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("SVG");
  });

  it("refuses an SVG hiding behind an XML declaration", () => {
    const svg = new Uint8Array(
      Buffer.from('<?xml version="1.0"?><svg onload="alert(1)"></svg>'),
    );
    expect(detectMedia(svg, "chart.png").ok).toBe(false);
  });

  it("refuses a Windows executable however it is named", () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    expect(detectMedia(exe, "handbook.pdf").ok).toBe(false);
  });

  it("refuses binary content wearing a .txt extension", () => {
    const binary = new Uint8Array([0x00, 0x01, 0x02, 0x00, 0x03]);
    expect(detectMedia(binary, "notes.txt").ok).toBe(false);
  });

  it("accepts genuine text", () => {
    const text = new Uint8Array(Buffer.from("Lesson notes for week one."));
    const result = detectMedia(text, "notes.txt");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mimeType).toBe("text/plain");
  });

  it("refuses an empty file", () => {
    expect(detectMedia(new Uint8Array(), "empty.png").ok).toBe(false);
  });

  it("refuses something it simply does not know", () => {
    const nonsense = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);
    expect(detectMedia(nonsense, "mystery.bin").ok).toBe(false);
  });
});

describe("what may be shown inline", () => {
  it("allows images, video, audio and PDF to render in the page", () => {
    for (const [bytes, name] of [
      [PNG, "a.png"],
      [MP4, "a.mp4"],
      [MP3, "a.mp3"],
      [PDF, "a.pdf"],
    ] as const) {
      const result = detectMedia(bytes, name);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.safeToEmbed).toBe(true);
    }
  });

  /** Office formats download; no browser renders them anyway. */
  it("sends Office documents as downloads", () => {
    const result = detectMedia(ZIP, "deck.pptx");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.safeToEmbed).toBe(false);
  });
});

describe("helpers", () => {
  it("reads an extension, including from an awkward name", () => {
    expect(extensionOf("report.final.v2.PDF")).toBe("pdf");
    expect(extensionOf("noextension")).toBe("");
  });

  it("maps a detected kind onto a lesson content type", () => {
    expect(lessonContentTypeFor("video")).toBe("video");
    expect(lessonContentTypeFor("image")).toBe("image");
    expect(lessonContentTypeFor("slides")).toBe("slide_deck");
    expect(lessonContentTypeFor("archive")).toBe("scorm");
    expect(lessonContentTypeFor("spreadsheet")).toBe("document");
  });

  it("allows video far more room than a diagram", () => {
    expect(SIZE_LIMITS.video).toBeGreaterThan(SIZE_LIMITS.image * 10);
  });
});

describe("attaching a file to a lesson", () => {
  it("stores it and sets the lesson type to match", async () => {
    const stored = await uploadLessonMedia(author, lessonId, {
      filename: "briefing.mp4",
      bytes: MP4,
    });

    expect(stored.kind).toBe("video");
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);

    const [row] = await withTenant(organisationId, (tx) =>
      tx.select().from(lessons).where(eq(lessons.id, lessonId)),
    );

    // A file uploaded to a lesson marked "text" corrects the lesson rather
    // than rendering as nothing.
    expect(row.contentType).toBe("video");
    expect(row.mediaMimeType).toBe("video/mp4");
    expect(row.mediaFilename).toBe("briefing.mp4");
  });

  it("refuses a file it cannot identify", async () => {
    await expect(
      uploadLessonMedia(author, lessonId, {
        filename: "trojan.png",
        bytes: new Uint8Array(Buffer.from("<html><script>x</script>")),
      }),
    ).rejects.toBeInstanceOf(UploadError);
  });

  it("refuses a file over the limit for its kind", async () => {
    // An "image" larger than the image ceiling, but well under the video one.
    const huge = new Uint8Array(SIZE_LIMITS.image + 1024);
    huge.set(PNG, 0);

    await expect(
      uploadLessonMedia(author, lessonId, { filename: "huge.png", bytes: huge }),
    ).rejects.toMatchObject({ code: "too_large" });
  });

  it("stops a learner uploading course material", async () => {
    await expect(
      uploadLessonMedia(learner, lessonId, {
        filename: "mine.png",
        bytes: PNG,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("reads the file back with the type its contents say", async () => {
    await uploadLessonMedia(author, lessonId, {
      filename: "handbook.pdf",
      bytes: PDF,
    });

    const file = await readLessonMedia(author, lessonId);
    expect(file.mimeType).toBe("application/pdf");
    expect(file.safeToEmbed).toBe(true);
    expect(file.bytes.length).toBe(PDF.length);
  });

  it("detaches without deleting the stored file", async () => {
    await uploadLessonMedia(author, lessonId, {
      filename: "picture.png",
      bytes: PNG,
    });
    await removeLessonMedia(author, lessonId);

    const [row] = await withTenant(organisationId, (tx) =>
      tx.select().from(lessons).where(eq(lessons.id, lessonId)),
    );

    expect(row.storageKey).toBeNull();
    expect(row.contentType).toBe("text");

    await expect(readLessonMedia(author, lessonId)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  /**
   * A published course is what learners were assessed against. Swapping a
   * video underneath them would change it after the fact.
   */
  it("refuses to change a file on a published course", async () => {
    const course = await createCourse(author, { title: `Locked ${suffix()}` });
    const section = await addSection(author, {
      courseId: course.id,
      title: "Section",
    });
    const lesson = await addLesson(author, {
      sectionId: section.id,
      title: "Lesson",
    });

    const framework = await withTenant(organisationId, (tx) =>
      tx.select({ id: competencies.id }).from(competencies).limit(1),
    );
    await tagCourseCompetency(author, course.id, framework[0].id);

    const published = await publishCourse(author, course.id);
    expect(published.ok).toBe(true);

    await expect(
      uploadLessonMedia(author, lesson.id, {
        filename: "swapped.mp4",
        bytes: MP4,
      }),
    ).rejects.toMatchObject({ code: "not_permitted" });
  });
});

describe("reading somebody else's file", () => {
  /**
   * Tenant separation for stored files. The storage key begins with the
   * organisation id, but a key is only a name — the check that matters is on
   * the database record, which row-level security already scopes.
   */
  it("does not serve a lesson file from another organisation", async () => {
    const otherSlug = `mediaother-${Date.now()}`;

    const other = await withPlatformScope("media isolation setup", async (tx) => {
      const [organisation] = await tx
        .insert(organisations)
        .values({
          slug: otherSlug,
          legalName: `${otherSlug} Ltd`,
          displayName: "Other Co",
          status: "active",
        })
        .returning({ id: organisations.id });

      const [user] = await tx
        .insert(users)
        .values({
          organisationId: organisation.id,
          email: "author@other.test",
          firstName: "Other",
          lastName: "Author",
          status: "active",
        })
        .returning({ id: users.id });

      await tx.insert(userRoles).values({
        organisationId: organisation.id,
        userId: user.id,
        role: "tenant_admin",
      });

      return { organisationId: organisation.id, userId: user.id };
    });

    await uploadLessonMedia(author, lessonId, {
      filename: "private.pdf",
      bytes: PDF,
    });

    const outsider: AuthenticatedSession = {
      sessionId: "00000000-0000-0000-0000-000000000000",
      userId: other.userId,
      organisationId: other.organisationId,
      email: "author@other.test",
      firstName: "Other",
      lastName: "Author",
      roles: ["tenant_admin"],
      permissions: permissionsFor({ roles: ["tenant_admin"] }),
      mustChangePassword: false,
    };

    // Knowing the lesson id is not enough; it belongs to another tenant.
    await expect(readLessonMedia(outsider, lessonId)).rejects.toMatchObject({
      code: "not_found",
    });

    await withPlatformScope("media isolation teardown", (tx) =>
      tx
        .delete(organisations)
        .where(eq(organisations.id, other.organisationId)),
    );
  });
});
