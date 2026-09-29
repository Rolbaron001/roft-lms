"use client";

import { useActionState } from "react";
import { removeStoreAction, saveStoreAction, sendNowAction, type StoreState } from "./actions";
import { useT } from "@/components/i18n";

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

type Store = {
  endpoint: string;
  username: string;
  secretHint: string;
  enabled: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  delivered: number;
};

function Message({ state }: { state: StoreState }) {
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

/** Connecting the provider's own learning record store (job sheet D6). */
export function StoreForm({ store }: { store: Store | null }) {
  const t = useT();
  const [saved, save, saving] = useActionState<StoreState, FormData>(saveStoreAction, {});
  const [sent, sendNow, sending] = useActionState<StoreState>(sendNowAction, {});
  const [removed, remove, removing] = useActionState<StoreState>(removeStoreAction, {});

  return (
    <div className="space-y-4">
      {store ? (
        <div className="space-y-1 text-sm">
          <p>
            {store.enabled ? t("lrs.sendingTo") : t("lrs.connectedOff")}{" "}
            <span className="font-mono text-xs">{store.endpoint}</span>
          </p>
          <p className="text-[var(--muted)]">
            {store.lastSuccessAt
              ? t("lrs.acceptedLast", { count: store.delivered, date: store.lastSuccessAt })
              : store.delivered === 1
                ? t("lrs.acceptedOne")
                : t("lrs.accepted", { count: store.delivered })}
          </p>
          {store.lastError ? (
            <p role="alert" className="text-[var(--danger)]">
              {store.lastAttemptAt
                ? t("lrs.lastAttemptAt", { date: store.lastAttemptAt, error: store.lastError })
                : t("lrs.lastAttempt", { error: store.lastError })}
            </p>
          ) : null}
        </div>
      ) : null}

      <form action={save} className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5 sm:col-span-2">
          <span className="block text-sm font-medium">{t("lrs.address")}</span>
          <input
            name="endpoint"
            type="url"
            required
            defaultValue={store?.endpoint ?? ""}
            placeholder="https://records.example.com/xapi"
            className={inputClass}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">{t("lrs.key")}</span>
          <input name="username" required defaultValue={store?.username ?? ""} autoComplete="off" className={inputClass} />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">
            {t("lrs.secret")}{" "}
            {store?.secretHint ? (
              <span className="font-normal text-[var(--muted)]">{t("lrs.secretHeld", { hint: store.secretHint })}</span>
            ) : null}
          </span>
          <input name="secret" type="password" required={!store} autoComplete="new-password" className={inputClass} />
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input name="enabled" type="checkbox" defaultChecked={store?.enabled ?? true} />
          {t("lrs.hourly")}
        </label>
        <div className="space-y-2 sm:col-span-2">
          <Message state={saved} />
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? t("common.saving") : store ? t("lrs.saveChanges") : t("lrs.connect")}
          </button>
        </div>
      </form>

      {store ? (
        <div className="flex flex-wrap items-start gap-3">
          <form action={sendNow}>
            <button
              type="submit"
              disabled={sending || !store.enabled}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60"
            >
              {sending ? t("lrs.sending") : t("lrs.sendNow")}
            </button>
          </form>
          <form action={remove}>
            <button
              type="submit"
              disabled={removing}
              className="rounded-md border border-[var(--danger)]/40 px-3 py-1.5 text-sm text-[var(--danger)] disabled:opacity-60"
            >
              {removing ? t("lrs.disconnecting") : t("lrs.disconnect")}
            </button>
          </form>
          <div className="w-full space-y-2">
            <Message state={sent} />
            <Message state={removed} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
