import Link from "next/link";
import { AttentionMascot } from "./tenant-illustration";

/**
 * Where you are in a sequence, and what to press next.
 *
 * Roland, 19 September, twice - the second time because the first answer
 * missed the point: "The screen doesn't show where you are in the process,
 * neither does it guide you through the steps. Please add a progress map, add
 * a finger or a mascot to point where to go and what to do next."
 *
 * What he had been given was prose. "Upload your alignment document ... under
 * the documents below. You can also build them by hand here." Three pointers -
 * below, under, here - and not one of them a link. On a page running to
 * fifteen modules and five hundred curriculum lines, "below" is not a
 * direction, and one of the three pointed at a screen that does not exist.
 *
 * So: a map that shows the whole sequence at once with the current position
 * marked, and a pointer that sits beside the actual control rather than
 * describing where it might be. The two halves matter separately - the map
 * answers "how far have I got", the pointer answers "what do I press".
 */

export type Step = {
  title: string;
  /** Finished, from the data rather than from a flag. */
  done: boolean;
  /** What is true now, in figures where there are any. */
  state: string;
  /** Where the control for this step lives on the page. */
  href: string;
  /** What pressing it does, as an instruction. */
  action: string;
};

/**
 * The map. Every step visible at once, with the current one marked.
 *
 * A list of what is outstanding is not a map: it hides what is behind you, so
 * it cannot answer "how far have I got" - which is the question somebody has
 * after pressing Create and landing on a full screen.
 */
export function ProgressMap({ steps }: { steps: Step[] }) {
  const next = steps.find((step) => !step.done) ?? null;
  const done = steps.filter((step) => step.done).length;

  return (
    <nav
      aria-label="Progress through this qualification"
      className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <p className="text-sm font-semibold">
        {done} of {steps.length} done
      </p>

      <ol className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-stretch">
        {steps.map((step, index) => {
          const current = step === next;

          return (
            <li key={step.title} className="flex flex-1 items-center gap-2">
              <div
                aria-current={current ? "step" : undefined}
                className={`flex-1 rounded-md border px-3 py-2 ${
                  current
                    ? "border-[var(--brand-accent)] bg-[var(--brand-accent)]/10"
                    : step.done
                      ? "border-[var(--success)]/40 bg-[var(--success)]/5"
                      : "border-[var(--border)]"
                }`}
              >
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <span
                    aria-hidden
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                      step.done
                        ? "bg-[var(--success)]/20 text-[var(--success)]"
                        : current
                          ? "bg-[var(--brand-accent)] text-white"
                          : "border border-[var(--border)] text-[var(--muted)]"
                    }`}
                  >
                    {step.done ? "✓" : index + 1}
                  </span>
                  {step.title}
                </p>
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {step.done ? step.state : current ? "You are here" : "After that"}
                </p>
              </div>

              {/* The way the eye travels, on a wide screen only: stacked on a
                  phone the arrows would point sideways at nothing. */}
              {index < steps.length - 1 ? (
                <span aria-hidden className="hidden text-[var(--muted)] sm:block">
                  →
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {next ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-3">
          <AttentionMascot height={56} />
          <p className="text-sm">
            <span className="font-medium">Next: {next.title.toLowerCase()}.</span>{" "}
            <span className="text-[var(--muted)]">{next.state}</span>
          </p>
          {/*
            A button rather than a sentence with an underline in it. This is
            the one thing to press, and it goes to the control itself - not to
            a heading above a section that then has to be searched.
          */}
          <Link
            href={next.href}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
            style={{ background: "var(--brand-primary)" }}
          >
            {next.action} →
          </Link>
        </div>
      ) : null}
    </nav>
  );
}

/**
 * The pointer, placed beside the control it refers to.
 *
 * The map says what is next; this says "it is this one". Rendered only for
 * the step that is current, so at most one of these is on the page and it is
 * never pointing at something already done.
 *
 * The mascot is the tenant's own picture where they have set one, and nothing
 * at all where they have not - the words and the arrow carry the meaning
 * either way. See components/tenant-illustration.tsx.
 */
export function PointHere({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-2 rounded-md border-2 px-3 py-2"
      style={{ borderColor: "var(--brand-accent)" }}
    >
      {/* Near the graphic's own height. At forty it was seventeen pixels
          wide - present, and not something anybody's eye would catch, which
          is the entire job. */}
      <AttentionMascot height={64} />
      <span aria-hidden className="motion-safe:animate-bounce text-xl">
        ↓
      </span>
      <p className="text-sm font-medium text-[var(--brand-accent)]">
        {children}
      </p>
    </div>
  );
}
