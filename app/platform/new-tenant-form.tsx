"use client";

import { useActionState, useState } from "react";
import { createTenantAction, type PlatformState } from "./actions";

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

export function NewTenantForm() {
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
        Set up a new client
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
        Creates the organisation and its first administrator together. A client
        without an administrator cannot be handed over, so the platform does
        not let you make one.
      </p>

      {state.password ? (
        <div className="mt-4 rounded-md border-2 border-[var(--success)]/40 bg-[var(--success)]/5 p-4">
          <p className="text-sm font-medium">{state.notice}</p>
          <p className="mt-2 text-sm">
            Their address:{" "}
            <span className="font-mono">{state.tenantUrl}.…</span>
          </p>
          <p className="mt-3 text-sm">
            Administrator&rsquo;s password — shown once, hand it over directly:
          </p>
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
            <span className="block text-sm font-medium">
              Registered legal name
            </span>
            <input name="legalName" required className={inputClass} />
            <span className="block text-xs text-[var(--muted)]">
              As it appears on statutory returns.
            </span>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Display name</span>
            <input name="displayName" required className={inputClass} />
            <span className="block text-xs text-[var(--muted)]">
              What their people see at the top of every page.
            </span>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Web address</span>
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
              Their own domain{" "}
              <span className="font-normal text-[var(--muted)]">(optional)</span>
            </span>
            <input
              name="customDomain"
              placeholder="learning.acmemining.co.za"
              className={inputClass}
            />
            <span className="block text-xs text-[var(--muted)]">
              Needs a DNS record pointing here before it will work.
            </span>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Deployment</span>
            <select
              name="deploymentMode"
              defaultValue="shared_cloud"
              className={inputClass}
            >
              <option value="shared_cloud">Shared cloud</option>
              <option value="dedicated_cloud">Dedicated cloud</option>
              <option value="on_premise">On premise</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              Keep records for (years)
            </span>
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
          <legend className="px-1 text-sm font-medium">Their branding</legend>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block space-y-1.5">
              <span className="block text-sm font-medium">Main colour</span>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={primary}
                  onChange={(event) => setPrimary(event.target.value)}
                  className="h-9 w-12 rounded border border-[var(--border)]"
                  aria-label="Main colour"
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
              <span className="block text-sm font-medium">Accent colour</span>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={accent}
                  onChange={(event) => setAccent(event.target.value)}
                  className="h-9 w-12 rounded border border-[var(--border)]"
                  aria-label="Accent colour"
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
                Logo address{" "}
                <span className="font-normal text-[var(--muted)]">
                  (optional)
                </span>
              </span>
              <input name="logoUrl" className={inputClass} />
            </label>
          </div>

          {/* Shows the client's identity rather than describing it. */}
          <div
            className="rounded-md border-b-4 px-4 py-3 text-white"
            style={{ background: primary, borderColor: accent }}
          >
            <p className="text-sm font-semibold">
              How their people will see it
            </p>
            <p className="text-xs opacity-75">Learning Management System</p>
          </div>
        </fieldset>

        <fieldset className="space-y-2 rounded-md border border-[var(--border)] p-4">
          <legend className="px-1 text-sm font-medium">
            What this client gets
          </legend>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="learning_paths" defaultChecked className="mt-1" />
            <span>Learning paths</span>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="qcto_portfolio" className="mt-1" />
            <span>
              QCTO portfolio of evidence
              <span className="block text-xs text-[var(--muted)]">
                For an accredited Skills Development Provider. An internal
                training department does not need it.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="statutory_reporting" className="mt-1" />
            <span>
              SAQA and SETA returns
              <span className="block text-xs text-[var(--muted)]">
                NLRD exports and WSP/ATR reporting.
              </span>
            </span>
          </label>
        </fieldset>

        <fieldset className="grid gap-3 rounded-md border border-[var(--border)] p-4 sm:grid-cols-3">
          <legend className="px-1 text-sm font-medium">
            Their first administrator
          </legend>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">First name</span>
            <input name="adminFirstName" required className={inputClass} />
          </label>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Last name</span>
            <input name="adminLastName" required className={inputClass} />
          </label>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Email</span>
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
            Accreditation{" "}
            <span className="font-normal text-[var(--muted)]">
              (only for an accredited provider)
            </span>
          </legend>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              Accreditation number
            </span>
            <input name="accreditationNumber" className={inputClass} />
          </label>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Ward code</span>
            <input name="wardCode" className={inputClass} />
          </label>
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              Quality assurance partner
            </span>
            <input name="qualityAssurancePartner" className={inputClass} />
          </label>
        </fieldset>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? "Setting up…" : "Set up this client"}
        </button>
      </form>
    </section>
  );
}
