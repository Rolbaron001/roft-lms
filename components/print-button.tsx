"use client";

/**
 * Printing or saving a document the platform issued.
 *
 * The browser's own print dialogue rather than a generated PDF, and that is a
 * deliberate choice rather than a shortcut. Every browser's print dialogue
 * offers "Save as PDF", so this produces a file; it costs no server rendering,
 * no font packaging and no second layout to keep in step with the first; and
 * what somebody saves is exactly what they were looking at, which is the whole
 * point of a document that has to match a copy an assessment centre holds.
 *
 * Hidden when printing, so it does not appear on the page it produces.
 */
export function PrintButton({
  label = "Print or save as PDF",
}: {
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm transition hover:bg-[var(--brand-accent)] print:hidden"
    >
      {label}
    </button>
  );
}
