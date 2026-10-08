import Link from "next/link";
import type { DashRow, DashSection, DashTone, RoleDashboard } from "@/lib/dashboard-kit";
import { Card } from "@/components/app-shell";

const TONE: Record<DashTone, string> = {
  danger: "text-[var(--danger)]",
  warning: "text-amber-700 dark:text-amber-400",
  good: "text-[var(--success)]",
  plain: "text-[var(--foreground)]",
};

/**
 * Any role's dashboard (job sheet D25), drawn the same way for every role so
 * that a person with several sees one page: what needs them today across the
 * top, then the main work on the left and dates and queues on the right, as
 * designed on the canvas on 8 October 2026. Every tile and row is a link to
 * the item it names.
 */
export function RoleDashboardView({ data, todayTitle, todayIntro, nothing }: { data: RoleDashboard; todayTitle: string; todayIntro: string; nothing: string }) {
  return (
    <div className="space-y-6">
      <Card section={{ id: "needs-you", label: todayTitle }} title={todayTitle} description={todayIntro}>
        {data.tiles.length === 0 ? (
          <p className="text-sm text-[var(--success)]">{nothing}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.tiles.map((tile) => (
              <Link
                key={tile.key}
                href={tile.href}
                className="group flex flex-col rounded-md border border-[var(--border)] px-4 py-3 transition hover:border-[var(--brand-accent)] hover:bg-[var(--background)]"
              >
                <span className={`text-2xl font-bold tabular-nums ${TONE[tile.tone]}`}>{tile.count}</span>
                <span className="font-medium group-hover:underline">{tile.label}</span>
                <span className="text-xs text-[var(--muted)]">{tile.detail}</span>
                <span className="mt-2 text-xs font-semibold text-[var(--brand-primary)]">{tile.open} →</span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          {data.main.map((section) => (
            <Section key={section.id} section={section} wide />
          ))}
        </div>
        <div className="min-w-0 space-y-6">
          {data.side.map((section) => (
            <Section key={section.id} section={section} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Section({ section, wide = false }: { section: DashSection; wide?: boolean }) {
  return (
    <Card section={{ id: section.id, label: section.title }} title={section.title} description={section.intro}>
      {section.rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{section.empty}</p>
      ) : (
        <ul className="divide-y divide-[var(--border)] text-sm">
          {section.rows.map((row, index) => (
            <li key={`${row.href}-${index}`}>
              <RowLink row={row} wide={wide} />
            </li>
          ))}
        </ul>
      )}
      {section.more ? (
        <p className="mt-3 text-sm">
          <Link href={section.more.href} className="font-medium text-[var(--brand-primary)] underline-offset-2 hover:underline">
            {section.more.label} →
          </Link>
        </p>
      ) : null}
    </Card>
  );
}

function RowLink({ row, wide }: { row: DashRow; wide: boolean }) {
  const body = wide ? (
    <>
      <span className="flex flex-wrap justify-between gap-2">
        <span className="min-w-0">
          <span className="block font-medium group-hover:underline">{row.primary}</span>
          {row.secondary ? <span className="block text-xs text-[var(--muted)]">{row.secondary}</span> : null}
        </span>
        {row.right ? <span className={`shrink-0 text-xs font-semibold ${TONE[row.tone ?? "plain"]}`}>{row.right}</span> : null}
      </span>
      {row.bar !== undefined ? (
        <span className="mt-2 block h-2 rounded-full bg-[var(--border)]">
          <span className="block h-2 rounded-full bg-[var(--brand-accent)]" style={{ width: `${Math.max(0, Math.min(100, row.bar))}%` }} />
        </span>
      ) : null}
    </>
  ) : (
    <span className="flex gap-3">
      {row.right ? <span className={`w-20 shrink-0 text-xs font-semibold ${TONE[row.tone ?? "plain"]}`}>{row.right}</span> : null}
      <span className="min-w-0">
        <span className="block font-medium group-hover:underline">{row.primary}</span>
        {row.secondary ? <span className="block text-xs text-[var(--muted)]">{row.secondary}</span> : null}
      </span>
    </span>
  );
  const className = "group block py-2.5";
  return row.external ? (
    <a href={row.href} target="_blank" rel="noreferrer" className={className}>{body}</a>
  ) : (
    <Link href={row.href} className={className}>{body}</Link>
  );
}
