import Link from "next/link";
import { pageT, requireSession } from "@/lib/request";
import { qualificationNavigation } from "@/lib/qualification-build";

/**
 * A way round a qualification once it is loaded. Roland, 2 October 2026:
 * "once everything is uploaded there needs to be a way to browse the
 * qualification. Maybe a floating menu bar that can take one to the Study
 * Units, Workbooks, etc."
 *
 * On every page that belongs to a qualification: its own page, each study
 * unit's, the learner's-eye preview and the check before it goes live. It
 * stays at the top as the page scrolls, and marks where you are. Kept to one
 * quiet line, so it guides without crowding (design restraint).
 */
export async function QualificationNav({
  qualificationId,
  current,
}: {
  qualificationId: string;
  /** "overview", "preview", "verify", or a study unit's course id. */
  current: string;
}) {
  const t = await pageT();
  const session = await requireSession();
  const { units } = await qualificationNavigation(session, qualificationId);
  const base = `/qualifications/${qualificationId}`;

  const link = (href: string, label: string, active: boolean) => (
    <Link
      key={href}
      href={href}
      aria-current={active ? "page" : undefined}
      className={`whitespace-nowrap rounded px-2 py-1 ${
        active ? "bg-[var(--brand-primary)] text-white" : "text-[var(--foreground)] hover:bg-[var(--border)]/40"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <nav
      aria-label={t("qualNav.label")}
      className="sticky top-0 z-20 -mx-4 mb-6 flex flex-wrap items-center gap-1 border-b border-[var(--border)] bg-[var(--background)]/95 px-4 py-2 text-sm backdrop-blur"
    >
      {link(base, t("qualNav.overview"), current === "overview")}
      <span className="ml-2 text-xs uppercase tracking-wide text-[var(--muted)]">{t("qualNav.units")}</span>
      {units.map((unit) =>
        unit.courseId
          ? link(`/courses/${unit.courseId}`, unit.code, current === unit.courseId)
          : (
              <span key={unit.code} className="px-2 py-1 text-[var(--muted)]" title={t("qualNav.notBuilt")}>
                {unit.code}
              </span>
            ),
      )}
      <span aria-hidden className="mx-1 text-[var(--muted)]">·</span>
      {link(`${base}#documents`, t("qualNav.documents"), false)}
      {link(`${base}/verify#assessments`, t("qualNav.assessments"), false)}
      {link(`${base}/preview`, t("qualNav.learner"), current === "preview")}
      {link(`${base}/verify`, t("qualNav.verify"), current === "verify")}
    </nav>
  );
}
