import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import {
  availableCourses,
  enrollableForPath,
  getLearningPath,
  LearningPathError,
} from "@/lib/learning-paths";
import { AppShell, StatusBadge } from "@/components/app-shell";
import { PathEditor } from "./path-editor";

export default async function PathPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("course:read");

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
    </AppShell>
  );
}
