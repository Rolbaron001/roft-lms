import { redirect } from "next/navigation";
import { currentSession, currentTenant } from "@/lib/request";
import { TenantLogo } from "@/components/tenant-logo";
import { LoginForm } from "./login-form";

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
      className="flex min-h-screen items-center justify-center px-4 py-12"
      style={
        tenant
          ? ({
              "--brand-primary": tenant.primaryColour,
              "--brand-accent": tenant.accentColour,
            } as React.CSSProperties)
          : undefined
      }
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {tenant?.logoUrl ? (
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
            {tenant ? tenant.displayName : "ROFT Learning Management System"}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {tenant ? "Sign in to continue" : "Platform administration"}
          </p>
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
          {tenant ? (
            <LoginForm />
          ) : (
            <p className="text-sm text-[var(--muted)]">
              This address is not configured for an organisation. Check the web
              address you were given, or contact your administrator.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
