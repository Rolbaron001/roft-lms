"use client";

/**
 * Presenting a lesson's file according to what it actually is.
 *
 * Video and audio get real players so a learner can pause and resume. Images
 * are shown inline. PDFs are framed, because a slide deck exported to PDF is
 * the commonest teaching artefact there is and making people download it
 * breaks the flow of a lesson. Office formats download, because no browser
 * renders them and pretending otherwise produces a blank rectangle.
 */

export type LessonMedia = {
  lessonId: string;
  mimeType: string | null;
  filename: string | null;
  sizeBytes: number | null;
};

function describeSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function LessonMediaView({ media }: { media: LessonMedia }) {
  const src = `/api/lessons/${media.lessonId}/media`;
  const mime = media.mimeType ?? "";

  if (mime.startsWith("video/")) {
    return (
      <video
        controls
        preload="metadata"
        className="w-full rounded-md border border-[var(--border)] bg-black"
        style={{ maxHeight: "70vh" }}
      >
        <source src={src} type={mime} />
        Your browser cannot play this video.{" "}
        <a href={`${src}?download`}>Download it instead</a>.
      </video>
    );
  }

  if (mime.startsWith("audio/")) {
    return (
      <audio controls preload="metadata" className="w-full">
        <source src={src} type={mime} />
        Your browser cannot play this recording.{" "}
        <a href={`${src}?download`}>Download it instead</a>.
      </audio>
    );
  }

  if (mime.startsWith("image/")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={media.filename ?? "Lesson image"}
        className="max-w-full rounded-md border border-[var(--border)]"
      />
    );
  }

  if (mime === "application/pdf") {
    return (
      <div className="space-y-2">
        <iframe
          src={src}
          title={media.filename ?? "Lesson document"}
          className="w-full rounded-md border border-[var(--border)]"
          style={{ height: "70vh" }}
        />
        <p className="text-xs text-[var(--muted)]">
          <a
            href={`${src}?download`}
            className="font-medium text-[var(--brand-accent)] hover:underline"
          >
            Download {media.filename}
          </a>{" "}
          ({describeSize(media.sizeBytes)}) if it does not display here.
        </p>
      </div>
    );
  }

  // Everything else: a plain, honest download.
  return (
    <a
      href={`${src}?download`}
      className="flex items-center gap-3 rounded-md border border-[var(--border)] px-4 py-3 transition hover:border-[var(--brand-accent)]"
    >
      <span
        aria-hidden
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-white"
        style={{ background: "var(--brand-primary)" }}
      >
        {(media.filename?.split(".").pop() ?? "file").slice(0, 4).toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">
          {media.filename}
        </span>
        <span className="block text-xs text-[var(--muted)]">
          {describeSize(media.sizeBytes)} · downloads to open
        </span>
      </span>
    </a>
  );
}
