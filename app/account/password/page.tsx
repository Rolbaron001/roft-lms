import Link from "next/link";
import { requireSessionForPasswordChange, requireTenant } from "@/lib/request";
import { TenantLogo } from "@/components/tenant-logo";
import { PasswordForm } from "./password-form";

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

  return (
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
            {forced ? "Choose your own password" : "Change your password"}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {forced
              ? "Somebody else set the password you signed in with. Replace it before carrying on."
              : `Signed in as ${session.email}`}
          </p>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          <PasswordForm forced={forced} />
        </div>

        {forced ? (
          <p className="mt-6 text-center text-xs text-[var(--muted)]">
            Changing it signs out anyone else using the old password, including
            whoever passed it to you.
          </p>
        ) : (
          <p className="mt-6 text-center text-xs text-[var(--muted)]">
            <Link href="/" className="underline hover:no-underline">
              Back
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
