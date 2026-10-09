import Link from "next/link";
import { redirect } from "next/navigation";
import { dateInZone } from "@/lib/timezone";
import { pageDates, pageLocale, requireSession, requireTenant, said } from "@/lib/request";
import { maybe, type MessageKey } from "@/lib/i18n";
import { sayer } from "@/lib/i18n/said";
import { namingConventionFor } from "@/lib/capture";
import { proposeModuleCodeTable } from "@/lib/module-code-settings";
import { settledTerms, structureOf } from "@/lib/features";
import { arrangeNavigation } from "@/lib/navigation";
import { vocabulary } from "@/lib/terms";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { BrandingForm } from "./branding-form";
import { NamingForm } from "./naming-form";
import { ModuleCodesForm } from "./module-codes-form";
import { CapabilitiesForm } from "./capabilities-form";
import { ClockForm } from "./clock-form";
import { DateForm } from "./date-form";
import { LeisaTargetForm } from "./leisa-target-form";
import { FeedbackQuestionsForm } from "./feedback-questions-form";
import { activeQuestionnaire } from "@/lib/feedback";
import { DEFAULT_DATE_STYLE, isDateStyle } from "@/lib/date-format";
import { ProviderLanguageForm } from "./language-form";
import { ExtensionForm } from "./extension-form";
import { MenuEditor } from "./menu-editor";
import { MailTest } from "./mail-test";
import { SsoForm } from "./sso-form";
import { SSO_KINDS, SSO_LABEL, ssoSettingsFor } from "@/lib/single-sign-on";
import { callbackAddress } from "@/app/api/sign-in/[kind]/route";
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
const DRIVE_NOTICES: Record<string, MessageKey> = {
  connected: "settings.drive.connected",
  cancelled: "settings.drive.cancelled",
  refused: "settings.drive.refused",
  state: "settings.drive.state",
  nocode: "settings.drive.nocode",
  failed: "settings.drive.failed",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ drive?: string }>;
}) {
  const tenant = await requireTenant();
  const session = await requireSession();
  const { t, locale } = await pageLocale();
  // What lib/ wrote about each AI provider and drive, in the reader's language.
  const say = sayer(locale);

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
  const driveKey = DRIVE_NOTICES[(await searchParams).drive ?? ""];
  const driveNotice = driveKey ? t(driveKey) : null;

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
  const questionnaire = canManageSettings ? await activeQuestionnaire(session) : null;
  const sso = canManageSettings ? await ssoSettingsFor(session) : [];
  const ssoCallbacks = await Promise.all(SSO_KINDS.map((kind) => callbackAddress(kind)));
  const moduleCodes = canManageSettings
    ? await proposeModuleCodeTable(session)
    : null;
  /*
   * What this provider's platform is for.
   *
   * Placed near the top of the page rather than at the foot: it decides which
   * of the sections below are even relevant, so reading it last would be
   * reading it in the wrong order.
   */
  const structure = canManageSettings ? structureOf(tenant.featureFlags) : null;
  const words = vocabulary(tenant.terminology, undefined, locale);

  /*
   * Words the shape has already settled, which nobody should be asked to set
   * twice.
   *
   * Roland, 21 September: "pointless displaying courses if the user has
   * already selected Courses/Study Units." Choosing study units is choosing
   * the word; offering a box to rename "course" afterwards invites somebody to
   * set a word the platform will never show, then wonder why.
   */
  const settled = new Set(settledTerms(tenant.featureFlags));

  // The extension is against this person's own profile, so it is offered to
  // anybody whose role includes model assistance rather than to administrators
  // alone.
  const mayUseExtension = extensionOffered() && mayUseExtensionRole;
  const extension = mayUseExtension ? await said(await extensionState(session)) : null;

  // What the editor starts from: this provider's arrangement if they have one,
  // otherwise the built-in one, with labels rather than hrefs alone.
  const menu = arrangeNavigation(tenant.navigation ?? null).map((section) => ({
    label: section.label,
    items: section.items.map((item) => ({
      href: item.href,
      // As the menu itself shows it (components/app-shell.tsx). Safe to
      // translate: a page is saved by its address, never by this label.
      // Headings stay as stored, because they are typed and saved here.
      label: item.term ? item.label : (maybe(t, `nav.${item.href}`) ?? item.label),
    })),
  }));

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("settings.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          {t("settings.intro", { name: tenant.displayName })}
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

      <div id="branding" data-settings-section={t("settings.section.branding")} className="scroll-mt-24">
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

      {structure ? (
        <div className="mt-6">
          <CapabilitiesForm
            current={structure}
            offline={tenant.offlineEnabled}
            words={{
              programme: words.one("programme"),
              studyUnit: words.one("studyUnit"),
              course: words.one("course"),
            }}
          />
        </div>
      ) : null}

      {canManageSettings ? (
        <div
          id="clock"
          data-settings-section={t("settings.section.clock")}
          className="mt-6 scroll-mt-24"
        >
          <ClockForm current={tenant.timezone} />
        </div>
      ) : null}

      {canManageSettings ? (
        <div
          id="dates"
          data-settings-section={t("settings.section.dates")}
          className="mt-6 scroll-mt-24"
        >
          <DateForm
            current={isDateStyle(tenant.dateStyle) ? tenant.dateStyle : DEFAULT_DATE_STYLE}
            timeZone={tenant.timezone}
            device={(await pageDates()).settings.device}
          />
        </div>
      ) : null}

      {canManageSettings ? (
        <div
          id="leisa"
          data-settings-section={t("settings.section.leisa")}
          className="mt-6 scroll-mt-24"
        >
          <LeisaTargetForm current={tenant.leisaTargetHours} />
        </div>
      ) : null}

      {canManageSettings && questionnaire ? (
        <div
          id="feedback"
          data-settings-section={t("settings.section.feedback")}
          className="mt-6 scroll-mt-24"
        >
          <FeedbackQuestionsForm
            questions={questionnaire.questions.map((question) => ({ prompt: question.prompt, kind: question.kind, required: question.required }))}
            scale={questionnaire.questions.find((question) => question.kind === "rating" && question.scale)?.scale ?? []}
          />
        </div>
      ) : null}

      {canManageSettings ? (
        <div
          id="language"
          data-settings-section={t("settings.section.language")}
          className="mt-6 scroll-mt-24"
        >
          <ProviderLanguageForm current={tenant.defaultLocale} />
        </div>
      ) : null}

      {canManageSettings ? (
        <div
          id="mail"
          data-settings-section={t("settings.section.mail")}
          className="mt-6 scroll-mt-24"
        >
          <Card title={t("settings.mail")} description={t("settings.mailNote")}>
            <MailTest configured={mailIsConfigured()} />
          </Card>
        </div>
      ) : null}

      {canManageSettings ? (
        <div
          id="signing-in"
          data-settings-section={t("settings.section.signingIn")}
          className="mt-6 scroll-mt-24"
        >
          <Card title={t("settings.sso")} description={t("settings.ssoNote")}>
            <div className="space-y-8">
              {SSO_KINDS.map((kind, index) => (
                <SsoForm
                  key={kind}
                  kind={kind}
                  label={SSO_LABEL[kind]}
                  callback={ssoCallbacks[index]}
                  current={sso.find((row) => row.kind === kind) ?? null}
                />
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      {canBrand ? (
        <div
          id="terminology"
          data-settings-section={t("settings.section.terminology")}
          className="mt-6 scroll-mt-24"
        >
          <Card title={t("settings.terminology")} description={t("settings.terminologyNote")}>
            <TerminologyForm
              terms={TERM_KEYS.filter((key) => !settled.has(key)).map((key) => ({
                key,
                defaultOne: t(`term.${key}.one`),
                defaultMany: t(`term.${key}.many`),
                note: t(`termsForm.note.${key}`),
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
          data-settings-section={t("settings.section.templates")}
          className="mt-6 scroll-mt-24"
        >
          <Card title={t("settings.templates")} description={t("settings.templatesNote")}>
            <p className="text-sm">
              <Link href="/templates" className="underline underline-offset-2">
                {t("settings.templatesLink")}
              </Link>
              <span className="text-[var(--muted)]">: {t("settings.templatesMoved")}</span>
            </p>
          </Card>
        </div>
      ) : null}

      {canBrand ? (
        <div
          id="menu"
          data-settings-section={t("settings.section.menu")}
          className="mt-6 scroll-mt-24"
        >
          <Card title={t("settings.menu")} description={t("settings.menuNote")}>
            <MenuEditor current={menu} />
          </Card>
        </div>
      ) : null}

      {canManageQualifications ? (
        <div
          id="drives"
          data-settings-section={t("settings.section.drives")}
          className="mt-6 scroll-mt-24"
        >
          <Card title={t("settings.drives")} description={t("settings.drivesNote")}>
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
                description: say(one.description),
              }))}
              notice={driveNotice}
            />
          </Card>
        </div>
      ) : null}

      {extension ? (
        <div
          id="extension"
          data-settings-section={t("settings.section.extension")}
          className="mt-6 scroll-mt-24"
        >
          <Card title={t("settings.extension")} description={t("settings.extensionNote")}>
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
                      description: say(provider.description),
                      runsHere: here.available,
                      reason: here.reason ? say(here.reason) : null,
                      credentialWord: provider.credentialFormat.word,
                      defaultModel: provider.defaultModel,
                      listsModels: Boolean(provider.listModels),
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

      {/*
        Beside the filename convention, because it is the same kind of setting:
        what this provider's documents look like, told to the App once rather
        than corrected on every upload.
      */}
      {moduleCodes ? (
        <div className="mt-6">
          <ModuleCodesForm
            rows={moduleCodes.rows}
            confirmed={moduleCodes.confirmed}
          />
        </div>
      ) : null}
    </AppShell>
  );
}
