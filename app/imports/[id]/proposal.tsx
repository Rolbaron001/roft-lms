"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  commitPlanAction,
  discardImportAction,
  type ImportActionState,
} from "../actions";
import { useT } from "@/components/i18n";
import { maybe } from "@/lib/i18n/maybe";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
const buttonClass =
  "rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60";

/**
 * The kinds withheld from anybody without the right to assess.
 *
 * Repeated from lib/programme-documents.ts rather than imported, because that
 * module reaches the database and this one runs in the browser. Held to the
 * same list by a test, which is the only honest way to keep a copy.
 */
const RESTRICTED_KINDS = new Set([
  "workbook_memorandum",
  "summative_memorandum",
  "summative_assessment",
]);

export type PlanView = {
  source: string;
  qualification: {
    title: string;
    saqaId: string | null;
    curriculumCode: string | null;
    nqfLevel: number | null;
    credits: number | null;
  };
  modules: {
    component?: string;
    code?: string;
    title?: string;
    credits?: number | null;
    topics?: {
      code?: string | null;
      title?: string;
      elements?: string[];
      criteria?: string[];
    }[];
  }[];
  studyUnits: { code: string; title: string }[];
  documents: {
    path: string;
    filename: string;
    target: string;
    kind: string | null;
    category: string | null;
    studyUnitCode: string | null;
    title: string;
    version: string | null;
    because: string;
  }[];
  warnings: string[];
};

/**
 * The whole plan, on one screen, committed in one act.
 *
 * Warnings first and unmissable, because they are the part that matters: they
 * are where the model or the programme build says what it could not determine,
 * and a fabricated assessment criterion caught here is one nobody is assessed
 * against.
 *
 * Everything else is collapsed by default. Fifteen modules and sixty documents
 * expanded at once is a page nobody reads, and a review nobody finishes is not
 * a review.
 */
export function Proposal({
  jobId,
  status,
  plan,
  qualifications,
  target,
}: {
  jobId: string;
  status: string;
  plan: PlanView;
  qualifications: { id: string; title: string }[];
  /** Where this is going, decided when the folder was read. */
  target: {
    mode: string;
    qualificationId?: string;
    courseId?: string;
    learningPathId?: string;
  };
}) {
  const t = useT();
  const [state, action, committing] = useActionState<
    ImportActionState,
    FormData
  >(commitPlanAction, {});
  const [discardState, discardAction] = useActionState<
    ImportActionState,
    FormData
  >(discardImportAction, {});
  const [open, setOpen] = useState<string | null>("warnings");

  const live = status === "proposed";
  const error = state.error ?? discardState.error;

  const totals = plan.modules.reduce(
    (sum, module) => {
      const topics = module.topics ?? [];
      return {
        topics: sum.topics + topics.length,
        elements:
          sum.elements +
          topics.reduce((count, topic) => count + (topic.elements?.length ?? 0), 0),
        criteria:
          sum.criteria +
          topics.reduce((count, topic) => count + (topic.criteria?.length ?? 0), 0),
      };
    },
    { topics: 0, elements: 0, criteria: 0 },
  );

  const section = (key: string, label: string, count: number) => (
    <button
      type="button"
      onClick={() => setOpen(open === key ? null : key)}
      className="flex w-full items-baseline justify-between border-b border-[var(--border)] py-2 text-left text-sm"
    >
      <span className="font-medium">{label}</span>
      <span className="text-[var(--muted)]">
        {count} {open === key ? "▴" : "▾"}
      </span>
    </button>
  );

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      {/*
        What happened, and where to go now.

        A successful commit returned a sentence and stopped there, so somebody
        who had just filed eighty-one documents was left on this page with the
        browser's back button. The count is worth reading; it is not worth
        being stranded on.
      */}
      {state.notice ? (
        <div className="rounded-md border border-[var(--success)]/40 bg-[var(--success)]/5 p-3">
          <p className="text-sm">{state.notice}</p>
          {state.committedTo ? (
            <p className="mt-2">
              <Link
                href={`/qualifications/${state.committedTo}`}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
                style={{ background: "var(--brand-primary)" }}
              >
                {t("proposal.open")}
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}

      {/*
        Where this plan came from, said accurately.

        A material import produced an empty plan whose source said
        "blueprint", so this told Roland his 81 files had been "read from the
        folder's own blueprint file" - of a folder that has no blueprint, in a
        mode that reads no structure at all and never asks a model. The claim
        was about provenance, which is the one thing a review screen must not
        get wrong.
      */}
      <p className="text-sm text-[var(--muted)]">
        {plan.source === "blueprint"
          ? t("proposal.fromBlueprint")
          : plan.source === "documents"
            ? t("proposal.fromDocuments")
            : t("proposal.byName")}
      </p>

      {/*
        Hidden for a filing run, which reads no qualification and no
        curriculum. Shown anyway it read "Qualification: Not stated, NQF ? · ?
        credits, will create 0 modules, 0 topics, 0 elements, 0 criteria" -
        four blanks and five zeroes over a perfectly successful import of
        eighty-one documents. It looks like a failure and it is a success.
      */}
      {plan.source === "filing" ? (
        <p className="text-sm">
          <span className="font-medium">{t("proposal.toFile", { count: plan.documents.length })}</span>{" "}
          <span className="text-[var(--muted)]">
            {t("proposal.toFileRest")}{" "}
            {plan.studyUnits.length > 0
              ? `${t("proposal.unitsNamed", { count: plan.studyUnits.length })} `
              : ""}
            {t("proposal.nothingChanged")}
          </span>
        </p>
      ) : (
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-[var(--muted)]">{t("proposal.qualification")}</dt>
        <dd className="font-medium">{plan.qualification.title || t("proposal.notStated")}</dd>
        {plan.qualification.saqaId ? (
          <>
            <dt className="text-[var(--muted)]">{t("proposal.saqa")}</dt>
            <dd>{plan.qualification.saqaId}</dd>
          </>
        ) : null}
        {plan.qualification.curriculumCode ? (
          <>
            <dt className="text-[var(--muted)]">{t("proposal.curriculumCode")}</dt>
            <dd>{plan.qualification.curriculumCode}</dd>
          </>
        ) : null}
        <dt className="text-[var(--muted)]">{t("proposal.levelCredits")}</dt>
        <dd>
          {t("proposal.nqfCredits", {
            level: plan.qualification.nqfLevel ?? "?",
            credits: plan.qualification.credits ?? "?",
          })}
        </dd>
        <dt className="text-[var(--muted)]">{t("proposal.willCreate")}</dt>
        <dd>
          {t("proposal.counts", {
            modules: plan.modules.length,
            topics: totals.topics,
            elements: totals.elements,
            criteria: totals.criteria,
            units: plan.studyUnits.length,
            documents: plan.documents.length,
          })}
        </dd>
      </dl>
      )}

      {/* --- warnings, first and open ------------------------------------- */}
      {plan.warnings.length > 0 ? (
        <div>
          {section("warnings", t("proposal.readFirst"), plan.warnings.length)}
          {open === "warnings" ? (
            <ul className="mt-2 space-y-2 text-sm">
              {plan.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* --- modules ------------------------------------------------------ */}
      {/* A filing run creates no curriculum, so "Curriculum 0" is another
          zero that reads as a failure over a successful import. */}
      <div hidden={plan.source === "filing"}>
        {section("modules", t("proposal.curriculum"), plan.modules.length)}
        {open === "modules" ? (
          <ul className="mt-2 space-y-2 text-sm">
            {plan.modules.map((module) => {
              const topics = module.topics ?? [];
              return (
                <li key={module.code} className="flex flex-wrap gap-x-3">
                  <span className="font-mono text-xs">{module.code}</span>
                  <span>{module.title}</span>
                  <span className="text-[var(--muted)]">
                    {maybe(t, `proposal.component.${module.component ?? ""}`) ??
                      t("proposal.componentUnknown")}
                    {module.credits ? ` · ${module.credits}cr` : ""} ·{" "}
                    {t("proposal.moduleCounts", {
                      topics: topics.length,
                      criteria: topics.reduce((sum, topic) => sum + (topic.criteria?.length ?? 0), 0),
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {/* --- documents ---------------------------------------------------- */}
      <div>
        {section("documents", t("proposal.documents"), plan.documents.length)}

        {/*
          Who will be able to open these, said before the list rather than
          discoverable by reading eighty lines of it.

          This is the one consequence on the screen that cannot be undone by
          noticing later. A memorandum filed as something unrestricted is
          handed to the learners it is the answer key for, at the moment of
          commit, silently - which is what would have happened to
          thirty-eight of Curiosa's documents before the naming rules knew
          "WB1 AG" and "SA1 V1 AG".

          The rules are better now and they are still only rules about
          filenames. So the count is stated, and the catch-all is named,
          because "other" is the bucket an unrecognised name falls into and
          nothing in it is withheld from anybody.
        */}
        {plan.documents.length > 0 ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            {(() => {
              const withheld = plan.documents.filter((one) =>
                RESTRICTED_KINDS.has(one.kind ?? ""),
              ).length;
              const unknown = plan.documents.filter(
                (one) => !one.kind || one.kind === "other",
              ).length;
              const visible = plan.documents.length - withheld;

              return (
                <>
                  <span className="font-medium text-[var(--foreground)]">
                    {t("proposal.withheld", { withheld, visible })}
                  </span>{" "}
                  {t("proposal.withheldNote")}
                  {unknown > 0 ? (
                    <>
                      {" "}
                      <span className="font-medium text-[var(--foreground)]">
                        {unknown === 1 ? t("proposal.unknownOne") : t("proposal.unknown", { count: unknown })}
                      </span>{" "}
                      {t("proposal.unknownNote")}
                    </>
                  ) : null}
                </>
              );
            })()}
          </p>
        ) : null}

        {open === "documents" ? (
          <ul className="mt-2 space-y-2 text-sm">
            {plan.documents.map((document) => (
              <li key={document.path}>
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-mono text-xs">{document.path}</span>
                  <span className="text-[var(--muted)]">
                    → {maybe(t, `proposal.target.${document.target}`) ?? document.target}
                    {document.studyUnitCode ? ` (${document.studyUnitCode})` : ""}
                    {document.kind
                      ? ` ${t("proposal.as", { kind: maybe(t, `docKind.${document.kind}`) ?? document.kind.replace(/_/g, " ") })}`
                      : ""}
                    {document.category ? ` ${t("proposal.as", { kind: document.category })}` : ""}
                  </span>
                  {/* Marked on the line itself, so scanning the list answers
                      the question without counting. */}
                  {RESTRICTED_KINDS.has(document.kind ?? "") ? (
                    <span className="rounded bg-[var(--border)]/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                      {t("proposal.withheldTag")}
                    </span>
                  ) : !document.kind || document.kind === "other" ? (
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                      style={{
                        background: "color-mix(in srgb, var(--danger) 10%, transparent)",
                        color: "var(--danger)",
                      }}
                    >
                      {t("proposal.unknownTag")}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-[var(--muted)]">{document.because}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* --- commit ------------------------------------------------------- */}
      {live ? (
        <form
          action={action}
          className="space-y-2 border-t border-[var(--border)] pt-4"
        >
          <input type="hidden" name="jobId" value={jobId} />

          {target.mode === "qualification" ? (
            /*
              Creating the qualification this folder describes is the default,
              because that is what "build it from a folder" means.

              This used to be a required list of qualifications that already
              exist, with no other option. Roland emptied the platform, read
              the 121151 folder with Claude - which worked - and met "Into
              which qualification" with nothing in it and no way past. The
              folder route could read a whole qualification and not create one.
            */
            <label className="block text-sm">
              <span className="text-[var(--muted)]">{t("proposal.where")}</span>
              <select
                name="qualificationId"
                className={`${inputClass} mt-1 block w-full max-w-md`}
                defaultValue=""
              >
                <option value="">
                  {t("proposal.create", { title: plan.qualification.title || t("proposal.createDefault") })}
                </option>
                {qualifications.length > 0 ? (
                  <optgroup label={t("proposal.orAdd")}>
                    {qualifications.map((qualification) => (
                      <option key={qualification.id} value={qualification.id}>
                        {qualification.title}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <span className="mt-1 block max-w-2xl text-xs text-[var(--muted)]">{t("proposal.addNote")}</span>
            </label>
          ) : (
            // Already decided: this folder was read from the thing it belongs
            // to, so asking again would only be a chance to get it wrong.
            <>
              <input
                type="hidden"
                name="qualificationId"
                value={target.qualificationId ?? ""}
              />
              <input
                type="hidden"
                name="courseId"
                value={target.courseId ?? ""}
              />
              <input
                type="hidden"
                name="learningPathId"
                value={target.learningPathId ?? ""}
              />
              {target.mode === "top_up" ? (
                // Everything above is what the folder holds, not what is about
                // to be created. Most of it is probably already here, and
                // somebody reading a familiar list under a commit button will
                // reasonably fear a second copy of it. Said before the button,
                // not after.
                <p className="max-w-2xl text-sm text-[var(--muted)]">{t("proposal.topUp")}</p>
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  {target.mode === "course"
                    ? t("proposal.filedCourse")
                    : target.mode === "programme"
                      ? t("proposal.filedProgramme")
                      : t("proposal.filedQualification")}
                </p>
              )}
            </>
          )}

          <p className="max-w-2xl text-xs text-[var(--muted)]">{t("proposal.checks")}</p>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={committing}
              className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {committing ? t("proposal.committing") : t("proposal.commit")}
            </button>
          </div>
        </form>
      ) : null}

      {live ? (
        <form action={discardAction}>
          <input type="hidden" name="jobId" value={jobId} />
          <button type="submit" className={buttonClass}>
            {t("proposal.discard")}
          </button>
          <p className="mt-2 text-xs text-[var(--muted)]">{t("proposal.discardNote")}</p>
        </form>
      ) : null}
    </div>
  );
}
