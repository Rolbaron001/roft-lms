import Link from "next/link";
import { requireSession, requireTenant } from "@/lib/request";
import { myNotifications } from "@/lib/notifications";
import { AppShell, Card } from "@/components/app-shell";
import { MarkAllRead } from "./mark-all-read";
import { translator, type Translate } from "@/lib/i18n";
import { dateLocale, localeFor } from "@/lib/i18n/locales";

function relative(date: Date, t: Translate, locale: string): string {
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return t("notify.justNow");
  if (minutes < 60) return t("notify.minutesAgo", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? t("notify.hourAgo") : t("notify.hoursAgo", { count: hours });
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? t("notify.dayAgo") : t("notify.daysAgo", { count: days });
  return date.toLocaleDateString(dateLocale(locale));
}

export default async function NotificationsPage() {
  const tenant = await requireTenant();
  const session = await requireSession();
  const locale = localeFor(tenant, session);
  const t = translator(locale);
  const items = await myNotifications(session);

  const unread = items.filter((item) => !item.readAt);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("shell.notifications")}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {unread.length > 0
              ? t("notify.unread", { count: unread.length })
              : t("notify.nothingUnread")}
          </p>
        </div>
        {unread.length > 0 ? <MarkAllRead /> : null}
      </div>

      {items.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            {t("notify.nothingYet")}
          </p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const inner = (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p
                    className={`text-sm ${item.readAt ? "" : "font-semibold"}`}
                  >
                    {!item.readAt ? (
                      <span
                        aria-label={t("notify.unreadMark")}
                        className="mr-2 inline-block h-2 w-2 rounded-full align-middle"
                        style={{ background: "var(--brand-accent)" }}
                      />
                    ) : null}
                    {item.subject}
                  </p>
                  <span className="shrink-0 text-xs text-[var(--muted)]">
                    {relative(item.createdAt, t, locale)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-[var(--muted)]">{item.body}</p>
              </>
            );

            return (
              <li key={item.id}>
                {item.linkPath ? (
                  <Link
                    href={item.linkPath}
                    className="block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--brand-accent)]"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
                    {inner}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
