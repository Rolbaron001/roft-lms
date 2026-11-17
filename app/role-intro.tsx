import Link from "next/link";
import { maybe, type Translate } from "@/lib/i18n";
import type { Permission } from "@/lib/rbac";
import { itemsFor, type IntroKey } from "@/lib/role-intros";

/**
 * The introduction at the top of Home (Heidi, 13 November 2026; job sheet
 * D50): who the person is on the platform and what they can do there, each
 * item a link. One role, or working in one: that role's, open. Several: each
 * role's, folded, so the page still starts with the work.
 */
export function RoleIntro({ intros, permissions, t }: { intros: IntroKey[]; permissions: readonly Permission[]; t: Translate }) {
  if (intros.length === 0) return null;

  const body = (key: IntroKey) => {
    const items = itemsFor(key, permissions);
    return (
      <div className="space-y-3">
        <p className="text-sm leading-relaxed">{t(`intro.${key}.welcome`)}</p>
        {items.length ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("intro.whatYouCanDo")}</p>
            <ul className="mt-1.5 space-y-1 text-sm">
              {items.map((one) => (
                <li key={one.key}>
                  <Link href={one.href} className="text-[var(--brand-primary)] hover:underline">
                    {maybe(t, `intro.item.${one.key}`) ?? one.key} →
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <details open className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4" data-role-intro>
      <summary className="cursor-pointer text-sm font-semibold">
        {intros.length === 1 ? `${t("intro.heading")}: ${t(`intro.${intros[0]}.title`)}` : t("intro.yourRoles")}
      </summary>
      <div className="mt-3">
        {intros.length === 1 ? (
          body(intros[0])
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-[var(--muted)]">{t("intro.yourRolesHint")}</p>
            {intros.map((key) => (
              <details key={key} className="rounded-md border border-[var(--border)] px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">{t(`intro.${key}.title`)}</summary>
                <div className="mt-2">{body(key)}</div>
              </details>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
