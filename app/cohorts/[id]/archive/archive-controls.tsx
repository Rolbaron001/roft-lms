"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CHUNK_BYTES, ChunkedFingerprint } from "@/lib/archive-format";
import {
  abandonAction,
  confirmCopyAction,
  finishRestoreAction,
  removeFilesAction,
  startArchiveAction,
  type ArchiveActionState,
} from "./actions";
import { useDates, useT } from "@/components/i18n";

/**
 * The archive's controls. Everything that touches the provider's saved copy
 * happens here, in their browser, because that is where the copy is.
 */

const button =
  "rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60";

/** The restore route's limit, repeated here so this file imports nothing from the server. */
const RESTORE_PIECE = 16 * 1024 * 1024;

function Outcome({ state }: { state: ArchiveActionState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="mt-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
      >
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="mt-3 rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
        {state.notice}
      </p>
    );
  }
  return null;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

function percent(done: number, total: number): string {
  return `${total === 0 ? 100 : Math.floor((done / total) * 100)}%`;
}

export function StartArchive({ cohortId, ready }: { cohortId: string; ready: number }) {
  const t = useT();
  const [state, act, working] = useActionState(startArchiveAction, {});
  return (
    <form action={act}>
      <input type="hidden" name="cohortId" value={cohortId} />
      <button type="submit" disabled={working || ready === 0} className={button}>
        {working
          ? t("archive.starting")
          : ready === 1
            ? t("archive.startOne")
            : t("archive.start", { count: ready })}
      </button>
      <Outcome state={state} />
    </form>
  );
}

/** Refreshes the page while an archive is being written, and stops once it is not. */
export function WhileBuilding() {
  const t = useT();
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [router]);
  return <p className="text-sm text-[var(--muted)]">{t("archive.building")}</p>;
}

/**
 * Fingerprints the file the provider saved, where it sits.
 *
 * Read in 8 MiB slices and never sent: only the fingerprint goes to the
 * server, so an archive of any size can be checked on any connection.
 */
export function CheckCopy({
  cohortId,
  archiveId,
  expectedBytes,
}: {
  cohortId: string;
  archiveId: string;
  expectedBytes: number;
}) {
  const t = useT();
  const dates = useDates();
  const [progress, setProgress] = useState<string | null>(null);
  const [state, setState] = useState<ArchiveActionState>({});
  const [pending, startTransition] = useTransition();

  async function check(file: File) {
    setState({});
    const fingerprint = new ChunkedFingerprint(sha256);
    for (let at = 0; at < file.size; at += CHUNK_BYTES) {
      const piece = new Uint8Array(await file.slice(at, at + CHUNK_BYTES).arrayBuffer());
      await fingerprint.update(piece);
      setProgress(t("archive.reading", { percent: percent(at + piece.length, file.size) }));
    }
    const result = await fingerprint.finish();
    setProgress(null);
    startTransition(async () => {
      setState(await confirmCopyAction(cohortId, archiveId, result));
    });
  }

  return (
    <div>
      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">{t("archive.checkLabel")}</span>
        <input
          type="file"
          accept=".zip,application/zip"
          disabled={pending || progress !== null}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void check(file);
            event.target.value = "";
          }}
          className="block text-sm"
        />
        <span className="block text-xs text-[var(--muted)]">
          {t("archive.checkNote", { bytes: expectedBytes.toLocaleString(dates) })}
        </span>
      </label>
      {progress ? <p className="mt-2 text-sm text-[var(--muted)]">{progress}</p> : null}
      <Outcome state={state} />
    </div>
  );
}

export function RemoveFiles({
  cohortId,
  archiveId,
  removing,
  keeping,
}: {
  cohortId: string;
  archiveId: string;
  removing: number;
  keeping: number;
}) {
  const t = useT();
  const [state, act, working] = useActionState(removeFilesAction, {});
  const [sure, setSure] = useState(false);
  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="cohortId" value={cohortId} />
      <input type="hidden" name="archiveId" value={archiveId} />
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={sure}
          onChange={(event) => setSure(event.target.checked)}
          className="mt-1"
        />
        <span>{t("archive.stored")}</span>
      </label>
      <button type="submit" disabled={working || !sure} className={button}>
        {working
          ? t("archive.removing")
          : removing === 1
            ? t("archive.removeOne")
            : t("archive.remove", { count: removing })}
      </button>
      {keeping > 0 ? (
        <p className="text-xs text-[var(--muted)]">
          {keeping === 1 ? t("archive.keepingOne") : t("archive.keeping", { count: keeping })}
        </p>
      ) : null}
      <Outcome state={state} />
    </form>
  );
}

export function Abandon({ cohortId, archiveId }: { cohortId: string; archiveId: string }) {
  const t = useT();
  const [state, act, working] = useActionState(abandonAction, {});
  return (
    <form action={act}>
      <input type="hidden" name="cohortId" value={cohortId} />
      <input type="hidden" name="archiveId" value={archiveId} />
      <button type="submit" disabled={working} className={`${button} text-[var(--muted)]`}>
        {working ? t("archive.settingAside") : t("archive.setAside")}
      </button>
      <Outcome state={state} />
    </form>
  );
}

/**
 * Gives the archive back, in pieces, and resumes where an interrupted upload
 * stopped. The server checks the whole file and every file in it before
 * anything is put back.
 */
export function Restore({
  cohortId,
  archiveId,
  expectedBytes,
}: {
  cohortId: string;
  archiveId: string;
  expectedBytes: number;
}) {
  const t = useT();
  const dates = useDates();
  const [progress, setProgress] = useState<string | null>(null);
  const [state, setState] = useState<ArchiveActionState>({});
  const [pending, startTransition] = useTransition();

  async function upload(file: File) {
    setState({});
    if (file.size !== expectedBytes) {
      setState({
        error: t("archive.wrongSize", {
          size: file.size.toLocaleString(dates),
          expected: expectedBytes.toLocaleString(dates),
        }),
      });
      return;
    }

    const address = `/api/archives/${archiveId}/restore`;
    const status = await fetch(address, { cache: "no-store" });
    const started = (await status.json()) as { received?: number; error?: string };
    if (!status.ok) {
      setState({ error: started.error ?? t("archive.couldNotStart") });
      return;
    }

    let at = started.received ?? 0;
    try {
      while (at < file.size) {
        const piece = file.slice(at, at + RESTORE_PIECE);
        const response = await fetch(`${address}?offset=${at}`, { method: "POST", body: piece });
        const body = (await response.json()) as { received?: number; error?: string };
        if (!response.ok || body.received === undefined) {
          throw new Error(body.error ?? t("archive.pieceRefused"));
        }
        at = body.received;
        setProgress(t("archive.uploading", { percent: percent(at, file.size) }));
      }
    } catch (error) {
      setProgress(null);
      setState({
        error: t("archive.carryOn", {
          problem: error instanceof Error ? error.message : t("archive.uploadStopped"),
        }),
      });
      return;
    }

    setProgress(t("archive.checkingFiles"));
    startTransition(async () => {
      setState(await finishRestoreAction(cohortId, archiveId));
      setProgress(null);
    });
  }

  return (
    <div>
      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">{t("archive.restore")}</span>
        <input
          type="file"
          accept=".zip,application/zip"
          disabled={pending || progress !== null}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = "";
          }}
          className="block text-sm"
        />
        <span className="block text-xs text-[var(--muted)]">{t("archive.restoreNote")}</span>
      </label>
      {progress ? <p className="mt-2 text-sm text-[var(--muted)]">{progress}</p> : null}
      <Outcome state={state} />
    </div>
  );
}
