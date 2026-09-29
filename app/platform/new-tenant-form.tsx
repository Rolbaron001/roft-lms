"use client";

import { DEFAULT_TIME_ZONE, supportedTimeZones } from "@/lib/timezone";

import { useActionState, useState } from "react";
import { createTenantAction, type PlatformState } from "./actions";
import {
  AWARD_CHOICES,
  DELIVERY_CHOICES,
  DEFAULT_STRUCTURE,
} from "@/lib/features";
import { useT } from "@/components/i18n";
import { maybe } from "@/lib/i18n/maybe";

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

export function NewTenantForm() {
  const t = useT();
  const said = (group: "award" | "delivery", value: string, part: "label" | "when", english: string) =>
    maybe(t, `shape.${group}.${value}.${part}`) ?? english;
  const [state, action, pending] = useActionState<PlatformState, FormData>(
    createTenantAction,
    {},
  );

  const [slug, setSlug] = useState("");
  const [primary, setPrimary] = useState("#0D1E32");
  const [accent, setAccent] = useState("#B9975B");

  return (
    <section className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        {t("newTenant.title")}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("newTenant.intro")}</p>

      {state.password ? (
        <div className="mt-4 rounded-md border-2 border-[var(--success)]/40 bg-[var(--success)]/5 p-4">
          <p className="text-sm font-medium">{state.notice}</p>
          <p className="mt-2 text-sm">
            {t("newTenant.address")} <span className="font-mono">{state.tenantUrl}.…</span>
          </p>
          <p className="mt-3 text-sm">{t("newTenant.password")}</p>
          <p className="mt-1 font-mono text-lg font-semibold">
            {state.password}
          </p>
        </div>
      ) : null}

      {state.error ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}

      <form action={action} className="mt-4 space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("newTenant.legalName")}</span>
            <input name="legalName" required className={inputClass} />
            <span className="block text-xs text-[var(--muted)]">{t("newTenant.legalNameNote")}</span>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("newTenant.displayName")}</span>
            <input name="displayName" required className={inputClass} />
            <span className="block text-xs text-[var(--muted)]">{t("newTenant.displayNameNote")}</span>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("newTenant.webAddress")}</span>
            <input
              name="slug"
              required
              value={slug}
              onChange={(event) =>
                setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
              }
              placeholder="acme"
              className={`${inputClass} font-mono`}
            />
            <span className="block text-xs text-[var(--muted)]">
              {slug ? `${slug}.lms.roftbusiness.org` : "name.lms.roftbusiness.org"}
            </span>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              {t("newTenant.ownDomain")}{" "}
              <span className="font-normal text-[var(--muted)]">{t("common.optional")}</span>
            </span>
            <input
              name="customDomain"
              placeholder="learning.acmemining.co.za"
              className={inputClass}
            />
            <span className="block text-xs text-[var(--muted)]">{t("newTenant.ownDomainNote")}</span>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("newTenant.deployment")}</span>
            <select
              name="deploymentMode"
              defaultValue="shared_cloud"
              className={inputClass}
            >
              <option value="shared_cloud">{t("platformPage.mode.shared_cloud")}</option>
              <option value="dedicated_cloud">{t("platformPage.mode.dedicated_cloud")}</option>
              <option value="on_premise">{t("platformPage.mode.on_premise")}</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("newTenant.zone")}</span>
            <select
              name="timezone"
              defaultValue={DEFAULT_TIME_ZONE}
              className={inputClass}
            >
              {supportedTimeZones().map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <span className="block text-xs text-[var(--muted)]">{t("newTenant.zoneNote")}</span>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("newTenant.retention")}</span>
            <input
              name="dataRetentionYears"
              type="number"
              min={1}
              max={50}
              defaultValue={5}
              className={inputClass}
            />
          </label>
        </div>

        <fieldset className="space-y-3 rounded-md border border-[var(--border)] p-4">
          <legend className="px-1 text-sm font-medium">{t("newTenant.branding")}</legend>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block space-y-1.5">
              <span className="block text-sm font-medium">{t("brand.main")}</span>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={primary}
                  onChange={(event) => setPrimary(event.target.value)}
                  className="h-9 w-12 rounded border border-[var(--border)]"
                  aria-label={t("brand.main")}
                />
                <input
                  name="primaryColour"
                  value={primary}
                  onChange={(event) => setPrimary(event.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </label>

            <label className="block space-y-1.5">
              <span className="block text-sm font-medium">{t("brand.accent")}</span>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={accent}
                  onChange={(event) => setAccent(event.target.value)}
                  className="h-9 w-12 rounded border border-[var(--border)]"
                  aria-label={t("brand.accent")}
                />
                <input
                  name="accentColour"
                  value={accent}
                  onChange={(event) => setAccent(event.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </label>

            <label className="block space-y-1.5">
              <span className="block text-sm font-medium">
                {t("newTenant.logo")}{" "}
                <span className="font-normal text-[var(--muted)]">{t("common.optional")}</span>
              </span>
              <input name="logoUrl" className={inputClass} />
            </label>
          </div>

          {/* Shows the client's identity rather than describing it. */}
          <div
            className="rounded-md border-b-4 px-4 py-3 text-white"
            style={{ background: primary, borderColor: accent }}
          >
            <p className="text-sm font-semibold">{t("newTenant.preview")}</p>
            <p className="text-xs opacity-75">{t("brand.system")}</p>
          </div>
        </fieldset>

        <fieldset className="space-y-2 rounded-md border border-[var(--border)] p-4">
          <legend className="px-1 text-sm font-medium">{t("newTenant.gets")}</legend>

          {/*
            Two questions rather than a row of switches.

            Roland, 21 September: "We have already determined that Course and
            Study Unit are the same thing in terms of where they rank. What the
            selection needs to do is to determine how the users view them." A
            checkbox each would let somebody create a tenant with study units
            and no qualification for them to sit in.

            Neither word belongs to the regulator, and this form does not
            suggest otherwise. Counted in the project's own documents, "study
            unit" appears nowhere in the QCTO curriculum, qualification
            document, assessment specification or SAQA's NQFpedia.

            The full set is editable afterwards under Settings, so a wrong
            answer here is not permanent.
          */}
          <p className="text-xs font-medium">{t("shape.top")}</p>
          {AWARD_CHOICES.map((choice) => (
            <label key={choice.value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="award"
                value={choice.value}
                defaultChecked={choice.value === DEFAULT_STRUCTURE.award}
                className="mt-1"
              />
              <span>
                {said("award", choice.value, "label", choice.label)}
                <span className="block text-xs text-[var(--muted)]">
                  {said("award", choice.value, "when", choice.chooseWhen)}
                </span>
              </span>
            </label>
          ))}

          <p className="mt-3 text-xs font-medium">{t("shape.works")}</p>
          {DELIVERY_CHOICES.map((choice) => (
            <label key={choice.value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="delivery"
                value={choice.value}
                defaultChecked={choice.value === DEFAULT_STRUCTURE.delivery}
                className="mt-1"
              />
              <span>
                {said("delivery", choice.value, "label", choice.label)}
                <span className="block text-xs text-[var(--muted)]">
                  {said("delivery", choice.value, "when", choice.chooseWhen)}
                </span>
              </span>
            </label>
          ))}

          <label className="mt-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="statutory_reporting"
              defaultChecked
              className="mt-1"
            />
            <span>
              {t("shape.statutory")}
              <span className="block text-xs text-[var(--muted)]">{t("newTenant.statutoryNote")}</span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="workplace_experience"
              defaultChecked
              className="mt-1"
            />
            <span>
              {t("shape.workplace")}
              <span className="block text-xs text-[var(--muted)]">{t("newTenant.workplaceNote")}</span>
            </span>
          </label>
</fieldset>

        <fieldset className="grid gap-3 rounded-md border border-[var(--border)] p-4 sm:grid-cols-3">
          <legend className="px-1 text-sm font-medium">{t("newTenant.admin")}</legend>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("newTenant.firstName")}</span>
            <input name="adminFirstName" required className={inputClass} />
          </label>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("newTenant.lastName")}</span>
            <input name="adminLastName" required className={inputClass} />
          </label>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("newTenant.email")}</span>
            <input
              name="adminEmail"
              type="email"
              required
              className={inputClass}
            />
          </label>
        </fieldset>

        <fieldset className="grid gap-3 rounded-md border border-[var(--border)] p-4 sm:grid-cols-3">
          <legend className="px-1 text-sm font-medium">
            {t("newTenant.accreditation")}{" "}
            <span className="font-normal text-[var(--muted)]">{t("newTenant.accreditationNote")}</span>
          </legend>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("newTenant.accreditationNumber")}</span>
            <input name="accreditationNumber" className={inputClass} />
          </label>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("newTenant.ward")}</span>
            <input name="wardCode" className={inputClass} />
          </label>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("newTenant.partner")}</span>
            <input name="qualityAssurancePartner" className={inputClass} />
          </label>
        </fieldset>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? t("newTenant.settingUp") : t("newTenant.setUp")}
        </button>
      </form>
    </section>
  );
}
