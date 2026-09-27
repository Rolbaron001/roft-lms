import Link from "next/link";
import { localeFor, requireSessionForPasswordChange, requireTenant } from "@/lib/request";
import { TenantLogo } from "@/components/tenant-logo";
import { I18nProvider } from "@/components/i18n";
import { catalogueFor, translator } from "@/lib/i18n";
import { localeOf } from "@/lib/i18n/locales";
import { PasswordForm } from "./password-form";
import { LanguageForm } from "./language-form";

/**
 * Changing your own password.
 *
 * Stands outside the application shell on purpose. Somebody arriving here
 * because they must change a password they did not choose has no business
 * seeing a navigation bar they are not yet allowed to use — and the page has
 * to work for the one person in the tenant who cannot go anywhere else.
 *
 * This is the only page that may use requireSessionForPasswordChange: every
 * other route redirects here while the flag is set.
 */
export default async function ChangePasswordPage() {
  const tenant = await requireTenant();
  const session = await requireSessionForPasswordChange();
  const forced = session.mustChangePassword;
  const locale = localeFor(tenant, session);
  const t = translator(locale);

  return (
    <I18nProvider messages={catalogueFor(locale)}>
    <main
      className="flex min-h-screen items-center justify-center px-4 py-12"
      style={
        {
          "--brand-primary": tenant.primaryColour,
          "--brand-accent": tenant.accentColour,
        } as React.CSSProperties
      }
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {tenant.logoUrl ? (
            <div className="mb-5 flex justify-center">
              <TenantLogo
                logoUrl={tenant.logoUrl}
                displayName={tenant.displayName}
                height={56}
              />
            </div>
          ) : (
            <div
              className="mx-auto mb-4 h-1 w-12 rounded-full"
              style={{ background: "var(--brand-accent)" }}
            />
          )}
          <h1 className="text-xl font-semibold tracking-tight">
            {forced ? t("account.titleForced") : t("account.title")}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {forced ? t("account.forcedIntro") : t("account.signedInAs", { email: session.email })}
          </p>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          {!forced ? (
            <h2 className="mb-4 text-sm font-semibold">{t("account.passwordHeading")}</h2>
          ) : null}
          <PasswordForm forced={forced} />
        </div>

        {/* Not while a password must be replaced: that comes first. */}
        {!forced ? (
          <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">{t("account.languageHeading")}</h2>
            <LanguageForm
              current={session.locale ?? null}
              providerLanguage={localeOf(tenant.defaultLocale).native}
            />
          </div>
        ) : null}

        {forced ? (
          <p className="mt-6 text-center text-xs text-[var(--muted)]">{t("account.forcedNote")}</p>
        ) : (
          <p className="mt-6 text-center text-xs text-[var(--muted)]">
            <Link href="/" className="underline hover:no-underline">
              {t("account.back")}
            </Link>
          </p>
        )}
      </div>
    </main>
    </I18nProvider>
  );
}
