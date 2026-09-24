import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import { courseSpine, SpineEditorError } from "@/lib/spine-editor";
import { vocabulary } from "@/lib/terms";
import { AppShell } from "@/components/app-shell";
import { SpineEditor } from "./spine-editor";

/**
 * The order a learner walks a course in.
 *
 * lib/spine.ts could do all of this from the first commit and nothing called
 * it. Four assessments were captured into 121151 and every one of them sat
 * unreachable, because there was no screen that could put anything in front of
 * anybody. This is that screen.
 */
export default async function CourseStepsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("course:author");
  const words = vocabulary(tenant.terminology);

  let spine;
  try {
    spine = await courseSpine(session, id);
  } catch (error) {
    if (error instanceof SpineEditorError) notFound();
    throw error;
  }

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href={`/courses/${id}`}
          className="text-sm text-[var(--muted)] hover:underline"
        >
          &larr; {spine.course.title}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">What a learner works through</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          The order this {words.one("course")} is walked in, and what holds each
          step shut until the one before it is done. Everything here is already
          held against this {words.one("course")}: putting it on the list is
          what makes a learner meet it.
        </p>
        {spine.studyUnit ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            Delivers {spine.studyUnit.code} {spine.studyUnit.title}.
          </p>
        ) : null}
      </div>

      <SpineEditor spine={spine} />
    </AppShell>
  );
}
