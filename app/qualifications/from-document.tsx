"use client";

import Link from "next/link";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  createFromDocumentAction,
  readCurriculumAction,
  type CreateFromDocumentState,
  type ReadingState,
} from "./actions";
import { AttentionMascot } from "@/components/tenant-illustration";
import { useT } from "@/components/i18n";
import { Rich } from "@/components/rich-text";

const field =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

/** The three documents a qualification is founded on, in the order they matter. */
const SOURCES = [
  { name: "curriculum", required: true },
  { name: "qualification", required: false },
  { name: "assessmentSpecification", required: false },
] as const;

/**
 * Building a qualification out of the three documents that define it.
 *
 * Two steps, and the split is the point. The first reads the files and shows
 * what they say; the second writes it. Nothing exists in between, so a reading
 * that looks wrong is abandoned by closing the panel rather than by undoing a
 * half-made qualification.
 *
 * The files are held in one form across both steps (the read button and the
 * create button post the same form), so nothing is uploaded twice by the person
 * and nothing is parked on the server waiting to be come back to.
 */
export function FromDocument({
  startOpen = false,
  closeHref,
}: {
  /** Already chosen on the screen before this, so there is nothing to open. */
  startOpen?: boolean;
  /** Where "Close" goes when the choice was made by a link rather than here. */
  closeHref?: string;
} = {}) {
  const t = useT();
  const [reading, read, readPending] = useActionState<ReadingState, FormData>(readCurriculumAction, {});
  const [created, create, createPending] = useActionState<CreateFromDocumentState, FormData>(
    createFromDocumentAction,
    {},
  );

  const [open, setOpen] = useState(startOpen);
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const formRef = useRef<HTMLFormElement>(null);
  const held = useRef<Record<string, File>>({});

  /**
   * Puts the chosen files back after every render.
   *
   * React clears an uncontrolled form once a form action resolves, which here
   * empties all three file inputs the moment the read finishes, so the create
   * step that follows would post no documents at all, and be blocked by the
   * required-file validation with nothing on screen explaining why. Holding
   * the File objects and reattaching them is what makes the second step
   * possible without asking somebody to pick the same three files twice.
   */
  useEffect(() => {
    for (const [name, file] of Object.entries(held.current)) {
      const input = formRef.current?.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (!input || (input.files && input.files.length > 0)) continue;

      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
    }
  });
  const anyChosen = Object.values(chosen).some((name) => Boolean(name));

  /*
   * How long the reading has been going.
   *
   * There is no real progress to report - it is one server call that does not
   * report back - so this counts seconds honestly rather than drawing a bar
   * that advances on a guess. A bar that reaches ninety per cent and stops is
   * worse than none.
   */
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!readPending) return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000);
    return () => {
      clearInterval(timer);
      setSeconds(0);
    };
  }, [readPending]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md px-4 py-2 text-sm font-semibold text-white"
        style={{ background: "var(--brand-primary)" }}
      >
        {t("fromDoc.open")}
      </button>
    );
  }

  const found = reading.reading;

  /*
   * Which of the three steps is showing.
   *
   * The flow was already read-then-confirm; what it never did was say so. The
   * qualification test failed partly on not knowing what would happen next or
   * whether anything had been written yet, and a person who cannot see where
   * they are in a process assumes the worst at the first pause.
   */
  const step = found ? 2 : 1;

  const componentLabel = (component: string) =>
    component === "knowledge"
      ? t("component.knowledge")
      : component === "practical"
        ? t("component.practical")
        : component === "workplace"
          ? t("component.workplaceShort")
          : component;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
      {/*
        Two steps, because there are two. Creating redirects straight to the
        qualification, so a third step would be a state this component never
        sees - and a step somebody never arrives at is worse than no step.
      */}
      <Steps current={step} labels={[t("fromDoc.step1"), t("fromDoc.step2")]} hereLabel={t("fromDoc.youAreHere")} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{t("fromDoc.title")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("fromDoc.intro")}</p>
        </div>
        {/*
          A link where the choice was made on the screen before this one, so
          closing returns to the three options rather than collapsing to a
          button on an otherwise empty page.
        */}
        {closeHref ? (
          <Link href={closeHref} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm">
            {t("fromDoc.close")}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
          >
            {t("fromDoc.close")}
          </button>
        )}
      </div>

      {/* One form, two submit buttons: read, then create. */}
      <form ref={formRef} className="mt-5">
        <div className="grid gap-4 sm:grid-cols-3">
          {SOURCES.map((source) => (
            <label key={source.name} className="block space-y-1.5">
              <span className="block text-sm font-medium">
                {t(`fromDoc.source.${source.name}`)}
                {source.required ? null : (
                  <span className="font-normal text-[var(--muted)]">{t("fromDoc.recommended")}</span>
                )}
              </span>
              <input
                type="file"
                name={source.name}
                accept=".pdf,.docx,.doc"
                required={source.required}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    held.current[source.name] = file;
                  } else {
                    delete held.current[source.name];
                  }
                  setChosen({ ...chosen, [source.name]: file?.name ?? "" });
                }}
                className="block w-full text-xs file:mr-2 file:rounded-md file:border file:border-[var(--border)] file:bg-[var(--surface)] file:px-2 file:py-1 file:text-xs"
              />
              <span className="block text-xs text-[var(--muted)]">{t(`fromDoc.source.${source.name}.note`)}</span>
            </label>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            formAction={read}
            disabled={readPending}
            className={`rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-60 ${
              anyChosen && !readPending && !found
                ? "ring-2 ring-[var(--brand-accent)] ring-offset-2 ring-offset-[var(--surface)] motion-safe:animate-pulse"
                : ""
            }`}
          >
            {readPending ? t("fromDoc.reading") : t("fromDoc.read")}
          </button>

          {anyChosen && !readPending && !found ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--brand-accent)]">
              <AttentionMascot className="mr-1" />
              <span aria-hidden className="motion-safe:animate-bounce">
                ←
              </span>
              {t("fromDoc.pressThis")}
            </p>
          ) : null}

          {readPending ? (
            <p role="status" className="flex items-center gap-2 text-sm text-[var(--muted)]">
              <span
                aria-hidden
                className="inline-block h-4 w-4 rounded-full border-2 border-[var(--border)] border-t-[var(--brand-accent)] motion-safe:animate-spin"
              />
              {seconds < 15 ? t("fromDoc.readingDocs") : t("fromDoc.stillReading", { seconds })}
            </p>
          ) : null}
        </div>

        {reading.error ? (
          <p
            role="alert"
            className="mt-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
          >
            {reading.error}
          </p>
        ) : null}

        {/* --- step two: check and confirm --- */}
        {found ? (
          <div className="mt-6 border-t border-[var(--border)] pt-5">
            <p className="text-sm">
              {found.totals.exitLevelOutcomes > 0
                ? t("fromDoc.foundWithElo", {
                    modules: found.totals.modules,
                    topics: found.totals.topics,
                    elements: found.totals.elements,
                    criteria: found.totals.criteria,
                    outcomes: found.totals.exitLevelOutcomes,
                    associated: found.totals.associatedCriteria,
                  })
                : t("fromDoc.found", {
                    modules: found.totals.modules,
                    topics: found.totals.topics,
                    elements: found.totals.elements,
                    criteria: found.totals.criteria,
                  })}
            </p>

            {/*
              A part qualification matching an existing code is the ordinary
              case rather than a clash: its curriculum document is the parent's,
              byte for byte, and the match is how the parent is found at all.
              The refusal below is for a full qualification being imported twice.
            */}
            {found.part ? (
              <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm">
                <p>
                  <Rich
                    text={t("fromDoc.partOf")}
                    parts={{
                      kind: (
                        <strong>
                          {found.details.kind === "part" ? t("fromDoc.kindPart") : t("fromDoc.kindProgramme")}
                        </strong>
                      ),
                      parent: <strong>{found.part.parent.title}</strong>,
                      count: found.part.modules.filter((entry) => entry.found).length,
                    }}
                  />
                </p>
                {found.part.modules.length > 0 ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {found.part.modules
                      .map((entry) => `${entry.code}${entry.found ? "" : t("fromDoc.notFound")}`)
                      .join(" · ")}
                  </p>
                ) : null}
              </div>
            ) : found.existing ? (
              /*
                Already here, which is not a failure.

                This was a red alert over a dead button: "Open that
                qualification instead", with nothing to press and no way to get
                there. A disabled control with the reason stated is better than
                one without, and a way forward is better than either: this is
                the ordinary case of somebody importing a qualification that
                somebody else already started, and the thing they want next is
                one click away.
              */
              <div className="mt-3 rounded-md border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 px-3 py-3 text-sm">
                <p className="font-medium">{t("fromDoc.already", { title: found.existing.title })}</p>
                <p className="mt-1 text-[var(--muted)]">{t("fromDoc.alreadyWhy")}</p>
                <Link
                  href={`/qualifications/${found.existing.id}`}
                  className="mt-2 inline-block rounded-md px-4 py-2 text-sm font-semibold text-white"
                  style={{ background: "var(--brand-primary)" }}
                >
                  {t("fromDoc.openIt")}
                </Link>
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 sm:col-span-2">
                <span className="block text-sm font-medium">{t("fromDoc.titleField")}</span>
                <input
                  name="title"
                  required
                  minLength={3}
                  defaultValue={found.details.title ?? ""}
                  className={field}
                />
              </label>

              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">
                  {t("fromDoc.saqaId")}
                  {found.details.saqaId ? null : (
                    <span className="font-normal text-[var(--muted)]">{t("fromDoc.noQualDoc")}</span>
                  )}
                </span>
                <input name="saqaId" defaultValue={found.details.saqaId ?? ""} className={`${field} font-mono`} />
              </label>

              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">{t("fromDoc.curriculumCode")}</span>
                <input
                  name="curriculumCode"
                  defaultValue={found.details.curriculumCode ?? ""}
                  className={`${field} font-mono`}
                />
              </label>

              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">{t("fromDoc.nqf")}</span>
                <input
                  name="nqfLevel"
                  type="number"
                  min={1}
                  max={10}
                  defaultValue={found.details.nqfLevel ?? ""}
                  className={field}
                />
              </label>

              <label className="block space-y-1.5">
                <span className="block text-sm font-medium">{t("fromDoc.credits")}</span>
                <input
                  name="totalCredits"
                  type="number"
                  min={0}
                  defaultValue={found.details.totalCredits ?? ""}
                  className={field}
                />
              </label>
            </div>

            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium">
                {t("fromDoc.modulesFound", { count: found.modules.length })}
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                      <th className="pb-2">{t("fromDoc.module")}</th>
                      <th className="pb-2">{t("fromDoc.kind")}</th>
                      <th className="pb-2">{t("fromDoc.creditsCol")}</th>
                      <th className="pb-2">{t("fromDoc.topics")}</th>
                      <th className="pb-2">{t("fromDoc.toTeach")}</th>
                      <th className="pb-2">{t("fromDoc.criteria")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {found.modules.map((row) => (
                      <tr key={row.code} className="border-t border-[var(--border)]">
                        <td className="py-2 pr-3">
                          <span className="font-mono text-xs">{row.code}</span> {row.title}
                        </td>
                        <td className="py-2 pr-3 text-xs">{componentLabel(row.component)}</td>
                        <td className="py-2 pr-3 tabular-nums">{row.credits ?? "—"}</td>
                        <td className="py-2 pr-3 tabular-nums">{row.topics}</td>
                        <td className="py-2 pr-3 tabular-nums">{row.elements}</td>
                        <td className="py-2 tabular-nums">{row.component === "workplace" ? "—" : row.criteria}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            {found.exitLevelOutcomes.length > 0 ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {t("fromDoc.outcomes", { count: found.exitLevelOutcomes.length })}
                </summary>
                <ul className="mt-2 space-y-2 text-sm">
                  {found.exitLevelOutcomes.map((outcome) => (
                    <li key={outcome.number}>
                      <span className="font-medium">{t("fromDoc.elo", { number: outcome.number })}</span>{" "}
                      {outcome.description}
                      <span className="ml-1 text-xs text-[var(--muted)]">
                        {t("fromDoc.associated", { count: outcome.criteria.length })}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {found.notes.length > 0 ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-[var(--brand-accent)]">
                  {t("fromDoc.toCheck", { count: found.notes.length })}
                </summary>
                <ul className="mt-2 space-y-1 text-sm text-[var(--muted)]">
                  {found.notes.map((note, index) => (
                    <li key={index}>· {note}</li>
                  ))}
                </ul>
              </details>
            ) : null}

            {created.error ? (
              <p
                role="alert"
                className="mt-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
              >
                {created.error}
              </p>
            ) : null}

            {/*
              Absent rather than disabled where it cannot be used. The panel
              above carries the reason and the way forward, and a dead button
              underneath it would only invite somebody to press it.
            */}
            {found.existing && !found.part ? null : (
              <>
                <button
                  type="submit"
                  formAction={create}
                  disabled={createPending}
                  className="mt-5 rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: "var(--brand-primary)" }}
                >
                  {createPending
                    ? t("fromDoc.creating")
                    : found.part
                      ? t("fromDoc.createPart")
                      : t("fromDoc.create")}
                </button>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  {found.part ? t("fromDoc.filedPart") : t("fromDoc.filed")}
                </p>
              </>
            )}
          </div>
        ) : null}
      </form>
    </section>
  );
}

/**
 * Where you are, and what is left.
 *
 * Steps rather than a bar with a percentage, because the steps are real and a
 * percentage would not be. Each is named by what the person does at it, not by
 * what the system does: "check what was found" rather than "parsing".
 */
function Steps({
  current,
  labels,
  hereLabel,
}: {
  current: number;
  labels: string[];
  hereLabel: string;
}) {
  return (
    <ol className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {labels.map((label, index) => {
        const number = index + 1;
        const done = number < current;
        const here = number === current;

        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-hidden
              className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${
                here
                  ? "border-[var(--brand-accent)] bg-[var(--brand-accent)] font-semibold text-white"
                  : done
                    ? "border-[var(--success)] text-[var(--success)]"
                    : "border-[var(--border)] text-[var(--muted)]"
              }`}
            >
              {done ? "✓" : number}
            </span>
            <span className={here ? "font-medium text-[var(--foreground)]" : "text-[var(--muted)]"}>
              {label}
              {here ? <span className="sr-only">{hereLabel}</span> : null}
            </span>
            {number < labels.length ? (
              <span aria-hidden className="text-[var(--muted)]">
                &rarr;
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
