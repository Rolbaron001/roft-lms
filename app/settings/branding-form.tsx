"use client";

import { useActionState, useState } from "react";
import { TenantLogo } from "@/components/tenant-logo";
import { updateBrandingAction, type BrandingState } from "./actions";

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

export function BrandingForm({
  defaults,
}: {
  defaults: {
    displayName: string;
    primaryColour: string;
    accentColour: string;
    logoUrl: string | null;
  };
}) {
  const [state, action, pending] = useActionState<BrandingState, FormData>(
    updateBrandingAction,
    {},
  );

  const [name, setName] = useState(defaults.displayName);
  const [primary, setPrimary] = useState(defaults.primaryColour);
  const [accent, setAccent] = useState(defaults.accentColour);
  const [logo, setLogo] = useState(defaults.logoUrl ?? "");

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
      {state.error ? (
        <p
          role="alert"
          className="mb-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="mb-4 rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
          {state.notice}
        </p>
      ) : null}

      {/* Updates as the colours change, so the choice is made by looking
          rather than by imagining a hex code. */}
      <div
        className="mb-6 rounded-md border-b-4 px-5 py-4 text-white"
        style={{ background: primary, borderColor: accent }}
      >
        <div className="flex items-center gap-3">
          {logo ? (
            <TenantLogo logoUrl={logo} displayName={name} height={36} />
          ) : null}
          <div>
            <p className="text-base font-semibold">
              {name || "Your organisation"}
            </p>
            <p className="text-xs opacity-75">Learning Management System</p>
          </div>
        </div>
        <span
          className="mt-3 inline-block rounded-full px-3 py-1 text-xs font-medium"
          style={{ background: accent, color: primary }}
        >
          Certificate of Competence
        </span>
      </div>

      <form action={action} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Organisation name</span>
          <input
            name="displayName"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputClass}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
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
            <span className="block text-xs text-[var(--muted)]">
              Headers, buttons and certificates.
            </span>
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
            <span className="block text-xs text-[var(--muted)]">
              Highlights, progress bars and certificate borders.
            </span>
          </label>
        </div>

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">
            Logo address{" "}
            <span className="font-normal text-[var(--muted)]">(optional)</span>
          </span>
          <input
            name="logoUrl"
            value={logo}
            onChange={(event) => setLogo(event.target.value)}
            placeholder="https://…"
            className={inputClass}
          />
          <span className="block text-xs text-[var(--muted)]">
            A web address for the image. It appears in the header, on the sign-in
            page and on every certificate. A transparent PNG or an SVG sits best
            on the header colour. Uploading a file directly comes with the
            document and video work.
          </span>
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--brand-primary)" }}
        >
          {pending ? "Saving…" : "Save appearance"}
        </button>
      </form>
    </section>
  );
}
