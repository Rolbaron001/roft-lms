"use client";

import { useT } from "@/components/i18n";
import { Rich } from "@/components/rich-text";

type Translate = ReturnType<typeof useT>;

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

function describeSize(bytes: number | null, t: Translate): string {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) return t("media.mb", { count: Math.round(bytes / (1024 * 1024)) });
  return t("media.kb", { count: Math.max(1, Math.round(bytes / 1024)) });
}

export function LessonMediaView({ media }: { media: LessonMedia }) {
  const t = useT();
  const src = `/api/lessons/${media.lessonId}/media`;
  const mime = media.mimeType ?? "";
  const instead = <a href={`${src}?download`}>{t("media.downloadInstead")}</a>;

  if (mime.startsWith("video/")) {
    return (
      <video
        controls
        preload="metadata"
        className="w-full rounded-md border border-[var(--border)] bg-black"
        style={{ maxHeight: "70vh" }}
      >
        <source src={src} type={mime} />
        <Rich text={t("media.noVideo")} parts={{ link: instead }} />
      </video>
    );
  }

  if (mime.startsWith("audio/")) {
    return (
      <audio controls preload="metadata" className="w-full">
        <source src={src} type={mime} />
        <Rich text={t("media.noAudio")} parts={{ link: instead }} />
      </audio>
    );
  }

  if (mime.startsWith("image/")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={media.filename ?? t("media.image")}
        className="max-w-full rounded-md border border-[var(--border)]"
      />
    );
  }

  if (mime === "application/pdf") {
    return (
      <div className="space-y-2">
        <iframe
          src={src}
          title={media.filename ?? t("media.document")}
          className="w-full rounded-md border border-[var(--border)]"
          style={{ height: "70vh" }}
        />
        <p className="text-xs text-[var(--muted)]">
          <Rich
            text={t("media.pdfFallback", { size: describeSize(media.sizeBytes, t) })}
            parts={{
              link: (
                <a
                  href={`${src}?download`}
                  className="font-medium text-[var(--brand-accent)] hover:underline"
                >
                  {t("media.download", { file: media.filename ?? "" })}
                </a>
              ),
            }}
          />
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
          {t("media.downloads", { size: describeSize(media.sizeBytes, t) })}
        </span>
      </span>
    </a>
  );
}
