"use client";

import { useActionState, useState } from "react";
import {
  updateMyExtensionAction,
  type AccountActionState,
} from "./actions";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

export type MyExtensionView = {
  enabled: boolean;
  provider: string | null;
  model: string | null;
  allowedImportRoots: string[];
  availability: {
    available: boolean;
    reason?: string;
    remedy?: string;
    detail?: string;
  } | null;
  providers: { name: string; label: string; description: string }[];
};

/**
 * Your own AI extension.
 *
 * On your account page rather than in tenant settings, because it is a tool you
 * use while doing your own work and not a decision somebody makes on your
 * behalf. Every member of the provider's staff has their own.
 */
export function MyExtension({ current }: { current: MyExtensionView }) {
  const [state, action, saving] = useActionState<AccountActionState, FormData>(
    updateMyExtensionAction,
    {},
  );
  const [enabled, setEnabled] = useState(current.enabled);
  const [provider, setProvider] = useState(
    current.provider ?? current.providers[0]?.name ?? "",
  );

  const chosen = current.providers.find((row) => row.name === provider);

  return (
    <form action={action} className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        Use an AI extension in my work
      </label>

      {enabled ? (
        <>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Which one</span>
            <select
              name="provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              className={`${inputClass} mt-1 block w-full max-w-md`}
            >
              {current.providers.map((row) => (
                <option key={row.name} value={row.name}>
                  {row.label}
                </option>
              ))}
            </select>
            {chosen ? (
              <span className="mt-1 block max-w-2xl text-xs text-[var(--muted)]">
                {chosen.description}
              </span>
            ) : null}
          </label>

          <label className="block text-sm">
            <span className="text-[var(--muted)]">
              Model — leave empty for the provider&rsquo;s own default
            </span>
            <input
              name="model"
              defaultValue={current.model ?? ""}
              placeholder="claude-opus-5"
              className={`${inputClass} mt-1 block w-full max-w-md`}
            />
          </label>

          {current.availability ? (
            current.availability.available ? (
              <p className="text-sm text-[var(--success)]">
                Ready.
                {current.availability.detail ? (
                  <span className="ml-2 font-mono text-xs text-[var(--muted)]">
                    {current.availability.detail}
                  </span>
                ) : null}
              </p>
            ) : (
              <div className="rounded-md border border-[var(--border)] p-3 text-sm">
                <p className="font-medium">Not available on this machine</p>
                <p className="mt-1 text-[var(--muted)]">
                  {current.availability.reason}
                </p>
                {current.availability.remedy ? (
                  <p className="mt-1 text-[var(--muted)]">
                    {current.availability.remedy}
                  </p>
                ) : null}
              </div>
            )
          ) : null}

          {/*
            Said plainly, because the alternative is somebody assuming their own
            subscription is being used when on a shared server it is not.
          */}
          <p className="max-w-2xl rounded-md border border-[var(--border)] p-3 text-xs text-[var(--muted)]">
            <span className="font-medium">Whose subscription this uses.</span>{" "}
            The extension runs on the machine the platform is running on, not on
            yours. Where that is a shared server, everybody&rsquo;s work goes
            through whichever Claude sign-in is on that server. Where you run the
            platform on your own machine, it uses your own sign-in. Either way
            the platform never sees a credential: there is no field here for one
            and no column for one.
          </p>

          {current.allowedImportRoots.length === 0 ? (
            <p className="max-w-2xl text-xs text-[var(--muted)]">
              Reading a folder of documents also needs an administrator to list
              which folders may be read. None have been listed yet, so the rest
              of the extension will work and folder imports will not.
            </p>
          ) : null}
        </>
      ) : (
        <p className="max-w-2xl text-xs text-[var(--muted)]">
          With this off, the platform behaves exactly as it does now — the
          affordances are absent rather than offered and failing.
        </p>
      )}

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--muted)]">{state.notice}</p>
      ) : null}

      <button
        type="submit"
        disabled={saving}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
