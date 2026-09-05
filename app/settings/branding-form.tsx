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
    signInGraphicUrl: string | null;
    strapline: string | null;
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
  const [uploading, setUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [graphic, setGraphic] = useState(defaults.signInGraphicUrl ?? "");
  const [strapline, setStrapline] = useState(defaults.strapline ?? "");

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
        {/*
          This preview used to carry a "Certificate of Competence" chip, to
          show the accent colour against the primary one.

          It was removed rather than reworded. Under the OQSF the certificate
          for an occupational qualification is issued by the QCTO through SAQA,
          not by the provider - so a provider's own settings page displaying
          that phrase as if it were theirs to award is wrong, and wrong in a way
          a client could reasonably repeat to a learner. The accent colour is
          shown on the band below instead, which demonstrates the same thing
          and claims nothing.
        */}
        <span
          className="mt-3 block h-1.5 w-24 rounded-full"
          style={{ background: accent }}
        />
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

        <div className="space-y-2 rounded-md border border-[var(--border)] p-4">
          <span className="block text-sm font-medium">Logo</span>
          <p className="text-xs text-[var(--muted)]">
            Appears in the header, on the sign-in page and on every certificate.
            A PNG with a transparent background sits best on the header colour.
            Under 2 MB.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <label className="cursor-pointer rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium transition hover:bg-[var(--brand-accent)]/10">
              {uploading ? "Uploading…" : "Choose an image"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="sr-only"
                disabled={uploading}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;

                  setUploading(true);
                  setLogoError(null);
                  try {
                    const body = new FormData();
                    body.append("file", file);
                    const response = await fetch("/api/branding/logo", {
                      method: "POST",
                      body,
                    });
                    const result = await response.json();
                    if (!response.ok) {
                      setLogoError(result.error ?? "That image was not accepted.");
                      return;
                    }
                    // Saved already — the upload writes it. Reflecting it in the
                    // field means saving the form afterwards keeps it rather
                    // than overwriting it with what was there before.
                    setLogo(result.logoUrl);
                  } catch {
                    setLogoError(
                      "The upload did not finish. Check the connection and try again.",
                    );
                  } finally {
                    setUploading(false);
                  }
                }}
              />
            </label>

            {logo ? (
              <button
                type="button"
                onClick={() => setLogo("")}
                className="text-xs underline underline-offset-2 text-[var(--muted)]"
              >
                Remove, and show the name instead
              </button>
            ) : null}
          </div>

          {logoError ? (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {logoError}
            </p>
          ) : null}

          <label className="block space-y-1.5 pt-2">
            <span className="block text-xs font-medium text-[var(--muted)]">
              Or an address, if the image is already hosted elsewhere
            </span>
            <input
              name="logoUrl"
              value={logo}
              onChange={(event) => setLogo(event.target.value)}
              placeholder="https://…"
              className={inputClass}
            />
          </label>
        </div>

        <div className="space-y-3 rounded-md border border-[var(--border)] p-4">
          <span className="block text-sm font-medium">The sign-in page</span>
          <p className="text-xs text-[var(--muted)]">
            Optional. With nothing here the page shows your name on your own
            colour, which is tidy but plain. A graphic that says something true
            about what you do is worth more than a decorative one.
          </p>

          <label className="block space-y-1.5">
            <span className="block text-xs font-medium text-[var(--muted)]">
              Graphic address
            </span>
            <input
              name="signInGraphicUrl"
              value={graphic}
              onChange={(event) => setGraphic(event.target.value)}
              placeholder="https://…"
              className={inputClass}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-xs font-medium text-[var(--muted)]">
              A line under it
            </span>
            <input
              name="strapline"
              value={strapline}
              onChange={(event) => setStrapline(event.target.value)}
              maxLength={120}
              placeholder="Lifelong curiosity"
              className={inputClass}
            />
          </label>
        </div>

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
