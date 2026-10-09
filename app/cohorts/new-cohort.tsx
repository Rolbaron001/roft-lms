"use client";
import { DateField } from "@/components/date-field";

import { useActionState, useState } from "react";
import { createCohortAction, type CohortActionState } from "./actions";
import { useT } from "@/components/i18n";

const field =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

export type CourseOption = {
  id: string;
  title: string;
  status: string;
  version: number | null;
};

/**
 * Starting a cohort.
 *
 * Only published courses are offered. A cohort on a draft course is a group of
 * learners waiting on material that can still change underneath them, and the
 * publish gate exists precisely so that does not happen.
 *
 * The provider's own words for a cohort and a course come from the page, which
 * holds their vocabulary; the browser does not.
 */
export function NewCohort({
  courses,
  qualifications = [],
  words,
  facilitators = [],
  named = {},
}: {
  courses: CourseOption[];
  /** Qualifications a cohort can walk end to end (Roland, 5 October 2026). */
  qualifications?: { id: string; title: string; credits?: number | null }[];
  words: { cohort: string; course: string; courses: string; Course: string };
  /** Everyone who may facilitate, and those each programme names (job sheet D27). */
  facilitators?: { id: string; name: string }[];
  named?: Record<string, string[]>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [state, act, pending] = useActionState<CohortActionState, FormData>(
    createCohortAction,
    {},
  );

  const publishable = courses.filter((course) => course.status === "published");
  const [walks, setWalks] = useState<string>(
    qualifications[0] ? `qualification:${qualifications[0].id}` : publishable[0] ? `course:${publishable[0].id}` : "",
  );
  const [mode, setMode] = useState<"scheduled" | "open">("scheduled");
  const chosenQualification = walks.startsWith("qualification:") ? qualifications.find((one) => `qualification:${one.id}` === walks) : undefined;
  const creditBearing = chosenQualification?.credits ?? 0;
  const newLabel = t("cohorts.new", { cohort: words.cohort });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md px-4 py-2 text-sm font-semibold text-white"
        style={{ background: "var(--brand-primary)" }}
      >
        {newLabel}
      </button>
    );
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{newLabel}</h2>

      {publishable.length === 0 && qualifications.length === 0 ? (
        <>
          <p className="mt-3 text-sm">
            {t("cohorts.noPublished", { courses: words.courses, cohort: words.cohort, course: words.course })}
          </p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-3 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
          >
            {t("cohorts.close")}
          </button>
        </>
      ) : (
        <form action={act} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="block text-sm font-medium">{t("cohorts.walks")}</span>
            <select name="walks" required className={field} value={walks} onChange={(event) => setWalks(event.target.value)}>
              {qualifications.length > 0 ? (
                <optgroup label={t("cohorts.wholeQualification")}>
                  {qualifications.map((qualification) => (
                    <option key={qualification.id} value={`qualification:${qualification.id}`}>
                      {qualification.title}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {publishable.length > 0 ? (
                <optgroup label={words.Course}>
                  {publishable.map((course) => (
                    <option key={course.id} value={`course:${course.id}`}>
                      {course.title}
                      {course.version ? ` (v${course.version})` : ""}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            <span className="block text-xs text-[var(--muted)]">{t("cohorts.walksNote")}</span>
          </label>

          <fieldset className="space-y-1.5 sm:col-span-2">
            <legend className="text-sm font-medium">{t("cohorts.release")}</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="releaseMode" value="scheduled" className="mt-1" checked={mode === "scheduled"} onChange={() => setMode("scheduled")} />
              <span>{t("cohorts.releaseScheduled")}</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="releaseMode" value="open" className="mt-1" checked={mode === "open"} onChange={() => setMode("open")} />
              <span>{t("cohorts.releaseOpen")}</span>
            </label>
            {/*
              Heidi, 8 October 2026: self-study is not allowed on credit-bearing
              programmes. No QCTO document held says so, and the QCTO allows
              online delivery, so this warns rather than refuses: it is Curiosa's
              rule, and another provider's may differ (job sheet D22).
            */}
            {mode === "open" && creditBearing ? (
              <p role="alert" className="rounded-md border border-[#b7791f]/40 bg-[#fbefd9] px-3 py-2 text-sm text-[#7a4f10]">
                {t("cohorts.openCredits", { credits: creditBearing })}
              </p>
            ) : null}
          </fieldset>

          {facilitators.length > 0 ? (
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="block text-sm font-medium">
                {t("cohorts.facilitator")}{" "}
                <span className="font-normal text-[var(--muted)]">{t("common.optional")}</span>
              </span>
              {/* Keyed by the programme, so the choice resets to its own people. */}
              <select key={walks} name="facilitatorId" defaultValue={named[walks]?.[0] ?? ""} className={field}>
                <option value="">{t("cohorts.facilitatorNone")}</option>
                {(named[walks] ?? []).length > 0 ? (
                  <optgroup label={t("cohorts.facilitatorNamed")}>
                    {facilitators.filter((person) => named[walks]?.includes(person.id)).map((person) => (
                      <option key={person.id} value={person.id}>{person.name}</option>
                    ))}
                  </optgroup>
                ) : null}
                <optgroup label={t("cohorts.facilitatorOthers")}>
                  {facilitators.filter((person) => !named[walks]?.includes(person.id)).map((person) => (
                    <option key={person.id} value={person.id}>{person.name}</option>
                  ))}
                </optgroup>
              </select>
            </label>
          ) : null}

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("cohorts.name")}</span>
            <input name="name" required minLength={2} placeholder={t("cohorts.nameHint")} className={field} />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              {t("cohorts.code")}{" "}
              <span className="font-normal text-[var(--muted)]">{t("common.optional")}</span>
            </span>
            <input name="code" placeholder={t("cohorts.codeHint")} className={field} />
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("cohorts.start")}</span>
            <DateField name="startDate" required className={field} />
            <span className="block text-xs text-[var(--muted)]">{t("cohorts.startNote")}</span>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              {t("cohorts.end")}{" "}
              <span className="font-normal text-[var(--muted)]">{t("common.optional")}</span>
            </span>
            <DateField name="endDate" className={field} />
          </label>

          {state.error ? (
            <p
              role="alert"
              className="sm:col-span-2 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
            >
              {state.error}
            </p>
          ) : null}

          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--brand-primary)" }}
            >
              {pending ? t("cohorts.creating") : t("cohorts.create", { cohort: words.cohort })}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
