import Link from "next/link";
import { pageT, requireSession } from "@/lib/request";
import { COHORT_STEPS, cohortJourney, type CohortStepKey } from "@/lib/cohort-journey";
import { PageNav } from "./page-nav";

/**
 * The steps of setting up and running a cohort, on every page that belongs to
 * one, with what comes next (Roland, 8 October 2026: "we need to add
 * step-by-step navigation ... throughout the LMS"). The same idea as the
 * qualification's navigator: it floats at the top as the page scrolls, marks
 * where you are, and ticks each step from what the platform holds.
 *
 * Where the page is long it also lists the page's own sections beneath, so
 * one bar answers both "where am I in the process" and "where am I on this
 * page", rather than two bars competing for the top of the screen.
 */
export async function CohortNav({
  cohortId,
  current,
  sections = false,
}: {
  cohortId: string;
  /** Which step's page this is: "overview" for the cohort's own page. */
  current: CohortStepKey | "overview";
  /** List the page's own sections too (pages marked with Card `section`). */
  sections?: boolean;
}) {
  const t = await pageT();
  const session = await requireSession();
  const journey = await cohortJourney(session, cohortId);
  const base = `/cohorts/${cohortId}`;
  const canArchive = session.permissions.includes("records:manage");

  const href: Record<CohortStepKey, string | null> = {
    setup: base,
    payment: `${base}#payment`,
    learners: `${base}#learners`,
    plan: `${base}/plan`,
    sessions: `${base}#sessions`,
    run: `${base}#today`,
    archive: canArchive ? `${base}/archive` : null,
  };
  const here = (step: CohortStepKey) =>
    current === step || (current === "overview" && step === "setup");

  return (
    <nav
      aria-label={t("cohortNav.label")}
      className="sticky top-0 z-30 -mx-4 mb-6 border-b border-[var(--border)] bg-[var(--background)]/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-[var(--background)]/85"
    >
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-sm">
        {COHORT_STEPS.map((step, index) => {
          const done = journey.done[step];
          const isNext = journey.next === step;
          const marker = (
            <span
              aria-hidden
              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                done
                  ? "bg-[var(--success)] text-white"
                  : isNext
                    ? "border-2 border-[var(--brand-accent)] text-[var(--foreground)]"
                    : "border border-[var(--border)] text-[var(--muted)]"
              }`}
            >
              {done ? "✓" : index + 1}
            </span>
          );
          const text = (
            <>
              {marker}
              <span>{t(`cohortNav.step.${step}`)}</span>
              <span className="sr-only">
                {done ? t("cohortNav.done") : isNext ? t("cohortNav.isNext") : ""}
              </span>
            </>
          );
          const target = href[step];
          return (
            <li key={step} className="flex items-center gap-1">
              {index > 0 ? <span aria-hidden className="px-0.5 text-[var(--muted)]">›</span> : null}
              {target ? (
                <Link
                  href={target}
                  aria-current={here(step) ? "page" : undefined}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 ${
                    here(step) ? "bg-[var(--brand-primary)] text-white" : "hover:bg-[var(--border)]/40"
                  }`}
                >
                  {text}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-1 text-[var(--muted)]">{text}</span>
              )}
            </li>
          );
        })}
      </ol>
      {journey.next ? (
        <p className="mt-1.5 text-sm">
          <span className="font-semibold">{t("cohortNav.next")}</span>{" "}
          {t(`cohortNav.nextText.${journey.next}`)}
          {href[journey.next] ? (
            <>
              {" "}
              <Link href={href[journey.next]!} className="whitespace-nowrap font-medium text-[var(--brand-primary)] underline underline-offset-2">
                {t("cohortNav.goThere")}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {sections ? <PageNav embedded /> : null}
    </nav>
  );
}
