import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import { extensionOffered, extensionState } from "@/lib/extensions";
import { FolderPicker } from "@/components/folder-picker";
import {
  availableCourses,
  enrollableForPath,
  getLearningPath,
  LearningPathError,
} from "@/lib/learning-paths";
import { AppShell, Card, StatusBadge } from "@/components/app-shell";
import { PathEditor } from "./path-editor";

export default async function PathPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("course:read");

  const canAuthorHere = session.permissions.includes("course:author");
  const extension = await extensionState(session);
  const mayUseExtension = extensionOffered() ? extension : null;

  let detail;
  try {
    detail = await getLearningPath(session, id);
  } catch (error) {
    if (error instanceof LearningPathError && error.code === "not_found") {
      notFound();
    }
    throw error;
  }

  const canAuthor = session.permissions.includes("course:author");
  const canEnrol = session.permissions.includes("enrolment:manage");

  const [addable, people] = await Promise.all([
    canAuthor ? availableCourses(session, id) : Promise.resolve([]),
    canEnrol && session.permissions.includes("user:read")
      ? enrollableForPath(session)
      : Promise.resolve([]),
  ]);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href="/paths"
          className="text-sm text-[var(--muted)] hover:underline"
        >
          ← All programmes
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{detail.path.title}</h1>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--muted)]">
              {detail.enrolled}{" "}
              {detail.enrolled === 1 ? "person on it" : "people on it"}
            </span>
            <StatusBadge status={detail.path.status} />
          </div>
        </div>
        {detail.path.description ? (
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            {detail.path.description}
          </p>
        ) : null}
      </div>

      <PathEditor
        pathId={id}
        status={detail.path.status}
        steps={detail.steps.map((step) => ({
          courseId: step.courseId,
          title: step.title,
          status: step.status,
          requiresPrevious: step.requiresPrevious === 1,
        }))}
        addableCourses={addable}
        people={people.map((person) => ({
          id: person.id,
          label: `${person.firstName} ${person.lastName} — ${person.email}`,
        }))}
        canAuthor={canAuthor}
        canPublish={session.permissions.includes("course:publish")}
        canEnrol={canEnrol}
      />
      {canAuthorHere ? (
        <div className="mb-6">
          <Card
            title="Add documents from a folder"
            description="Choose the folder this programme's material lives in and everything in it — including its subfolders — is read, filed and indexed. You see what it would file before anything is written."
          >
            <FolderPicker
              learningPathId={id}
              label="The programme's folder, from your own computer"
              extension={
                mayUseExtension
                  ? {
                      enabled: extension.enabled,
                      available: extension.availability?.available ?? false,
                      reason: extension.availability?.reason ?? null,
                    }
                  : null
              }
              hint={
                <>
                  Guides, workbooks, policies and templates are filed against
                  this programme and their text indexed so they can be searched.
                  <br />
                  Structure is not created from here: the programme&rsquo;s own
                  shape is built by adding courses to it below. This files what it holds.
                </>
              }
            />
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
