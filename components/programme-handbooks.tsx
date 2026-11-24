import Link from "next/link";
import type { Translate } from "@/lib/i18n";
import type { ProgrammeHandbook } from "@/lib/learner-unit";

/**
 * The programme's learner handbook on the learner's programme page, and in the
 * staff preview of it (24 November 2026). It opens once the cohort has
 * released the programme; until then the learner is told when.
 */
export function ProgrammeHandbooks({ qualificationId, items, open, t }: { qualificationId: string; items: ProgrammeHandbook[]; open: boolean; t: Translate }) {
  if (items.length === 0) return null;
  return (
    <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
      <h2 className="text-lg font-semibold">{t("learnQual.handbook")}</h2>
      <p className="text-sm text-[var(--muted)]">{open ? t("learnQual.handbookHint") : t("learnQual.handbookLater")}</p>
      <ul className="mt-3 space-y-2 text-sm">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-3">
            {open ? (
              <>
                <Link href={`/learn/qualification/${qualificationId}/handbook/${item.id}`} className="font-medium underline-offset-2 hover:underline">
                  {item.title}
                </Link>
                <a href={`/api/learn/handbook/${item.id}?download`} className="text-xs text-[var(--muted)] underline underline-offset-2">
                  {t("learnUnit.download")}
                </a>
              </>
            ) : (
              <span className="text-[var(--muted)]">{item.title}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A line on a study unit's page pointing back to the programme's handbook. */
export function HandbookLink({ qualificationId, items, open, t }: { qualificationId: string; items: ProgrammeHandbook[]; open: boolean; t: Translate }) {
  if (items.length === 0 || !open) return null;
  return (
    <p className="text-sm">
      {items.map((item, index) => (
        <span key={item.id}>
          {index > 0 ? " · " : null}
          <Link href={`/learn/qualification/${qualificationId}/handbook/${item.id}`} className="font-medium text-[var(--brand-accent)] underline-offset-2 hover:underline">
            {items.length === 1 ? t("learnQual.handbookLink") : item.title}
          </Link>
        </span>
      ))}
    </p>
  );
}
