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
  const [state, act, working] = useActionState(startArchiveAction, {});
  return (
    <form action={act}>
      <input type="hidden" name="cohortId" value={cohortId} />
      <button type="submit" disabled={working || ready === 0} className={button}>
        {working
          ? "Starting…"
          : `Archive ${ready} ${ready === 1 ? "learner" : "learners"}`}
      </button>
      <Outcome state={state} />
    </form>
  );
}

/** Refreshes the page while an archive is being written, and stops once it is not. */
export function WhileBuilding() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [router]);
  return (
    <p className="text-sm text-[var(--muted)]">
      Being written. This page updates by itself.
    </p>
  );
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
  const [progress, setProgress] = useState<string | null>(null);
  const [state, setState] = useState<ArchiveActionState>({});
  const [pending, startTransition] = useTransition();

  async function check(file: File) {
    setState({});
    const fingerprint = new ChunkedFingerprint(sha256);
    for (let at = 0; at < file.size; at += CHUNK_BYTES) {
      const piece = new Uint8Array(await file.slice(at, at + CHUNK_BYTES).arrayBuffer());
      await fingerprint.update(piece);
      setProgress(`Reading your copy: ${percent(at + piece.length, file.size)}`);
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
        <span className="block text-sm font-medium">Check your saved copy</span>
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
          Choose the archive from where you stored it. It is read on this computer and not uploaded; only its fingerprint is sent. The archive is {expectedBytes.toLocaleString("en-ZA")} bytes.
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
        <span>
          The copy I checked is stored where our records policy says it should be kept.
        </span>
      </label>
      <button type="submit" disabled={working || !sure} className={button}>
        {working ? "Removing…" : `Remove ${removing} ${removing === 1 ? "file" : "files"} from the platform`}
      </button>
      {keeping > 0 ? (
        <p className="text-xs text-[var(--muted)]">
          {keeping} enrolment {keeping === 1 ? "document stays" : "documents stay"} on the platform as well, because another programme of the learner&rsquo;s still needs {keeping === 1 ? "it" : "them"}.
        </p>
      ) : null}
      <Outcome state={state} />
    </form>
  );
}

export function Abandon({ cohortId, archiveId }: { cohortId: string; archiveId: string }) {
  const [state, act, working] = useActionState(abandonAction, {});
  return (
    <form action={act}>
      <input type="hidden" name="cohortId" value={cohortId} />
      <input type="hidden" name="archiveId" value={archiveId} />
      <button type="submit" disabled={working} className={`${button} text-[var(--muted)]`}>
        {working ? "Setting aside…" : "Set this archive aside"}
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
  const [progress, setProgress] = useState<string | null>(null);
  const [state, setState] = useState<ArchiveActionState>({});
  const [pending, startTransition] = useTransition();

  async function upload(file: File) {
    setState({});
    if (file.size !== expectedBytes) {
      setState({
        error: `That file is ${file.size.toLocaleString("en-ZA")} bytes and the archive is ${expectedBytes.toLocaleString("en-ZA")}. It is not this archive.`,
      });
      return;
    }

    const address = `/api/archives/${archiveId}/restore`;
    const status = await fetch(address, { cache: "no-store" });
    const started = (await status.json()) as { received?: number; error?: string };
    if (!status.ok) {
      setState({ error: started.error ?? "The restore could not start." });
      return;
    }

    let at = started.received ?? 0;
    try {
      while (at < file.size) {
        const piece = file.slice(at, at + RESTORE_PIECE);
        const response = await fetch(`${address}?offset=${at}`, { method: "POST", body: piece });
        const body = (await response.json()) as { received?: number; error?: string };
        if (!response.ok || body.received === undefined) {
          throw new Error(body.error ?? "A piece of the upload was refused.");
        }
        at = body.received;
        setProgress(`Uploading: ${percent(at, file.size)}`);
      }
    } catch (error) {
      setProgress(null);
      setState({
        error: `${error instanceof Error ? error.message : "The upload stopped."} Choose the file again to carry on from where it stopped.`,
      });
      return;
    }

    setProgress("Checking every file…");
    startTransition(async () => {
      setState(await finishRestoreAction(cohortId, archiveId));
      setProgress(null);
    });
  }

  return (
    <div>
      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">Restore from the archive</span>
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
        <span className="block text-xs text-[var(--muted)]">
          Only needed if these files have to be on the platform again. The archive is uploaded, checked against the fingerprint taken when it was made, and each file is put back where it was.
        </span>
      </label>
      {progress ? <p className="mt-2 text-sm text-[var(--muted)]">{progress}</p> : null}
      <Outcome state={state} />
    </div>
  );
}
