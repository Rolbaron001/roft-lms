import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import { extensionState } from "@/lib/extensions";
import { FolderPicker } from "@/components/folder-picker";
import {
  AuthoringError,
  coverageReport,
  getCourse,
  listCompetencies,
} from "@/lib/authoring";
import { AppShell, Card, StatusBadge } from "@/components/app-shell";
import { CourseEditor } from "./course-editor";

export default async function CoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("course:read");

  const canAuthorHere = session.permissions.includes("course:author");
  const extension = await extensionState(session);
  const mayUseExtension = extension.registered ? extension : null;

  let detail;
  try {
    detail = await getCourse(session, id);
  } catch (error) {
    if (error instanceof AuthoringError && error.code === "not_found") {
      notFound();
    }
    throw error;
  }

  const [report, allCompetencies] = await Promise.all([
    coverageReport(session, id),
    listCompetencies(session),
  ]);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href="/courses"
          className="text-sm text-[var(--muted)] hover:underline"
        >
          ← All courses
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{detail.course.title}</h1>
          <div className="flex items-center gap-3">
            {session.permissions.includes("assessment:author") ? (
              <Link
                href={`/courses/${id}/assessments`}
                className="text-sm font-medium text-[var(--brand-accent)] hover:underline"
              >
                Assessments
              </Link>
            ) : null}
            {session.permissions.includes("enrolment:read_all") ? (
              <Link
                href={`/courses/${id}/enrolments`}
                className="text-sm font-medium text-[var(--brand-accent)] hover:underline"
              >
                Who is on this course
              </Link>
            ) : null}
            {detail.course.version > 1 ? (
              <span className="text-xs text-[var(--muted)]">
                version {detail.course.version}
              </span>
            ) : null}
            <StatusBadge status={detail.course.status} />
          </div>
        </div>
        {detail.course.description ? (
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            {detail.course.description}
          </p>
        ) : null}
      </div>

      {detail.course.status === "published" ? (
        <Card>
          <p className="text-sm">
            This course is published, so its content is fixed. Learners who
            completed it have records that refer to exactly this version.
            {session.permissions.includes("course:author")
              ? " To change it, open a new version — the published one stays as it is."
              : ""}
          </p>
        </Card>
      ) : null}

      <div className="mt-6">
        <CourseEditor
          courseId={id}
          status={detail.course.status}
          sections={detail.sections.map((section) => ({
            id: section.id,
            title: section.title,
            lessons: section.lessons.map((lesson) => ({
              id: lesson.id,
              title: lesson.title,
              contentType: lesson.contentType,
              mediaFilename: lesson.mediaFilename,
              mediaMimeType: lesson.mediaMimeType,
            })),
          }))}
          taggedCompetencies={detail.competencies.map((row) => ({
            competencyId: row.competencyId,
            code: row.code,
            name: row.name,
          }))}
          availableCompetencies={allCompetencies.map((row) => ({
            id: row.id,
            code: row.code,
            name: row.name,
          }))}
          report={report}
          canAuthor={session.permissions.includes("course:author")}
          canPublish={session.permissions.includes("course:publish")}
        />
      </div>

      {canAuthorHere ? (
        <div className="mb-6">
          <Card
            title="Add documents from a folder"
            description="Choose the folder this course's material lives in and everything in it — including its subfolders — is read, filed and indexed. You see what it would file before anything is written."
          >
            <FolderPicker
              courseId={id}
              label="The course's folder, from your own computer"
              extension={
                mayUseExtension
                  ? {
                      on: extension.on,
                      available: extension.availability?.available ?? false,
                      reason: extension.availability?.reason ?? null,
                    }
                  : null
              }
              hint={
                <>
                  Guides, workbooks, policies and templates are filed against
                  this course and their text indexed so they can be searched.
                  <br />
                  Structure is not created from here: the course&rsquo;s own
                  shape is built in the editor below or from a qualification&rsquo;s modules. This files what it holds.
                </>
              }
            />
          </Card>
        </div>
      ) : null}

    </AppShell>
  );
}
