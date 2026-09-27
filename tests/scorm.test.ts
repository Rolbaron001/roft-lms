/**
 * SCORM 1.2 packages played in a lesson. Job sheet D8, 27 September 2026.
 *
 * The package is made here, the shape an authoring tool publishes: a zip with
 * imsmanifest.xml at its root naming the file to start from.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { withPlatformScope } from "@/db/client";
import {
  courseSections,
  courses,
  enrolments,
  lessons,
  organisations,
  progressRecords,
  scormAttempts,
  userRoles,
  users,
} from "@/db/schema";
import { installScormApi } from "@/components/scorm-player";
import { normalise, readManifest, readScormFile, saveScormReport, scormLaunch } from "@/lib/scorm";
import { uploadLessonMedia } from "@/lib/uploads";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

function manifest(options: { version?: string; mastery?: string; href?: string } = {}) {
  return `<?xml version="1.0"?>
<manifest identifier="demo" version="1.0" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>${options.version ?? "1.2"}</schemaversion></metadata>
  <organizations default="org1">
    <organization identifier="org1">
      <title>Fire safety basics</title>
      <item identifier="i1" identifierref="r1" isvisible="true">
        <title>Fire safety basics</title>
        ${options.mastery ? `<adlcp:masteryscore>${options.mastery}</adlcp:masteryscore>` : ""}
        <adlcp:datafromlms>unit=1</adlcp:datafromlms>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="r1" type="webcontent" adlcp:scormtype="sco" href="${options.href ?? "shared/index.html"}">
      <file href="shared/index.html"/>
    </resource>
  </resources>
</manifest>`;
}

function packageZip(options: Parameters<typeof manifest>[0] & { extra?: Record<string, Uint8Array> } = {}) {
  return zipSync({
    "imsmanifest.xml": strToU8(manifest(options)),
    "shared/index.html": strToU8("<html><body><script>/* the course */</script></body></html>"),
    "shared/style.css": strToU8("body{}"),
    ...(options.extra ?? {}),
  });
}

let organisationId: string;
const people: Record<string, AuthenticatedSession> = {};
const ids: Record<string, string> = {};

function sessionFor(userId: string, roles: Role[]): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "x@example.test",
    firstName: "X",
    lastName: "Y",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

async function newLesson(title: string) {
  return withPlatformScope("scorm test adds a lesson to its draft course", async (tx) => {
    const [lesson] = await tx
      .insert(lessons)
      .values({ organisationId, sectionId: ids.section, title })
      .returning({ id: lessons.id });
    return lesson.id;
  });
}

beforeAll(async () => {
  const slug = `scorm-${Date.now()}`;
  await withPlatformScope("scorm fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: "Package Provider", status: "active" })
      .returning({ id: organisations.id });
    organisationId = organisation.id;
    for (const [name, role] of [["author", "tenant_admin"], ["learner", "learner"], ["stranger", "learner"]] as [string, Role][]) {
      const [person] = await tx
        .insert(users)
        .values({ organisationId, email: `${name}-${slug}@example.test`, firstName: name, lastName: "Tester", status: "active" })
        .returning({ id: users.id });
      await tx.insert(userRoles).values({ organisationId, userId: person.id, role });
      people[name] = sessionFor(person.id, [role]);
    }
    const [course] = await tx
      .insert(courses)
      .values({ organisationId, title: "Safety", status: "draft" })
      .returning({ id: courses.id });
    const [section] = await tx
      .insert(courseSections)
      .values({ organisationId, courseId: course.id, title: "One" })
      .returning({ id: courseSections.id });
    const [enrolment] = await tx
      .insert(enrolments)
      .values({ organisationId, userId: people.learner.userId, courseId: course.id, status: "in_progress" })
      .returning({ id: enrolments.id });
    Object.assign(ids, { course: course.id, section: section.id, enrolment: enrolment.id });
  });
});

afterAll(async () => {
  await withPlatformScope("scorm teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

describe("reading a manifest", () => {
  it("finds the title, the starting file, the mastery score and the launch data", () => {
    expect(readManifest(manifest({ mastery: "80" }))).toEqual({
      version: "1.2",
      title: "Fire safety basics",
      launchPath: "shared/index.html",
      scoCount: 1,
      launchData: "unit=1",
      masteryScore: 80,
    });
  });

  it("refuses SCORM 2004 with the reason", () => {
    expect(() => readManifest(manifest({ version: "2004 4th Edition" }))).toThrow(/SCORM 2004/);
  });

  it("keeps every path inside the package", () => {
    expect(normalise("./shared//a.js")).toBe("shared/a.js");
    expect(normalise("../../etc/passwd")).toBeNull();
    expect(normalise("a/../../b")).toBeNull();
  });
});

describe("uploading a package", () => {
  it("unpacks it and makes the lesson a SCORM lesson", async () => {
    ids.lesson = await newLesson("Fire safety");
    const stored = await uploadLessonMedia(people.author, ids.lesson, { filename: "fire-safety.zip", bytes: packageZip({ mastery: "80" }) });
    expect(stored.scorm).toEqual({ title: "Fire safety basics", files: 3, parts: 1 });
    const [lesson] = await withPlatformScope("scorm test reads the lesson", (tx) =>
      tx.select({ contentType: lessons.contentType }).from(lessons).where(eq(lessons.id, ids.lesson)),
    );
    expect(lesson.contentType).toBe("scorm");
  });

  it("keeps a zip with no manifest as an ordinary download", async () => {
    const lessonId = await newLesson("Just files");
    await uploadLessonMedia(people.author, lessonId, { filename: "files.zip", bytes: zipSync({ "a.txt": strToU8("a") }) });
    const [lesson] = await withPlatformScope("scorm test reads the plain lesson", (tx) =>
      tx.select({ contentType: lessons.contentType }).from(lessons).where(eq(lessons.id, lessonId)),
    );
    expect(lesson.contentType).toBe("document");
  });

  it("refuses a SCORM 2004 package, and one whose starting file is missing", async () => {
    const lessonId = await newLesson("Refused");
    await expect(
      uploadLessonMedia(people.author, lessonId, { filename: "new.zip", bytes: packageZip({ version: "2004 3rd Edition" }) }),
    ).rejects.toThrow(/SCORM 2004/);
    await expect(
      uploadLessonMedia(people.author, lessonId, { filename: "broken.zip", bytes: packageZip({ href: "missing.html" }) }),
    ).rejects.toThrow(/not in the zip/);
  });
});

describe("playing it", () => {
  it("serves the package's files to the enrolled learner, and to nobody else", async () => {
    const file = await readScormFile(people.learner, ids.lesson, "shared/index.html");
    expect(file.contentType).toBe("text/html; charset=utf-8");
    expect(new TextDecoder().decode(file.bytes)).toContain("the course");
    await expect(readScormFile(people.stranger, ids.lesson, "shared/index.html")).rejects.toThrow(/not on a course/);
    await expect(readScormFile(people.learner, ids.lesson, "../imsmanifest.xml")).rejects.toThrow();
  });

  it("starts a first attempt from the beginning, with the learner's name as SCORM asks", async () => {
    const launch = await scormLaunch(people.learner, ids.lesson, ids.enrolment);
    expect(launch.launchUrl).toBe(`/api/scorm/${ids.lesson}/content/shared/index.html`);
    expect(launch.records).toBe(true);
    expect(launch.initial).toMatchObject({ entry: "ab-initio", studentName: "Tester, learner", credit: "credit", launchData: "unit=1" });
  });

  it("keeps the learner's place, and resumes from it", async () => {
    await saveScormReport(people.learner, ids.lesson, ids.enrolment, {
      lessonStatus: "incomplete",
      lessonLocation: "slide-4",
      suspendData: "abc",
      exit: "suspend",
      sessionTime: "0000:10:00.00",
      finished: true,
    });
    const launch = await scormLaunch(people.learner, ids.lesson, ids.enrolment);
    expect(launch.initial).toMatchObject({ entry: "resume", lessonLocation: "slide-4", suspendData: "abc", totalTime: "0000:10:00.00" });
  });

  it("lets the mastery score decide, and does not complete a failed attempt", async () => {
    const result = await saveScormReport(people.learner, ids.lesson, ids.enrolment, { lessonStatus: "completed", scoreRaw: "60" });
    expect(result).toEqual({ lessonStatus: "failed", completed: false });
  });

  it("completes the lesson when the package reports a pass", async () => {
    const result = await saveScormReport(people.learner, ids.lesson, ids.enrolment, { lessonStatus: "completed", scoreRaw: "85", finished: true, sessionTime: "0000:05:00" });
    expect(result).toEqual({ lessonStatus: "passed", completed: true });
    const [progress] = await withPlatformScope("scorm test reads progress", (tx) =>
      tx
        .select({ state: progressRecords.state })
        .from(progressRecords)
        .where(and(eq(progressRecords.enrolmentId, ids.enrolment), eq(progressRecords.lessonId, ids.lesson))),
    );
    expect(progress.state).toBe("completed");
    const [attempt] = await withPlatformScope("scorm test reads the attempt", (tx) =>
      tx.select().from(scormAttempts).where(eq(scormAttempts.enrolmentId, ids.enrolment)),
    );
    expect(attempt.totalSeconds).toBe(15 * 60);
  });

  it("keeps only the learner's own progress", async () => {
    await expect(
      saveScormReport(people.stranger, ids.lesson, ids.enrolment, { lessonStatus: "completed" }),
    ).rejects.toThrow();
  });
});

describe("the SCORM 1.2 connection the package talks to", () => {
  const launch = {
    launchUrl: "/x",
    records: false,
    initial: {
      studentId: "u1",
      studentName: "Tester, learner",
      lessonStatus: "not attempted",
      lessonLocation: "",
      suspendData: "",
      scoreRaw: "",
      entry: "ab-initio",
      credit: "credit",
      launchData: "",
      totalTime: "0000:00:00.00",
    },
  };

  it("answers as the run-time reference says", () => {
    const host: { API?: Record<string, (...args: string[]) => string> } = {};
    const remove = installScormApi(launch, "lesson", null, () => undefined, host);
    const api = host.API!;

    expect(api.LMSGetValue("cmi.core.student_name")).toBe("");
    expect(api.LMSGetLastError()).toBe("301");

    expect(api.LMSInitialize("")).toBe("true");
    expect(api.LMSGetValue("cmi.core.student_name")).toBe("Tester, learner");
    expect(api.LMSGetValue("cmi.core.entry")).toBe("ab-initio");

    expect(api.LMSSetValue("cmi.core.lesson_status", "done")).toBe("false");
    expect(api.LMSGetLastError()).toBe("405");
    expect(api.LMSSetValue("cmi.core.student_name", "Somebody")).toBe("false");
    expect(api.LMSGetLastError()).toBe("403");
    expect(api.LMSGetValue("cmi.core.exit")).toBe("");
    expect(api.LMSGetLastError()).toBe("404");
    expect(api.LMSGetValue("cmi.nonsense")).toBe("");
    expect(api.LMSGetLastError()).toBe("201");

    expect(api.LMSSetValue("cmi.core.lesson_status", "completed")).toBe("true");
    expect(api.LMSGetValue("cmi.core.lesson_status")).toBe("completed");
    expect(api.LMSSetValue("cmi.interactions.0.id", "q1")).toBe("true");
    expect(api.LMSGetErrorString("403")).toBe("Element is read only.");
    expect(api.LMSFinish("")).toBe("true");

    remove();
    expect(host.API).toBeUndefined();
  });
});
