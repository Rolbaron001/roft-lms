"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/i18n";

/**
 * The theory guide, read inside the study unit's page (Roland's design of 5
 * October 2026): a page at a time for a PDF, a chapter at a time for a Word
 * document, with a download beside it either way.
 *
 * The page is drawn here rather than embedded, because the platform refuses
 * to be shown in a frame anywhere, its own pages included.
 */
export function PdfViewer({ src, downloadHref }: { src: string; downloadHref: string }) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const frame = useRef<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<{ numPages: number; getPage: (n: number) => Promise<unknown> } | null>(null);
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        const loaded = await pdfjs.getDocument({ url: src, withCredentials: true }).promise;
        if (!cancelled) setDoc(loaded as unknown as typeof doc);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);

  const draw = useCallback(async () => {
    if (!doc || !canvas.current || !frame.current) return;
    const pdfPage = (await doc.getPage(page)) as {
      getViewport: (o: { scale: number }) => { width: number; height: number };
      render: (o: { canvas: HTMLCanvasElement; viewport: unknown }) => { promise: Promise<void> };
    };
    const natural = pdfPage.getViewport({ scale: 1 });
    const width = Math.min(frame.current.clientWidth - 32, 820);
    const ratio = window.devicePixelRatio || 1;
    const viewport = pdfPage.getViewport({ scale: (width / natural.width) * ratio });
    const element = canvas.current;
    element.width = viewport.width;
    element.height = viewport.height;
    element.style.width = `${viewport.width / ratio}px`;
    element.style.height = `${viewport.height / ratio}px`;
    await pdfPage.render({ canvas: element, viewport }).promise;
  }, [doc, page]);

  useEffect(() => {
    void draw();
  }, [draw]);

  useEffect(() => {
    const redraw = () => void draw();
    window.addEventListener("resize", redraw);
    return () => window.removeEventListener("resize", redraw);
  }, [draw]);

  if (failed) {
    return (
      <p className="p-6 text-sm text-[var(--muted)]">
        {t("viewer.failed")}{" "}
        <a href={downloadHref} className="underline underline-offset-2">
          {t("viewer.download")}
        </a>
      </p>
    );
  }

  return (
    <div>
      <ViewerBar
        label={doc ? t("viewer.pageOf", { page, total: doc.numPages }) : t("viewer.loading")}
        onPrevious={page > 1 ? () => setPage(page - 1) : null}
        onNext={doc && page < doc.numPages ? () => setPage(page + 1) : null}
        onFullScreen={() => frame.current?.requestFullscreen?.()}
        downloadHref={downloadHref}
      />
      <div ref={frame} className="flex justify-center overflow-auto bg-[var(--background)] p-4" style={{ minHeight: 420 }}>
        <canvas ref={canvas} className="bg-white shadow" aria-label={t("viewer.pageLabel", { page })} />
      </div>
    </div>
  );
}

/** A Word guide, as chapters from its own headings. */
export function ChapterViewer({ chapters, downloadHref }: { chapters: { title: string; html: string }[]; downloadHref: string }) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const frame = useRef<HTMLDivElement | null>(null);
  const chapter = chapters[index];
  if (!chapter) return null;
  return (
    <div>
      <ViewerBar
        label={t("viewer.chapterOf", { chapter: index + 1, total: chapters.length })}
        onPrevious={index > 0 ? () => setIndex(index - 1) : null}
        onNext={index < chapters.length - 1 ? () => setIndex(index + 1) : null}
        onFullScreen={() => frame.current?.requestFullscreen?.()}
        downloadHref={downloadHref}
        chapters={chapters.map((one) => one.title)}
        chapterIndex={index}
        onChapter={setIndex}
      />
      <div ref={frame} className="overflow-auto bg-[var(--background)] p-4" style={{ maxHeight: 720 }}>
        <article
          className="mx-auto max-w-3xl space-y-3 bg-white p-8 text-[15px] leading-relaxed shadow [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_img]:max-w-full [&_li]:ml-5 [&_li]:list-disc [&_table]:w-full [&_td]:border [&_td]:border-[var(--border)] [&_td]:p-1.5"
          // Produced on the server from the provider's own Word file, with
          // every link that is not plain web or mail removed.
          dangerouslySetInnerHTML={{ __html: chapter.html }}
        />
      </div>
    </div>
  );
}

function ViewerBar({
  label,
  onPrevious,
  onNext,
  onFullScreen,
  downloadHref,
  chapters,
  chapterIndex,
  onChapter,
}: {
  label: string;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  onFullScreen: () => void;
  downloadHref: string;
  chapters?: string[];
  chapterIndex?: number;
  onChapter?: (index: number) => void;
}) {
  const t = useT();
  const button = "inline-flex h-10 min-w-10 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {chapters && onChapter ? (
          <label className="flex items-center gap-2">
            <span className="text-[var(--muted)]">{t("viewer.goTo")}</span>
            <select
              value={chapterIndex}
              onChange={(event) => onChapter(Number(event.target.value))}
              className="h-10 max-w-[18rem] rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
            >
              {chapters.map((title, index) => (
                <option key={index} value={index}>
                  {title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="button" className={button} onClick={onPrevious ?? undefined} disabled={!onPrevious} aria-label={t("viewer.previous")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <span className="min-w-24 text-center tabular-nums">{label}</span>
        <button type="button" className={button} onClick={onNext ?? undefined} disabled={!onNext} aria-label={t("viewer.next")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
        <button type="button" className={button} onClick={onFullScreen} aria-label={t("viewer.fullScreen")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      </div>
      <a href={downloadHref} className="inline-flex h-10 items-center gap-2 rounded-md bg-[var(--brand-primary)] px-4 text-sm font-medium text-white">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        </svg>
        {t("viewer.download")}
      </a>
    </div>
  );
}
