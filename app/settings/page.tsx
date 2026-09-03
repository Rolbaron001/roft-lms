import { dateInZone } from "@/lib/timezone";
import { requirePermission, requireTenant } from "@/lib/request";
import { namingConventionFor } from "@/lib/capture";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { BrandingForm } from "./branding-form";
import { NamingForm } from "./naming-form";
import { ClockForm } from "./clock-form";
import { ExtensionForm } from "./extension-form";
import {
  extensionOffered,
  extensionState,
  knownProviders,
} from "@/lib/extensions";

export default async function SettingsPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("tenant:manage_branding");

  // Filename reading is a separate permission from branding. Somebody who can
  // change the logo does not necessarily decide how documents are filed.
  const canManageSettings = session.permissions.includes(
    "tenant:manage_settings",
  );
  const convention = canManageSettings
    ? await namingConventionFor(session)
    : null;

  // The extension is against this person's own profile, so it is offered to
  // anybody whose role includes model assistance rather than to administrators
  // alone.
  const mayUseExtension =
    extensionOffered() && session.permissions.includes("extension:use");
  const extension = mayUseExtension ? await extensionState(session) : null;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          How {tenant.displayName} looks to your people, and how the App reads
          the documents they upload. Changes apply everywhere immediately —
          there is nothing to rebuild or redeploy.
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

      {canManageSettings ? (
        <div className="mt-6">
          <ClockForm current={tenant.timezone} />
        </div>
      ) : null}

      {extension ? (
        <div className="mt-6">
          <Card
            title="Your AI extension"
            description="Against your own profile. Optional, off by default, and what it lets you do is bounded by your role exactly as everything else is."
          >
            <ExtensionForm
              current={{
                registered: extension.registered,
                available: extension.available,
                tokenHint: extension.tokenHint,
                tokenAddedAt: extension.tokenAddedAt
                  ? dateInZone(extension.tokenAddedAt, tenant.timezone)
                  : null,
                provider: extension.provider,
                model: extension.model,
                availability: extension.availability,
                providers: knownProviders().map((provider) => ({
                  name: provider.name,
                  label: provider.label,
                  description: provider.description,
                })),
              }}
            />
          </Card>
        </div>
      ) : null}

      {convention ? (
        <div className="mt-6">
          <NamingForm current={convention} />
        </div>
      ) : null}
    </AppShell>
  );
}
