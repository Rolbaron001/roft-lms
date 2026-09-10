import { redirect } from "next/navigation";
import { dateInZone } from "@/lib/timezone";
import { requireSession, requireTenant } from "@/lib/request";
import { namingConventionFor } from "@/lib/capture";
import { arrangeNavigation } from "@/lib/navigation";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { BrandingForm } from "./branding-form";
import { NamingForm } from "./naming-form";
import { ClockForm } from "./clock-form";
import { ExtensionForm } from "./extension-form";
import { MenuEditor } from "./menu-editor";
import { MailTest } from "./mail-test";
import { TerminologyForm } from "./terminology-form";
import { TERMS, TERM_KEYS } from "@/lib/terms";
import { mailIsConfigured } from "@/lib/mail";
import { listTemplates } from "@/lib/document-templates";
import { TemplateForm } from "./template-form";
import {
  extensionOffered,
  extensionState,
  knownProviders,
} from "@/lib/extensions";

export default async function SettingsPage() {
  const tenant = await requireTenant();
  const session = await requireSession();

  // Reachable by anybody with something on this page, which is not the same as
  // anybody who can brand the tenant.
  //
  // This page used to demand tenant:manage_branding outright, while the menu
  // offered it to anybody holding extension:use and the AI extension copy told
  // them in as many words to come here and switch it on. A facilitator
  // following that instruction was refused by the page it named. Each section
  // now checks its own permission and the page checks that there is at least
  // one section worth showing.
  const canBrand = session.permissions.includes("tenant:manage_branding");
  const mayUseExtensionRole = session.permissions.includes("extension:use");

  if (!canBrand && !mayUseExtensionRole) {
    redirect("/not-permitted");
  }

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
  const mayUseExtension = extensionOffered() && mayUseExtensionRole;
  const extension = mayUseExtension ? await extensionState(session) : null;

  // What the editor starts from: this provider's arrangement if they have one,
  // otherwise the built-in one, with labels rather than hrefs alone.
  /**
   * A tenant's own versions of the documents the platform issues. Read only
   * where somebody may change them; for everybody else the section does not
   * appear at all rather than appearing and refusing.
   */
  const templates = canManageSettings ? await listTemplates(session) : [];

  const menu = arrangeNavigation(tenant.navigation ?? null).map((section) => ({
    label: section.label,
    items: section.items.map((item) => ({
      href: item.href,
      label: item.label,
    })),
  }));

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

      {canManageSettings ? (
        <div className="mt-6">
          <Card
            title="Outbound mail"
            description="Whether learners can actually receive their sign-in details and notifications. Worth checking after anybody changes the mail settings, and the first thing to check when somebody says an email never arrived."
          >
            <MailTest configured={mailIsConfigured()} />
          </Card>
        </div>
      ) : null}

      {canBrand ? (
        <div className="mt-6">
          <Card
            title="What you call things"
            description="Use your own vocabulary. A provider outside South Africa may not say programme, and a provider inside it may not say course — the platform should not insist."
          >
            <TerminologyForm
              terms={TERM_KEYS.map((key) => ({
                key,
                defaultOne: TERMS[key].one,
                defaultMany: TERMS[key].many,
                note: TERMS[key].note,
                definedBy: TERMS[key].definedBy,
                currentOne: tenant.terminology?.[key]?.one ?? "",
                currentMany: tenant.terminology?.[key]?.many ?? "",
              }))}
            />
          </Card>
        </div>
      ) : null}

      {canManageSettings ? (
        <div className="mt-6">
          <Card
            title="Your own documents"
            description="The platform issues Statements of Results, certificates and workplace statements. How each one reads and looks is yours: write your own version and the platform produces it from that instead of its own layout. What a regulator requires is added after yours and is not editable, because that part is not the provider's to change."
          >
            <TemplateForm templates={templates} />
          </Card>
        </div>
      ) : null}

      {canBrand ? (
        <div className="mt-6">
          <Card
            title="The menu"
            description="Rearrange the bar at the top: rename a heading, move a page under a different one, or make a page a direct link. The same for everybody at this provider, because staff tell each other where things are."
          >
            <MenuEditor current={menu} />
          </Card>
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
