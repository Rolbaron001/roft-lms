import { requirePermission, requireTenant } from "@/lib/request";
import { AppShell } from "@/components/app-shell";
import { BrandingForm } from "./branding-form";

export default async function SettingsPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("tenant:manage_branding");

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Appearance</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          How {tenant.displayName} looks to your people. Changes apply
          everywhere immediately — there is nothing to rebuild or redeploy.
        </p>
      </div>

      <BrandingForm
        defaults={{
          displayName: tenant.displayName,
          primaryColour: tenant.primaryColour,
          accentColour: tenant.accentColour,
          logoUrl: tenant.logoUrl,
          signInGraphicUrl: tenant.signInGraphicUrl,
          strapline: tenant.strapline,
        }}
      />
    </AppShell>
  );
}
