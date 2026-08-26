import Image from "next/image";
import { redirect } from "next/navigation";
import { currentSession, currentTenant } from "@/lib/request";
import { TenantLogo } from "@/components/tenant-logo";
import { LoginForm } from "./login-form";
import { platformName } from "@/lib/platform";

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
export default async function LoginPage() {
  const tenant = await currentTenant();

  if (tenant) {
    const session = await currentSession();
    if (session) {
      redirect("/");
    }
  }

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
              <div className="mb-6 flex lg:hidden">
                <TenantLogo
                  logoUrl={tenant.logoUrl}
                  displayName={tenant.displayName}
                  height={64}
                />
              </div>
            ) : null}

            <div
              className="mb-4 h-1 w-12 rounded-full"
              style={{ background: "var(--brand-accent)" }}
            />
            <h1 className="text-2xl font-semibold tracking-tight">
              {tenant
                ? tenant.displayName
                : `${platformName()} Learning Management System`}
            </h1>
            <p className="mt-1.5 text-sm text-[var(--muted)]">
              {tenant
                ? "Sign in to continue your learning."
                : "Platform administration"}
            </p>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
            {tenant ? (
              <LoginForm />
            ) : (
              <p className="text-sm text-[var(--muted)]">
                This address is not configured for an organisation. Check the
                web address you were given, or contact your administrator.
              </p>
            )}
          </div>

          {tenant ? (
            <p className="mt-6 text-xs text-[var(--muted)]">
              Trouble signing in? Speak to your facilitator — they can reset a
              password for you.
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
