import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import { withTenant } from "@/db/client";
import {
  courseSections,
  courses,
  enrolments,
  lessons,
  scormAttempts,
  scormPackages,
  users,
} from "@/db/schema";
import { markLessonComplete } from "./enrolment";
import { can } from "./rbac";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { getObject, putObject } from "./storage";

/**
 * SCORM content: a course package made in another authoring tool, played in a
 * lesson. Job sheet D8, 27 September 2026.
 *
 * SCORM 1.2 first, the version most existing course libraries are in. A
 * package is a zip with an `imsmanifest.xml` at its root naming the file to
 * start from. It is unpacked into storage when uploaded, served file by file
 * from the platform's own address, and played in a frame whose page offers the
 * SCORM 1.2 connection (`window.API`) the package looks for. What the package
 * reports, its status, score, bookmark and saved state, is kept against the
 * learner; "completed" or "passed" completes the lesson, through the same
 * function as the Mark as complete button, so gating, progress and the record
 * all follow.
 *
 * Checked against the published run-time reference on 27 September, not
 * recalled: the eight API calls, the cmi.core elements and their values, and
 * the error codes (components/scorm-player.tsx).
 *
 * A package's own scripts run on the platform's address with the learner's
 * access, as they do in any learning system that plays SCORM. Only people who
 * author courses can upload one, and the upload screen says to use packages
 * from a source the provider trusts.
 */

export class ScormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScormError";
  }
}

/** Far past any real course; a zip that unpacks larger is refused as a zip bomb would be. */
const MAX_UNPACKED_BYTES = 1024 * 1024 * 1024;
const MAX_FILES = 10_000;

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

export type Manifest = {
  version: "1.2";
  title: string | null;
  launchPath: string;
  scoCount: number;
  launchData: string | null;
  masteryScore: number | null;
};

/** Attributes of one tag, whatever namespace prefix it carries. */
function attributes(tag: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    found[match[1].toLowerCase().replace(/^.*:/, "")] = match[3] ?? match[4] ?? "";
  }
  return found;
}

function tags(xml: string, name: string): { tag: string; inner: string }[] {
  const pattern = new RegExp(`<(?:[\\w-]+:)?${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`, "gi");
  return [...xml.matchAll(pattern)].map((m) => ({ tag: m[1] ?? "", inner: m[2] ?? "" }));
}

function textOf(xml: string, name: string): string | null {
  const [first] = tags(xml, name);
  if (!first) return null;
  const text = first.inner.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim();
  return text || null;
}

/**
 * Reads what the platform needs from `imsmanifest.xml`.
 *
 * By pattern rather than a full XML parser: a manifest is machine-written and
 * regular, and the platform needs five things from it. What it cannot use, it
 * refuses with the reason rather than playing something wrong.
 */
export function readManifest(xml: string): Manifest {
  const version = (textOf(xml, "schemaversion") ?? "").toLowerCase();
  if (/2004|cam 1\.3|1\.3/.test(version)) {
    throw new ScormError("This is a SCORM 2004 package. The platform plays SCORM 1.2 packages so far; 2004 is next. Most authoring tools can publish as SCORM 1.2 instead.");
  }
  if (version && !version.startsWith("1.2")) {
    throw new ScormError(`The manifest says it is "${version}", which is not SCORM 1.2.`);
  }

  const resources = new Map(
    tags(xml, "resource").map(({ tag, inner }) => {
      const attrs = attributes(tag);
      return [attrs.identifier, { href: attrs.href ?? "", type: (attrs.scormtype ?? "").toLowerCase(), inner }];
    }),
  );

  const organizations = tags(xml, "organizations")[0];
  const defaultId = organizations ? attributes(organizations.tag).default : undefined;
  const organization =
    tags(organizations?.inner ?? xml, "organization").find(({ tag }) => attributes(tag).identifier === defaultId) ??
    tags(organizations?.inner ?? xml, "organization")[0];

  const items = tags(organization?.inner ?? "", "item")
    .map(({ tag, inner }) => ({ attrs: attributes(tag), inner }))
    .filter(({ attrs }) => attrs.identifierref && resources.get(attrs.identifierref)?.href);
  const scos = items.filter(({ attrs }) => resources.get(attrs.identifierref)?.type !== "asset");
  const first = scos[0] ?? items[0];

  const resource = first ? resources.get(first.attrs.identifierref) : [...resources.values()].find((r) => r.href);
  if (!resource?.href) {
    throw new ScormError("The manifest names no file to start the package from.");
  }

  const [path, query] = resource.href.split("?");
  const launchPath = normalise(path + (first?.attrs.parameters ?? ""));
  if (!launchPath) throw new ScormError("The manifest's starting file is not inside the package.");

  const mastery = first ? textOf(first.inner, "masteryscore") : null;
  return {
    version: "1.2",
    title: textOf(organization?.inner ?? "", "title"),
    launchPath: query ? `${launchPath}?${query}` : launchPath,
    scoCount: Math.max(1, scos.length),
    launchData: first ? textOf(first.inner, "datafromlms") : null,
    masteryScore: mastery !== null && Number.isFinite(Number(mastery)) ? Number(mastery) : null,
  };
}

/**
 * A path inside the package, or null if it would leave it. Forward slashes,
 * no leading slash, no "..": a zip entry named "../../x" must not land
 * anywhere but inside the package.
 */
export function normalise(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") return null;
    parts.push(part);
  }
  return parts.length ? parts.join("/") : null;
}

// ---------------------------------------------------------------------------
// Unpacking
// ---------------------------------------------------------------------------

/**
 * Unpacks a lesson's SCORM package into storage and records it.
 *
 * Returns null for a zip that is not a SCORM package (no manifest at its
 * root), which the upload then keeps as an ordinary download. Called by
 * `uploadLessonMedia`, which has already checked who may change the lesson.
 */
export async function installScormPackage(
  organisationId: string,
  lessonId: string,
  zip: Uint8Array,
): Promise<(Manifest & { fileCount: number }) | null> {
  let unpackedBytes = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip, {
      filter: (file) => {
        unpackedBytes += file.originalSize;
        if (unpackedBytes > MAX_UNPACKED_BYTES) {
          throw new ScormError("The package unpacks to more than a gigabyte, which is more than a course needs.");
        }
        return !file.name.endsWith("/");
      },
    });
  } catch (error) {
    if (error instanceof ScormError) throw error;
    throw new ScormError("The zip could not be opened. It may be damaged; export it again from the authoring tool.");
  }

  const manifestName = Object.keys(entries).find((name) => name.toLowerCase() === "imsmanifest.xml");
  if (!manifestName) {
    if (Object.keys(entries).some((name) => name.toLowerCase().endsWith("cmi5.xml"))) {
      throw new ScormError("This is a cmi5 package. The platform plays SCORM 1.2 packages so far; cmi5 comes after SCORM 2004.");
    }
    return null;
  }

  const files = Object.entries(entries);
  if (files.length > MAX_FILES) throw new ScormError(`The package has ${files.length} files, more than the ${MAX_FILES} allowed.`);

  const manifest = readManifest(new TextDecoder().decode(entries[manifestName]));
  const launchFile = manifest.launchPath.split("?")[0];
  if (!files.some(([name]) => normalise(name) === launchFile)) {
    throw new ScormError(`The manifest starts the package at "${launchFile}", which is not in the zip.`);
  }

  // A fresh folder for each upload, so a replaced package never mixes with the old one.
  const storagePrefix = `${organisationId}/scorm/${lessonId}/${randomUUID()}/`;
  for (const [name, bytes] of files) {
    const path = normalise(name);
    if (!path) throw new ScormError(`The zip holds "${name}", a path that would leave the package.`);
    await putObject(storagePrefix + path, bytes, contentTypeFor(path));
  }

  await withTenant(organisationId, async (tx) => {
    await tx.delete(scormPackages).where(eq(scormPackages.lessonId, lessonId));
    await tx.insert(scormPackages).values({
      organisationId,
      lessonId,
      version: manifest.version,
      title: manifest.title,
      launchPath: manifest.launchPath,
      storagePrefix,
      fileCount: files.length,
      scoCount: manifest.scoCount,
      launchData: manifest.launchData,
      masteryScore: manifest.masteryScore !== null ? String(manifest.masteryScore) : null,
    });
  });

  return { ...manifest, fileCount: files.length };
}

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  xml: "application/xml",
  xsd: "application/xml",
  txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  pdf: "application/pdf",
  vtt: "text/vtt",
};

export function contentTypeFor(path: string): string {
  return TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------

/**
 * The lesson's package, and whether this person may open it: somebody who
 * can read courses, or a learner enrolled on the lesson's course.
 */
async function packageFor(session: AuthenticatedSession, lessonId: string) {
  return withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({ pkg: scormPackages, courseId: courseSections.courseId })
      .from(scormPackages)
      .innerJoin(lessons, eq(lessons.id, scormPackages.lessonId))
      .innerJoin(courseSections, eq(courseSections.id, lessons.sectionId))
      .where(eq(scormPackages.lessonId, lessonId));
    if (!row) throw new ScormError("This lesson has no SCORM package.");

    if (!can(session, "course:author") && !can(session, "enrolment:read_all")) {
      const [enrolled] = await tx
        .select({ id: enrolments.id })
        .from(enrolments)
        .where(and(eq(enrolments.userId, session.userId), eq(enrolments.courseId, row.courseId)))
        .limit(1);
      if (!enrolled) throw new ScormError("This lesson is not on a course you are enrolled on.");
    }
    return row.pkg;
  });
}

/** One file of a lesson's package, for the browser. */
export async function readScormFile(session: AuthenticatedSession, lessonId: string, path: string) {
  const inside = normalise(path);
  if (!inside) throw new ScormError("Not found.");
  const pkg = await packageFor(session, lessonId);
  try {
    return { bytes: await getObject(pkg.storagePrefix + inside), contentType: contentTypeFor(inside) };
  } catch {
    throw new ScormError("Not found.");
  }
}

/** What the player starts from: the package, and the learner's saved progress. */
export type ScormLaunch = {
  launchUrl: string;
  initial: {
    studentId: string;
    studentName: string;
    lessonStatus: string;
    lessonLocation: string;
    suspendData: string;
    scoreRaw: string;
    entry: "ab-initio" | "resume" | "";
    credit: "credit" | "no-credit";
    launchData: string;
    totalTime: string;
  };
  /** Whether what the package reports is kept. Only the enrolled learner's is. */
  records: boolean;
};

/** SCORM 1.2 time: HHHH:MM:SS.SS. */
export function scormTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(4, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.00`;
}

export function secondsIn(time: string): number {
  const match = /^(\d{2,4}):(\d{2}):(\d{2})(\.\d{1,2})?$/.exec(time.trim());
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Math.round(Number(match[3] + (match[4] ?? "")));
}

export async function scormLaunch(
  session: AuthenticatedSession,
  lessonId: string,
  enrolmentId: string | null,
): Promise<ScormLaunch> {
  const pkg = await packageFor(session, lessonId);
  return withTenant(session.organisationId, async (tx) => {
    const [enrolment] = enrolmentId
      ? await tx.select().from(enrolments).where(eq(enrolments.id, enrolmentId))
      : [];
    const records = Boolean(enrolment && enrolment.userId === session.userId && enrolment.status !== "withdrawn");
    const [attempt] = records
      ? await tx
          .select()
          .from(scormAttempts)
          .where(and(eq(scormAttempts.enrolmentId, enrolmentId!), eq(scormAttempts.lessonId, lessonId)))
      : [];
    const [person] = await tx
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, session.userId));

    return {
      launchUrl: `/api/scorm/${lessonId}/content/${pkg.launchPath}`,
      records,
      initial: {
        studentId: session.userId,
        // SCORM 1.2 asks for "last, first".
        studentName: `${person?.lastName ?? ""}, ${person?.firstName ?? ""}`,
        lessonStatus: attempt?.lessonStatus ?? "not attempted",
        lessonLocation: attempt?.lessonLocation ?? "",
        suspendData: attempt?.suspendData ?? "",
        scoreRaw: attempt?.scoreRaw ?? "",
        entry: !attempt ? "ab-initio" : attempt.exitMode === "suspend" ? "resume" : "",
        credit: records ? "credit" : "no-credit",
        launchData: pkg.launchData ?? "",
        totalTime: scormTime(attempt?.totalSeconds ?? 0),
      },
    };
  });
}

const STATUSES = ["passed", "completed", "failed", "incomplete", "browsed", "not attempted"] as const;

export type ScormReport = {
  lessonStatus?: string;
  scoreRaw?: string;
  scoreMin?: string;
  scoreMax?: string;
  lessonLocation?: string;
  suspendData?: string;
  exit?: string;
  sessionTime?: string;
  /** True when the package called LMSFinish; its session time is then added. */
  finished?: boolean;
};

function decimal(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : null;
}

/**
 * Keeps what the package reported for this learner, and completes the lesson
 * when it reports completed or passed.
 *
 * Only the learner's own enrolment. Where the manifest set a mastery score and
 * the package reported a score, the score decides passed or failed, as SCORM
 * 1.2 lets a learning system do.
 */
export async function saveScormReport(
  session: AuthenticatedSession,
  lessonId: string,
  enrolmentId: string,
  report: ScormReport,
): Promise<{ lessonStatus: string; completed: boolean }> {
  assertSessionCan(session, "enrolment:read_own");
  const pkg = await packageFor(session, lessonId);

  const saved = await withTenant(session.organisationId, async (tx) => {
    const [enrolment] = await tx
      .select({ userId: enrolments.userId, courseId: enrolments.courseId, status: enrolments.status })
      .from(enrolments)
      .where(eq(enrolments.id, enrolmentId));
    if (!enrolment || enrolment.userId !== session.userId) {
      throw new ScormError("Only the learner's own progress is kept.");
    }
    const [inCourse] = await tx
      .select({ id: lessons.id })
      .from(lessons)
      .innerJoin(courseSections, eq(courseSections.id, lessons.sectionId))
      .innerJoin(courses, eq(courses.id, courseSections.courseId))
      .where(and(eq(lessons.id, lessonId), eq(courses.id, enrolment.courseId!)));
    if (!inCourse) throw new ScormError("That lesson is not part of this course.");

    const [current] = await tx
      .select()
      .from(scormAttempts)
      .where(and(eq(scormAttempts.enrolmentId, enrolmentId), eq(scormAttempts.lessonId, lessonId)));

    let status = STATUSES.includes(report.lessonStatus as (typeof STATUSES)[number])
      ? report.lessonStatus!
      : (current?.lessonStatus ?? "incomplete");
    const raw = decimal(report.scoreRaw) ?? current?.scoreRaw ?? null;
    if (pkg.masteryScore !== null && raw !== null && ["completed", "incomplete", "passed", "failed"].includes(status)) {
      status = Number(raw) >= Number(pkg.masteryScore) ? "passed" : "failed";
    }

    const values = {
      lessonStatus: status,
      scoreRaw: raw,
      scoreMin: decimal(report.scoreMin) ?? current?.scoreMin ?? null,
      scoreMax: decimal(report.scoreMax) ?? current?.scoreMax ?? null,
      lessonLocation: report.lessonLocation?.slice(0, 255) ?? current?.lessonLocation ?? null,
      suspendData: report.suspendData?.slice(0, 64_000) ?? current?.suspendData ?? null,
      exitMode: report.exit ?? current?.exitMode ?? null,
      totalSeconds:
        (current?.totalSeconds ?? 0) + (report.finished && report.sessionTime ? secondsIn(report.sessionTime) : 0),
      updatedAt: new Date(),
    };
    if (current) {
      await tx.update(scormAttempts).set(values).where(eq(scormAttempts.id, current.id));
    } else {
      await tx.insert(scormAttempts).values({
        organisationId: session.organisationId,
        lessonId,
        enrolmentId,
        userId: session.userId,
        ...values,
      });
    }
    return { status };
  });

  const completed = saved.status === "passed" || saved.status === "completed";
  if (completed) {
    // The same completion as the button: step gating, progress and the
    // record. Safe to repeat, so a completion refused once (a step not yet
    // open) is recorded the next time the package reports.
    await markLessonComplete(session, enrolmentId, lessonId);
  }
  return { lessonStatus: saved.status, completed };
}
