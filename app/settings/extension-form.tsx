"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui";
import { updateExtensionAction, type ExtensionState } from "./actions";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

export type ExtensionView = {
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
 * Switching an AI extension on, per tenant.
 *
 * Off until somebody turns it on, and there is no field for a credential
 * anywhere on this form. The subscription-backed provider holds its own
 * sign-in on the machine the platform runs on; the platform never sees one.
 */
export function ExtensionForm({ current }: { current: ExtensionView }) {
  const [state, action, saving] = useActionState<ExtensionState, FormData>(
    updateExtensionAction,
    {},
  );
  const [enabled, setEnabled] = useState(current.enabled);

  return (
    <Card
      title="AI extension"
      description="Optional, off by default, and switched on per tenant. With none enabled the platform behaves exactly as it does now."
    >
      <form action={action} className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="enabled"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          Use an AI extension
        </label>

        {enabled ? (
          <>
            <label className="block text-sm">
              <span className="text-[var(--muted)]">Provider</span>
              <select
                name="provider"
                defaultValue={current.provider ?? "claude_code"}
                className={`${inputClass} mt-1 block w-full max-w-md`}
              >
                {current.providers.map((provider) => (
                  <option key={provider.name} value={provider.name}>
                    {provider.label}
                  </option>
                ))}
              </select>
              {current.providers.map((provider) =>
                provider.name === (current.provider ?? "claude_code") ? (
                  <span
                    key={provider.name}
                    className="mt-1 block text-xs text-[var(--muted)]"
                  >
                    {provider.description}
                  </span>
                ) : null,
              )}
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

            <label className="block text-sm">
              <span className="text-[var(--muted)]">
                Folders an import may read, one per line
              </span>
              <textarea
                name="allowedImportRoots"
                rows={3}
                defaultValue={current.allowedImportRoots.join("\n")}
                placeholder="F:\\Qualifications"
                className={`${inputClass} mt-1 block w-full max-w-md font-mono`}
              />
              <span className="mt-1 block max-w-2xl text-xs text-[var(--muted)]">
                On the machine running the platform, not on yours, if those
                differ. An allow-list rather than a free path: a server process
                given any folder can read anything it can reach, including its
                own configuration. Empty means no import can run.
              </span>
            </label>

            {current.availability ? (
              current.availability.available ? (
                <p className="text-sm text-[var(--success)]">
                  Available.
                  {current.availability.detail ? (
                    <span className="ml-2 font-mono text-xs text-[var(--muted)]">
                      {current.availability.detail}
                    </span>
                  ) : null}
                </p>
              ) : (
                <div className="rounded-md border border-[var(--border)] p-3 text-sm">
                  <p className="font-medium">Not available here</p>
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
          </>
        ) : null}

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
    </Card>
  );
}
