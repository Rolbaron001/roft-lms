"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n";
import { linkMaterialAction, removeMaterialAction, unlinkMaterialAction, type MaterialState } from "./actions";

export type LinkableUnit = { id: string; label: string; steps: { id: string; title: string }[] };

const field =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

/** A study unit, and the step its material is released with. */
function UnitAndStep({ units, fixedUnitId }: { units: LinkableUnit[]; fixedUnitId?: string }) {
  const t = useT();
  const [unitId, setUnitId] = useState(fixedUnitId ?? "");
  const unit = units.find((one) => one.id === unitId);
  return (
    <>
      {fixedUnitId ? (
        <input type="hidden" name="studyUnitId" value={fixedUnitId} />
      ) : (
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("material.unit")}</span>
          <select name="studyUnitId" value={unitId} onChange={(event) => setUnitId(event.target.value)} className={field}>
            <option value="">{t("material.unitNone")}</option>
            {units.map((one) => (
              <option key={one.id} value={one.id}>
                {one.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {unit && unit.steps.length > 0 ? (
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("material.releaseWith")}</span>
          <select name="releaseWithStepId" defaultValue="" className={field}>
            <option value="">{t("material.releaseWithUnit")}</option>
            {unit.steps.map((step) => (
              <option key={step.id} value={step.id}>
                {step.title}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-[var(--muted)]">{t("material.releaseWithHint")}</span>
        </label>
      ) : null}
    </>
  );
}

/**
 * Adding a file to the library. Sent to /api/material rather than through a
 * server action, because a video can be hundreds of megabytes.
 */
export function UploadMaterial({ units, fixedUnitId }: { units: LinkableUnit[]; fixedUnitId?: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/material", { method: "POST", body: new FormData(form) });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (result.ok) {
        setMessage({ ok: true, text: t("material.added") });
        form.reset();
        router.refresh();
      } else {
        setMessage({ ok: false, text: result.error ?? t("material.failed") });
      }
    } catch {
      setMessage({ ok: false, text: t("material.failed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm sm:col-span-2">
        <span className="mb-1 block font-medium">{t("material.file")}</span>
        <input name="file" type="file" required className="block w-full text-sm" />
        <span className="mt-1 block text-xs text-[var(--muted)]">{t("material.fileHint")}</span>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">{t("material.title")}</span>
        <input name="title" className={field} placeholder={t("material.titleHint")} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">{t("material.description")}</span>
        <input name="description" className={field} />
      </label>
      <UnitAndStep units={units} fixedUnitId={fixedUnitId} />
      <div className="sm:col-span-2">
        <button type="submit" disabled={busy} className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {busy ? t("material.uploading") : t("material.upload")}
        </button>
        {message ? (
          <p role={message.ok ? undefined : "alert"} className={`mt-2 text-sm ${message.ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
            {message.text}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/** Using an item on another study unit. */
export function LinkMaterial({ itemId, units }: { itemId: string; units: LinkableUnit[] }) {
  const t = useT();
  const [state, action, pending] = useActionState<MaterialState, FormData>(linkMaterialAction, {});
  return (
    <form action={action} className="mt-3 grid gap-2 sm:grid-cols-3 sm:items-end">
      <input type="hidden" name="itemId" value={itemId} />
      <UnitAndStep units={units} />
      <div>
        <button type="submit" disabled={pending} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-60">
          {t("material.use")}
        </button>
        {state.error ? <p role="alert" className="mt-1 text-xs text-[var(--danger)]">{state.error}</p> : null}
      </div>
    </form>
  );
}

export function UnlinkMaterial({ linkId }: { linkId: string }) {
  const t = useT();
  const [, action, pending] = useActionState<MaterialState, FormData>(unlinkMaterialAction, {});
  return (
    <form action={action} className="inline">
      <input type="hidden" name="linkId" value={linkId} />
      <button type="submit" disabled={pending} className="text-xs text-[var(--danger)] underline-offset-2 hover:underline disabled:opacity-60">
        {t("material.takeOff")}
      </button>
    </form>
  );
}

export function RemoveMaterial({ itemId }: { itemId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState<MaterialState, FormData>(removeMaterialAction, {});
  return (
    <form action={action} className="inline">
      <input type="hidden" name="itemId" value={itemId} />
      <button type="submit" disabled={pending} className="text-xs text-[var(--danger)] underline-offset-2 hover:underline disabled:opacity-60">
        {t("material.remove")}
      </button>
      {state.error ? <span role="alert" className="ml-2 text-xs text-[var(--danger)]">{state.error}</span> : null}
    </form>
  );
}
