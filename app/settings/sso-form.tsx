"use client";

import { useActionState } from "react";
import { removeSsoAction, saveSsoAction, type SsoState } from "./sso-actions";

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

type Current = {
  clientId: string;
  secretHint: string;
  directoryId: string | null;
  allowedDomains: string[];
  enabled: boolean;
} | null;

function Message({ state }: { state: SsoState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]">
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
        {state.notice}
      </p>
    );
  }
  return null;
}

/** One way of signing in: Google or Microsoft (job sheet D7). */
export function SsoForm({
  kind,
  label,
  callback,
  current,
}: {
  kind: "google" | "microsoft";
  label: string;
  /** The address to register with the provider, exactly. */
  callback: string;
  current: Current;
}) {
  const [saved, save, saving] = useActionState<SsoState, FormData>(saveSsoAction, {});
  const [removed, remove, removing] = useActionState<SsoState, FormData>(removeSsoAction, {});

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">
        {label}{" "}
        <span className="font-normal text-[var(--muted)]">
          {current ? (current.enabled ? "· on" : "· switched off") : "· not set up"}
        </span>
      </h3>
      <p className="text-xs text-[var(--muted)]">
        Register this platform with your organisation&rsquo;s {label} account and give it this address to send people back
        to, exactly as written:{" "}
        <span className="break-all font-mono text-[var(--foreground,inherit)]">{callback}</span>
      </p>

      <form action={save} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="kind" value={kind} />
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Client ID</span>
          <input name="clientId" required defaultValue={current?.clientId ?? ""} autoComplete="off" className={inputClass} />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">
            Client secret{" "}
            {current?.secretHint ? (
              <span className="font-normal text-[var(--muted)]">(held, ending {current.secretHint}; blank keeps it)</span>
            ) : null}
          </span>
          <input name="clientSecret" type="password" required={!current} autoComplete="new-password" className={inputClass} />
        </label>
        {kind === "microsoft" ? (
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="block text-sm font-medium">Directory (tenant) ID</span>
            <input
              name="directoryId"
              required
              defaultValue={current?.directoryId ?? ""}
              placeholder="From the app's Overview page in Microsoft Entra"
              className={inputClass}
            />
          </label>
        ) : null}
        <label className="block space-y-1.5 sm:col-span-2">
          <span className="block text-sm font-medium">
            Only these email domains{" "}
            <span className="font-normal text-[var(--muted)]">(optional, separated by commas)</span>
          </span>
          <input
            name="allowedDomains"
            defaultValue={current?.allowedDomains.join(", ") ?? ""}
            placeholder="example.org"
            className={inputClass}
          />
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input name="enabled" type="checkbox" defaultChecked={current?.enabled ?? true} />
          Offer &ldquo;Sign in with {label}&rdquo; on the sign-in page
        </label>
        <div className="space-y-2 sm:col-span-2">
          <Message state={saved} />
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : current ? "Save changes" : `Set up ${label}`}
          </button>
        </div>
      </form>

      {current ? (
        <form action={remove} className="space-y-2">
          <input type="hidden" name="kind" value={kind} />
          <button
            type="submit"
            disabled={removing}
            className="rounded-md border border-[var(--danger)]/40 px-3 py-1.5 text-sm text-[var(--danger)] disabled:opacity-60"
          >
            {removing ? "Removing…" : `Remove ${label} and forget its secret`}
          </button>
          <Message state={removed} />
        </form>
      ) : null}
    </div>
  );
}
