import Image from "next/image";
import { redirect } from "next/navigation";
import { currentSession, currentTenant } from "@/lib/request";
import { TenantLogo } from "@/components/tenant-logo";
import { DeploymentBanner } from "@/components/deployment-banner";
import { LoginForm } from "./login-form";
import { platformName } from "@/lib/platform";
import { signInOptions, SSO_LABEL } from "@/lib/single-sign-on";
import { catalogueFor, translator, type MessageKey } from "@/lib/i18n";
import { I18nProvider } from "@/components/i18n";
import { localeFor } from "@/lib/request";

/** Why a Google or Microsoft sign-in came back without signing anybody in. */
const SSO_MESSAGES: Record<string, MessageKey> = {
  refused: "login.sso.refused",
  cancelled: "login.sso.cancelled",
  expired: "login.sso.expired",
  off: "login.sso.off",
};

/**
 * The sign-in page.
 *
 * The first thing anybody sees, so it carries the tenant's identity rather
 * than a bare form on a white field. Two columns on a wide screen: who this is
 * on the left, the form on the right. On a phone the identity collapses to the
 * logo and the name, because a learner signing in on a hub network does not
 * need a decorative panel loaded before they can type.
 *
 * The panel graphic comes from the tenant when they have set one and is absent
 * otherwise. Nothing here is specific to any one client.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sso?: string }>;
}) {
  const tenant = await currentTenant();

  if (tenant) {
    const session = await currentSession();
    if (session) {
      redirect("/");
    }
  }

  // Signing in with the provider's Google or Microsoft account (job sheet D7).
  const ssoKinds = tenant ? await signInOptions(tenant.id) : [];
  // Nobody is signed in yet, so the provider's language (job sheet D9).
  const locale = localeFor(tenant, null);
  const t = translator(locale);
  const ssoKey = SSO_MESSAGES[(await searchParams).sso ?? ""];
  const ssoMessage = ssoKey ? t(ssoKey) : null;

  return (
    <main
      className="min-h-screen"
      style={
        tenant
          ? ({
              "--brand-primary": tenant.primaryColour,
              "--brand-accent": tenant.accentColour,
            } as React.CSSProperties)
          : undefined
      }
    >
      {/* Where a mistake between development and live would start. */}
      <DeploymentBanner />

      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-6 py-12 lg:grid-cols-[1.1fr_minmax(0,26rem)] lg:gap-16">
        <section className="hidden lg:block">
          {tenant?.signInGraphicUrl ? (
            <div className="relative mx-auto aspect-square w-full max-w-lg">
              <Image
                src={tenant.signInGraphicUrl}
                alt=""
                fill
                priority
                sizes="(min-width: 1024px) 32rem, 0px"
                className="object-contain"
              />
            </div>
          ) : (
            <div
              className="mx-auto flex aspect-square w-full max-w-lg items-center justify-center rounded-3xl"
              style={{ background: "var(--brand-primary)" }}
            >
              <p className="max-w-xs text-balance px-8 text-center text-2xl font-semibold leading-snug text-white">
                {tenant?.displayName ?? platformName()}
              </p>
            </div>
          )}

          {tenant?.strapline ? (
            <p
              className="mt-6 text-center text-lg font-medium"
              style={{ color: "var(--brand-primary)" }}
            >
              {tenant.strapline}
            </p>
          ) : null}
        </section>

        <section className="mx-auto w-full max-w-sm">
          <div className="mb-8">
            {tenant?.logoUrl ? (
              // Shown at every width. The logo is the identity; the panel
              // graphic beside it is decoration, and a sign-in page carrying
              // only the decoration is a page that has not said who it is.
              <div className="mb-5 flex">
                <TenantLogo
                  logoUrl={tenant.logoUrl}
                  displayName={tenant.displayName}
                  height={72}
                />
              </div>
            ) : (
              <div
                className="mb-4 h-1 w-12 rounded-full"
                style={{ background: "var(--brand-accent)" }}
              />
            )}

            <h1 className="text-2xl font-semibold tracking-tight">
              {tenant
                ? tenant.displayName
                : `${platformName()} Learning Management System`}
            </h1>
            <p className="mt-1.5 text-sm text-[var(--muted)]">
              {tenant ? t("login.intro") : "Platform administration"}
            </p>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            {tenant ? (
              <>
                {ssoMessage ? (
                  <p role="alert" className="mb-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]">
                    {ssoMessage}
                  </p>
                ) : null}
                <I18nProvider messages={catalogueFor(locale)}>
                  <LoginForm />
                </I18nProvider>
                {ssoKinds.length > 0 ? (
                  <div className="mt-5 space-y-2 border-t border-[var(--border)] pt-5">
                    {ssoKinds.map((kind) => (
                      // A plain link: the route redirects on to the provider.
                      <a
                        key={kind}
                        href={`/api/sign-in/${kind}`}
                        className="block w-full rounded-md border border-[var(--border)] px-4 py-2.5 text-center text-sm font-medium hover:bg-[var(--brand-primary)]/5"
                      >
                        {t("login.with", { provider: SSO_LABEL[kind] })}
                      </a>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                This address is not configured for an organisation. Check the
                web address you were given, or contact your administrator.
              </p>
            )}
          </div>

          {tenant ? (
            <p className="mt-6 text-xs text-[var(--muted)]">
              {t("login.trouble")}
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
