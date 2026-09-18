import Link from "next/link";
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
import { SettingsNav } from "./settings-nav";
import { DriveConnections } from "./drive-connections";
import { availableDriveProviders, connectionsFor } from "@/lib/drive";
import { TerminologyForm } from "./terminology-form";
import { TERMS, TERM_KEYS } from "@/lib/terms";
import { mailIsConfigured } from "@/lib/mail";
import {
  extensionOffered,
  extensionState,
  knownProviders,
} from "@/lib/extensions";

/** What came back from a drive consent, said in a sentence. */
const DRIVE_NOTICES: Record<string, string> = {
  connected: "Connected. A folder can now be read straight from it.",
  cancelled: "Nothing was connected — the consent was cancelled.",
  refused: "That account refused the connection.",
  state:
    "That consent did not match the one this browser started, so nothing was connected. Start again from this page.",
  nocode: "The provider sent nothing back to connect with. Try again.",
  failed:
    "The connection could not be completed. Nothing was stored. Trying again is worth doing before anything else.",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ drive?: string }>;
}) {
  const tenant = await requireTenant();
  const session = await requireSession();

  /*
   * Connecting a file store belongs with getting material into a
   * qualification, so it is held by the people who do that rather than by
   * everybody with a settings page.
   */
  const canManageQualifications = session.permissions.includes(
    "qualification:manage",
  );
  const driveConnected = canManageQualifications
    ? await connectionsFor(session)
    : [];
  const driveNotice =
    DRIVE_NOTICES[(await searchParams).drive ?? ""] ?? null;

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

      {/*
        What is on this page, before any of it.

        Roland, 18 September: hard to navigate "especially if you don't know
        all the options that can be found there". The sections are marked with
        data attributes and the list is built from what actually rendered, so a
        section added later names itself rather than waiting for somebody to
        remember a second list.
      */}
      <SettingsNav />

      <div id="branding" data-settings-section="Branding" className="scroll-mt-24">
      <BrandingForm
        defaults={{
          displayName: tenant.displayName,
          primaryColour: tenant.primaryColour,
          accentColour: tenant.accentColour,
          logoUrl: tenant.logoUrl,
          signInGraphicUrl: tenant.signInGraphicUrl,
          illustrationUrl: tenant.illustrationUrl,
          strapline: tenant.strapline,
        }}
      />
      </div>

      {canManageSettings ? (
        <div
          id="clock"
          data-settings-section="Clock"
          className="mt-6 scroll-mt-24"
        >
          <ClockForm current={tenant.timezone} />
        </div>
      ) : null}

      {canManageSettings ? (
        <div
          id="mail"
          data-settings-section="Outbound mail"
          className="mt-6 scroll-mt-24"
        >
          <Card
            title="Outbound mail"
            description="Whether learners can actually receive their sign-in details and notifications. Worth checking after anybody changes the mail settings, and the first thing to check when somebody says an email never arrived."
          >
            <MailTest configured={mailIsConfigured()} />
          </Card>
        </div>
      ) : null}

      {canBrand ? (
        <div
          id="terminology"
          data-settings-section="What you call things"
          className="mt-6 scroll-mt-24"
        >
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

      {/*
        Moved to its own screen on 15 September. Templates sat here underneath
        the branding and the clock, which is not where anybody looks for the
        layout of a Statement of Results. The signpost stays, because somebody
        who knew where it used to be will come here first.
      */}
      {canManageSettings ? (
        <div
          id="templates"
          data-settings-section="Templates"
          className="mt-6 scroll-mt-24"
        >
          <Card
            title="Your own documents"
            description="How each document this provider issues reads and looks."
          >
            <p className="text-sm">
              <Link href="/templates" className="underline underline-offset-2">
                Templates
              </Link>
              <span className="text-[var(--muted)]">
                {" "}
                — now under Management, with every document the platform
                produces and who receives each one.
              </span>
            </p>
          </Card>
        </div>
      ) : null}

      {canBrand ? (
        <div
          id="menu"
          data-settings-section="The menu"
          className="mt-6 scroll-mt-24"
        >
          <Card
            title="The menu"
            description="Rearrange the bar at the top: rename a heading, move a page under a different one, or make a page a direct link. The same for everybody at this provider, because staff tell each other where things are."
          >
            <MenuEditor current={menu} />
          </Card>
        </div>
      ) : null}

      {canManageQualifications ? (
        <div
          id="drives"
          data-settings-section="File stores"
          className="mt-6 scroll-mt-24"
        >
          <Card
            title="Your file stores"
            description="Read a folder straight from Google Drive or OneDrive, instead of downloading it and uploading it again. Yours rather than this provider's: every member of staff connects their own."
          >
            <DriveConnections
              connected={driveConnected.map((one) => ({
                provider: one.provider,
                label: one.label,
                accountLabel: one.accountLabel,
                connectedAt: dateInZone(one.connectedAt, tenant.timezone),
                lastUsedAt: one.lastUsedAt
                  ? dateInZone(one.lastUsedAt, tenant.timezone)
                  : null,
              }))}
              offered={availableDriveProviders().map((one) => ({
                name: one.name,
                label: one.label,
                description: one.description,
              }))}
              notice={driveNotice}
            />
          </Card>
        </div>
      ) : null}

      {extension ? (
        <div
          id="extension"
          data-settings-section="AI extension"
          className="mt-6 scroll-mt-24"
        >
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
                // Asked of each provider rather than assumed, because the
                // answer differs by deployment: Claude Code runs on a laptop
                // and not in the container on the server.
                providers: await Promise.all(
                  knownProviders().map(async (provider) => {
                    const here = await provider.availability(tenant.id);
                    return {
                      name: provider.name,
                      label: provider.label,
                      description: provider.description,
                      runsHere: here.available,
                      reason: here.reason ?? null,
                    };
                  }),
                ),
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
