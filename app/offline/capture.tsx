"use client";

import { useEffect, useState } from "react";
import {
  compressImage,
  drain,
  enqueue,
  queueSize,
  queued,
  type QueuedItem,
} from "@/lib/device-queue";

const field =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

function readable(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Recording work with no signal, and sending it when there is one.
 *
 * The learner's half of the offline feature. Everything here happens on the
 * phone: the note and the photograph go into the browser's own database and
 * stay there until something can reach the server.
 *
 * Two things are deliberately visible that a slicker version would hide.
 *
 * **What is waiting, and how much room it takes.** Roland's note of
 * 10 September: a learner who cannot see what is held stops trusting the app
 * with their fortnight's work.
 *
 * **That the photograph was shrunk, and by how much.** A learner who has just
 * taken a careful picture of a fence line deserves to know the app kept a
 * smaller copy, rather than discovering it when an assessor cannot read it.
 */
export function Capture({
  targetType,
  targetId,
  qualificationId,
  kind = "workplace_evidence",
}: {
  targetType: string;
  targetId: string;
  qualificationId?: string;
  kind?: string;
}) {
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [shrunk, setShrunk] = useState<{ from: number; to: number } | null>(
    null,
  );
  const [waiting, setWaiting] = useState<QueuedItem[]>([]);
  const [size, setSize] = useState({ count: 0, bytes: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setWaiting(await queued());
    setSize(await queueSize());
  }

  useEffect(() => {
    let live = true;

    /**
     * Reading the queue is reading an external system, so the state lands in
     * IndexedDB's own callback rather than synchronously in the effect body -
     * which is what React now warns about, and would mean a second render
     * before the first had painted.
     */
    async function read() {
      try {
        const [items, measured] = await Promise.all([queued(), queueSize()]);
        if (!live) return;
        setWaiting(items);
        setSize(measured);
      } catch {
        // A browser with no IndexedDB shows an empty queue rather than an
        // error a learner can do nothing about.
      }
    }

    read();
    return () => {
      live = false;
    };
  }, []);

  /**
   * Sends whatever is waiting the moment a signal returns.
   *
   * The learner should not have to remember to come back to this screen. They
   * put the phone in their pocket in a valley and it goes out on the way home.
   */
  useEffect(() => {
    const send = () => {
      drain()
        .then((result) => {
          if (result.sent > 0 || result.dropped.length > 0) {
            setMessage(
              [
                result.sent > 0 ? `${result.sent} sent.` : "",
                result.dropped.length > 0
                  ? `${result.dropped.length} could not be accepted: ${result.dropped[0].why}`
                  : "",
              ]
                .filter(Boolean)
                .join(" "),
            );
          }
          return refresh();
        })
        .catch(() => {});
    };

    window.addEventListener("online", send);
    if (navigator.onLine) send();

    return () => window.removeEventListener("online", send);
  }, []);

  async function choose(chosen: File | null) {
    setShrunk(null);
    if (!chosen) {
      setFile(null);
      return;
    }

    // Shrunk here rather than on the way out, so a fortnight of full-size
    // originals never sits on the phone in the first place.
    const smaller = await compressImage(chosen);
    if (smaller.size < chosen.size) {
      setShrunk({ from: chosen.size, to: smaller.size });
    }
    setFile(
      new File([smaller], chosen.name, {
        type: smaller.type || chosen.type,
      }),
    );
  }

  async function record() {
    if (!note.trim() && !file) {
      setMessage("Write a note or add a photograph first.");
      return;
    }

    setBusy(true);
    try {
      await enqueue({
        kind,
        targetType,
        targetId,
        qualificationId,
        payload: { note: note.trim() },
        file: file ?? undefined,
        fileName: file?.name,
      });

      setNote("");
      setFile(null);
      setShrunk(null);
      await refresh();

      setMessage(
        navigator.onLine
          ? "Recorded. Sending it now."
          : "Recorded on this phone. It will go when you have a signal.",
      );

      if (navigator.onLine) {
        await drain();
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">What you did</span>
        <textarea
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className={field}
          placeholder="Inspected the fence line along the eastern boundary."
        />
      </label>

      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">A photograph</span>
        <input
          type="file"
          accept="image/*"
          // Opens the camera directly on a phone rather than the file picker.
          capture="environment"
          onChange={(event) => choose(event.target.files?.[0] ?? null)}
          className={field}
        />
        {shrunk ? (
          <span className="block text-xs text-[var(--muted)]">
            Made smaller to save room: {readable(shrunk.from)} →{" "}
            {readable(shrunk.to)}. Still clear enough to assess.
          </span>
        ) : null}
      </label>

      <button
        type="button"
        onClick={record}
        disabled={busy}
        className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--brand-primary)" }}
      >
        {busy ? "Recording…" : "Record it"}
      </button>

      {message ? (
        <p className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
          {message}
        </p>
      ) : null}

      <div className="border-t border-[var(--border)] pt-3">
        <p className="text-sm font-medium">
          Waiting to send
          <span className="ml-2 font-normal text-[var(--muted)]">
            {size.count === 0
              ? "nothing"
              : `${size.count} ${size.count === 1 ? "item" : "items"} · ${readable(size.bytes)}`}
          </span>
        </p>

        {waiting.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {waiting.map((item) => (
              <li key={item.deviceKey} className="text-sm">
                {String(item.payload.note ?? "").slice(0, 60) ||
                  item.fileName ||
                  "Recorded work"}
                <span className="block text-xs text-[var(--muted)]">
                  Recorded {new Date(item.capturedAt).toLocaleString("en-ZA")}
                  {item.attempts > 0
                    ? ` · tried ${item.attempts} ${item.attempts === 1 ? "time" : "times"}`
                    : ""}
                  {item.lastError ? ` · ${item.lastError}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
