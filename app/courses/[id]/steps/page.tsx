import Link from "next/link";
import { notFound } from "next/navigation";
import { pageLocale, requirePermission, requireTenant } from "@/lib/request";
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
  const { t, locale } = await pageLocale();
  const words = vocabulary(tenant.terminology, tenant.featureFlags, locale);

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
        <h1 className="mt-2 text-xl font-semibold">{t("spine.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          {t("spine.intro", { course: words.lowerOne("course") })}
        </p>
        {spine.studyUnit ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            {t("spine.delivers", { code: spine.studyUnit.code, title: spine.studyUnit.title })}
          </p>
        ) : null}
      </div>

      <SpineEditor spine={spine} />
    </AppShell>
  );
}
