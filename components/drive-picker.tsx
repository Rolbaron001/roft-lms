"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import {
  browseDriveAction,
  importFromDriveAction,
  type DriveImportState,
} from "@/app/imports/drive-actions";
import { AttentionMascot } from "./tenant-illustration";

/**
 * Choosing a folder from a drive somebody has connected.
 *
 * A drill-down rather than a search box, because a provider's material sits
 * somewhere they already know the way to, and typing a name reliably finds the
 * wrong "121151" in a drive that has three.
 *
 * It ends where an uploaded folder ends: at a proposal to check before
 * anything is written. The files arriving by a different road is no reason to
 * skip the check.
 */
export function DrivePicker({
  drives,
  qualificationId,
  courseId,
  learningPathId,
  topUp,
}: {
  drives: { provider: string; label: string; accountLabel: string | null }[];
  qualificationId?: string;
  courseId?: string;
  learningPathId?: string;
  topUp?: boolean;
}) {
  const [provider, setProvider] = useState(drives[0]?.provider ?? "");
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [browsing, startBrowse] = useTransition();

  const [state, setState] = useState<DriveImportState>({});
  const [reading, startRead] = useTransition();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!reading) return;
    const started = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.round((Date.now() - started) / 1000)),
      1000,
    );
    return () => {
      clearInterval(timer);
      setSeconds(0);
    };
  }, [reading]);

  function open(parent: { id: string; name: string } | null) {
    const next = parent ? [...trail, parent] : [];

    startBrowse(async () => {
      const body = new FormData();
      body.append("provider", provider);
      if (parent) body.append("parentId", parent.id);
      body.append("trail", JSON.stringify(next));

      const result = await browseDriveAction({}, body);
      setError(result.error ?? null);
      setFolders(result.folders ?? []);
      setTrail(next);
    });
  }

  function upTo(index: number) {
    const next = trail.slice(0, index);
    const parent = next[next.length - 1] ?? null;

    startBrowse(async () => {
      const body = new FormData();
      body.append("provider", provider);
      if (parent) body.append("parentId", parent.id);
      const result = await browseDriveAction({}, body);
      setError(result.error ?? null);
      setFolders(result.folders ?? []);
      setTrail(next);
    });
  }

  function read() {
    const here = trail[trail.length - 1];
    if (!here) return;

    startRead(async () => {
      const body = new FormData();
      body.append("provider", provider);
      body.append("folderId", here.id);
      body.append("folderName", here.name);
      if (qualificationId) body.append("qualificationId", qualificationId);
      if (courseId) body.append("courseId", courseId);
      if (learningPathId) body.append("learningPathId", learningPathId);
      if (topUp) body.append("topUp", "yes");

      setState(await importFromDriveAction({}, body));
    });
  }

  if (drives.length === 0) return null;

  const here = trail[trail.length - 1];

  return (
    <div className="space-y-3">
      {drives.length > 1 ? (
        <label className="block text-sm">
          <span className="text-[var(--muted)]">Which drive</span>
          <select
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value);
              setTrail([]);
              setFolders([]);
            }}
            className="mt-1 block w-full max-w-md rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            {drives.map((one) => (
              <option key={one.provider} value={one.provider}>
                {one.label}
                {one.accountLabel ? ` — ${one.accountLabel}` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {/* Where you are, and the way back up. */}
      <p className="flex flex-wrap items-center gap-1 text-xs text-[var(--muted)]">
        <button
          type="button"
          onClick={() => upTo(0)}
          className="underline-offset-2 hover:underline"
        >
          {drives.find((one) => one.provider === provider)?.label ?? "Drive"}
        </button>
        {trail.map((one, index) => (
          <span key={one.id} className="flex items-center gap-1">
            <span aria-hidden>/</span>
            <button
              type="button"
              onClick={() => upTo(index + 1)}
              className="underline-offset-2 hover:underline"
            >
              {one.name}
            </button>
          </span>
        ))}
      </p>

      {folders.length === 0 && trail.length === 0 && !browsing ? (
        <button
          type="button"
          onClick={() => open(null)}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium"
        >
          Browse this drive
        </button>
      ) : null}

      {browsing ? (
        <p className="text-sm text-[var(--muted)]">Looking…</p>
      ) : folders.length > 0 ? (
        <ul className="max-h-60 space-y-1 overflow-y-auto rounded-md border border-[var(--border)] p-2 text-sm">
          {folders.map((one) => (
            <li key={one.id}>
              <button
                type="button"
                onClick={() => open(one)}
                className="w-full rounded px-2 py-1 text-left hover:bg-[var(--border)]/30"
              >
                {one.name}
              </button>
            </li>
          ))}
        </ul>
      ) : trail.length > 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No folders inside this one. If the material is here, read it.
        </p>
      ) : null}

      {here ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={read}
            disabled={reading}
            className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {reading ? "Reading…" : `Read “${here.name}”`}
          </button>

          {/*
            The same prompt the uploaded-folder route gives, and it was missing
            here. Somebody who has walked into a folder on their drive is at
            exactly the point Heidi was at: the next step has appeared and
            nothing says so.
          */}
          {!reading ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--brand-accent)]">
              <AttentionMascot className="mr-1" />
              <span aria-hidden className="motion-safe:animate-bounce">
                ←
              </span>
              Now press this to read it. Nothing is saved yet.
            </p>
          ) : null}

          {reading ? (
            <p
              role="status"
              className="flex items-center gap-2 text-sm text-[var(--muted)]"
            >
              <span
                aria-hidden
                className="inline-block h-4 w-4 rounded-full border-2 border-[var(--border)] border-t-[var(--brand-accent)] motion-safe:animate-spin"
              />
              {seconds < 20
                ? "Fetching the files…"
                : `Still fetching — ${seconds} seconds. Every file is downloaded before anything is read, so a large folder takes a few minutes.`}
            </p>
          ) : (
            <p className="text-xs text-[var(--muted)]">
              Nothing is written yet — you check what it found first.
            </p>
          )}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--muted)]">
          {state.notice}{" "}
          {state.jobId ? (
            <Link href={`/imports/${state.jobId}`} className="underline">
              Review it
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
