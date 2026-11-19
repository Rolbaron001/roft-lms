"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/i18n";

/**
 * A document read as its pages (Roland, 19 November 2026): "I just want a
 * document reader, in a A4 size pane (with portrait and landscape orientation
 * functionality depending on the document). A learner, or any other user,
 * must be able to read a document comfortably from the app."
 *
 * It replaced a reader that cut a Word file into "sections" at its headings
 * and poured each into a web page, which broke tables apart and lost the
 * document's own layout. Now a Word file is drawn as its pages, at the page
 * size and orientation the document itself sets (A4 portrait or landscape,
 * page by page), and a PDF the same way. The pages scroll in one pane, shrink
 * to fit a narrow screen, and can be enlarged.
 */

const PX_PER_POINT = 96 / 72;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

type Kind = "pdf" | "word";

export function PageReader({ src, downloadHref, kind }: { src: string; downloadHref: string; kind: Kind }) {
  const t = useT();
  const frame = useRef<HTMLDivElement | null>(null);
  const pages = useRef<HTMLDivElement | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  /** Null is "fit the width of the pane". */
  const [zoom, setZoom] = useState<number | null>(null);
  const [fit, setFit] = useState(1);
  const [widest, setWidest] = useState(0);

  // Draw the pages once.
  useEffect(() => {
    let cancelled = false;
    const target = pages.current;
    if (!target) return;
    (async () => {
      try {
        const response = await fetch(src, { credentials: "include" });
        if (!response.ok) throw new Error(String(response.status));
        const bytes = await response.arrayBuffer();
        if (cancelled) return;
        target.replaceChildren();
        if (kind === "word") {
          const { renderAsync } = await import("docx-preview");
          await renderAsync(bytes, target, undefined, {
            className: "docx",
            inWrapper: false,
            breakPages: true,
            ignoreWidth: false,
            ignoreHeight: false,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            useBase64URL: true,
          });
          const sections = Array.from(target.querySelectorAll<HTMLElement>("section.docx"));
          for (const section of sections) {
            section.style.margin = "0 auto 16px";
            section.style.boxShadow = "0 1px 4px rgba(0,0,0,.18)";
            section.style.background = "white";
          }
          if (!cancelled) {
            setWidest(Math.max(0, ...sections.map((one) => one.offsetWidth)));
            setCount(sections.length);
          }
        } else {
          const pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
          const document = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
          let widestPage = 0;
          const ratio = Math.min(window.devicePixelRatio || 1, 2) * 2;
          for (let number = 1; number <= document.numPages; number++) {
            if (cancelled) return;
            const page = await document.getPage(number);
            // True size: an A4 page is 794 by 1123 pixels, turned for landscape.
            const natural = page.getViewport({ scale: PX_PER_POINT });
            const viewport = page.getViewport({ scale: PX_PER_POINT * ratio });
            const canvas = window.document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.width = `${natural.width}px`;
            canvas.style.height = `${natural.height}px`;
            canvas.style.display = "block";
            canvas.style.margin = "0 auto 16px";
            canvas.style.background = "white";
            canvas.style.boxShadow = "0 1px 4px rgba(0,0,0,.18)";
            canvas.setAttribute("aria-label", t("viewer.pageLabel", { page: number }));
            target.appendChild(canvas);
            await page.render({ canvas, viewport }).promise;
            widestPage = Math.max(widestPage, natural.width);
            if (number === 1) setWidest(widestPage);
          }
          if (!cancelled) {
            setWidest(widestPage);
            setCount(document.numPages);
          }
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, kind, t]);

  // Fit the widest page to the pane, never enlarging past its true size.
  useEffect(() => {
    const element = frame.current;
    if (!element || widest === 0) return;
    const measure = () => setFit(Math.min(1, (element.clientWidth - 32) / widest));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [widest]);

  const scale = zoom ?? fit;
  const step = (direction: 1 | -1) => {
    const now = zoom ?? fit;
    const next = direction === 1 ? ZOOMS.find((one) => one > now + 0.01) : [...ZOOMS].reverse().find((one) => one < now - 0.01);
    if (next) setZoom(next);
  };

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

  const button = "inline-flex h-10 min-w-10 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm disabled:opacity-40";
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-20 tabular-nums text-[var(--muted)]">
            {count === null ? t("viewer.loading") : count === 1 ? t("viewer.onePage") : t("viewer.pages", { count })}
          </span>
          <button type="button" className={button} onClick={() => step(-1)} aria-label={t("viewer.smaller")}>
            −
          </button>
          <button type="button" className={`${button} min-w-16 tabular-nums`} onClick={() => setZoom(null)} title={t("viewer.fit")}>
            {Math.round(scale * 100)}%
          </button>
          <button type="button" className={button} onClick={() => step(1)} aria-label={t("viewer.larger")}>
            +
          </button>
          <button type="button" className={button} onClick={() => frame.current?.requestFullscreen?.()} aria-label={t("viewer.fullScreen")}>
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
      <div ref={frame} className="overflow-auto bg-[var(--background)] p-4" style={{ height: "min(85vh, 1180px)" }}>
        {/* zoom rather than transform, so the scroll area follows the pages' size. */}
        {/* The app's own rule caps images at their container's width; a Word
            drawing sits in a box of no width, so a cover picture vanished. */}
        <div ref={pages} style={{ zoom: scale }} className="[&_img]:max-w-none" />
      </div>
    </div>
  );
}
