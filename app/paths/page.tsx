import Link from "next/link";
import { requireCapability, requirePermission } from "@/lib/request";
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
  const words = vocabulary(tenant.terminology, tenant.featureFlags);
  const session = await requirePermission("course:read");
  const paths = await listLearningPaths(session);

  const canAuthor = session.permissions.includes("course:author");
  const view = (await searchParams).view === "add" ? "add" : "list";

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{words.many("programme")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Several courses chained into a sequence — a new starter programme, or
          a full competency framework roll-out. A learner is given the next
          course automatically as they finish the one before it.
        </p>
      </div>

      {canAuthor ? (
        <ViewTabs
          basePath="/paths"
          current={view}
          tabs={[
            { id: "list", label: words.many("programme"), count: paths.length },
            { id: "add", label: `New ${words.one("programme").toLowerCase()}` },
          ]}
        />
      ) : null}

      {view === "add" && canAuthor ? (
        <NewPathForm />
      ) : (
        <>
          {paths.length === 0 ? (
            <EmptyState title={`No ${words.many("programme").toLowerCase()} yet`}>
              {canAuthor ? (
                <p>
                  A programme chains courses into an order, so a learner is
                  given the next one as they finish the one before. Build the
                  courses first — a programme is a sequence of them.
                </p>
              ) : (
                <p>
                  None has been built yet. When one has been, the courses you
                  work through in order will be here. Building one is an
                  author&rsquo;s job.
                </p>
              )}
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
                      No courses in it yet — a learner given this programme
                      would receive nothing. Open it to add some.
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
