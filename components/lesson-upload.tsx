"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/**
 * Attaching a file to a lesson.
 *
 * Uploads through a route handler rather than a server action, because a
 * server action would buffer the whole file as part of the form payload and a
 * recorded practical assessment can be hundreds of megabytes. This also gives
 * a real progress figure, which matters when somebody is watching a 400 MB
 * video crawl upwards on a South African connection.
 */
export function LessonUpload({
  lessonId,
  existing,
  disabled,
}: {
  lessonId: string;
  existing: { filename: string | null; mimeType: string | null } | null;
  disabled?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function upload(file: File) {
    setError(null);
    setNotice(null);
    setProgress(0);

    const body = new FormData();
    body.append("file", file);

    // XMLHttpRequest rather than fetch: it is still the only way to observe
    // upload progress, and on a slow connection a silent bar is the difference
    // between waiting and giving up.
    const request = new XMLHttpRequest();
    request.open("POST", `/api/lessons/${lessonId}/media`);

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        setProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    request.addEventListener("load", () => {
      setProgress(null);
      let payload: { error?: string; label?: string; filename?: string } = {};
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        payload = {};
      }

      if (request.status >= 200 && request.status < 300) {
        setNotice(`${payload.label ?? "File"} attached: ${payload.filename}`);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      } else {
        setError(payload.error ?? "That file could not be uploaded.");
      }
    });

    request.addEventListener("error", () => {
      setProgress(null);
      setError("The upload failed. Check your connection and try again.");
    });

    request.send(body);
  }

  if (disabled) {
    return existing?.filename ? (
      <p className="text-xs text-[var(--muted)]">
        Attached: {existing.filename}
      </p>
    ) : null;
  }

  return (
    <div className="space-y-2">
      {existing?.filename ? (
        <p className="text-xs text-[var(--muted)]">
          Attached: <span className="font-medium">{existing.filename}</span>.
          Uploading another replaces it.
        </p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        aria-label="Choose a file for this lesson"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload(file);
        }}
        className="block w-full text-xs file:mr-3 file:rounded-md file:border file:border-[var(--border)] file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium"
      />

      {progress !== null ? (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progress}%`,
                background: "var(--brand-accent)",
              }}
            />
          </div>
          <p className="text-xs text-[var(--muted)]">
            Uploading… {progress}%
          </p>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-xs text-[var(--danger)]"
        >
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="text-xs font-medium text-[var(--success)]">{notice}</p>
      ) : null}

      <p className="text-xs text-[var(--muted)]">
        Video, images, audio, PDF, Word, PowerPoint or Excel. The file is
        checked by its contents, not its name.
      </p>
    </div>
  );
}
