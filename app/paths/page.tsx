import Link from "next/link";
import { pageLocale, requireCapability, requirePermission } from "@/lib/request";
import { listLearningPaths } from "@/lib/learning-paths";
import { AppShell, StatusBadge } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { ViewTabs } from "@/components/view-tabs";
import { NewPathForm } from "./new-path-form";
import { vocabulary } from "@/lib/terms";

/**
 * Programmes: the ones that exist, and making another.
 *
 * The same untangling Roland asked for on Qualifications on 19 September -
 * "a list of available programmes is pushed in-between the creation and upload
 * processes. Let's untangle the screens please." This screen had it in the
 * other order, which is the same fault: a list, and then a form for making
 * another underneath it, so neither job had a screen of its own and the empty
 * state could only say "Create one below".
 *
 * "Below" is not a direction. It is now a tab and a button that goes there.
 */
export default async function PathsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const tenant = await requireCapability("programmes");
  const { t, locale } = await pageLocale();
  const words = vocabulary(tenant.terminology, tenant.featureFlags, locale);
  const session = await requirePermission("course:read");
  const named = {
    course: words.lowerOne("course"),
    courses: words.lowerMany("course"),
    programme: words.lowerOne("programme"),
    programmes: words.lowerMany("programme"),
  };
  const paths = await listLearningPaths(session);

  const canAuthor = session.permissions.includes("course:author");
  const view = (await searchParams).view === "add" ? "add" : "list";

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{words.many("programme")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("paths.intro", named)}</p>
      </div>

      {canAuthor ? (
        <ViewTabs
          basePath="/paths"
          current={view}
          tabs={[
            { id: "list", label: words.many("programme"), count: paths.length },
            { id: "add", label: t("paths.new", named) },
          ]}
        />
      ) : null}

      {view === "add" && canAuthor ? (
        <NewPathForm heading={t("paths.new", named)} />
      ) : (
        <>
          {paths.length === 0 ? (
            <EmptyState title={t("paths.none", named)}>
              {canAuthor ? <p>{t("paths.noneAuthor", named)}</p> : <p>{t("paths.noneReader", named)}</p>}
            </EmptyState>
          ) : (
            <div className="space-y-3">
              {paths.map((path) => (
                <Link
                  key={path.id}
                  href={`/paths/${path.id}`}
                  className="block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-[var(--brand-accent)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{path.title}</p>
                      {path.description ? (
                        <p className="mt-1 line-clamp-2 text-sm text-[var(--muted)]">
                          {path.description}
                        </p>
                      ) : null}
                    </div>
                    <StatusBadge status={path.status} />
                  </div>

                  {path.steps.length > 0 ? (
                    <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
                      {path.steps.map((step, index) => (
                        <li
                          key={step.courseId}
                          className="flex items-center gap-2"
                        >
                          {index > 0 ? (
                            <span aria-hidden className="opacity-50">
                              →
                            </span>
                          ) : null}
                          <span>{step.courseTitle}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    /*
                      Said with what to do about it, not merely stated. A
                      programme with no courses delivers nothing, and this is
                      the screen somebody is on when they could fix it.
                    */
                    <p className="mt-3 text-xs" style={{ color: "var(--danger)" }}>
                      {t("paths.empty", named)}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
