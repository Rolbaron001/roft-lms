"use client";

import { useActionState } from "react";
import {
  EXAMINER_SECTIONS,
  MODERATOR_SECTIONS,
  QUALITY_RATINGS,
  type ChecklistAnswer,
  type ChecklistSection,
} from "@/lib/fisa-checklist";
import {
  answerAction,
  appointAction,
  coverageAction,
  createAction,
  newVersionAction,
  sendToModerationAction,
  signConfidentialityAction,
  signOffAction,
  type FisaState,
} from "./actions";

const field =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

function Message({ state }: { state: FisaState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="mt-2 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
      >
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="mt-2 rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
        {state.notice}
      </p>
    );
  }
  return null;
}

/** Opening a FISA against a skills programme. */
export function CreateForm({
  programmes,
}: {
  programmes: { id: string; title: string; saqaId: string | null }[];
}) {
  const [state, act, working] = useActionState<FisaState, FormData>(
    createAction,
    {},
  );

  if (programmes.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        A FISA is set against a skills programme, and there are none yet. Import
        one first — a full or part qualification is assessed externally by the
        Assessment Quality Partner, so the provider does not set that paper.
      </p>
    );
  }

  return (
    <form action={act} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Skills programme</span>
          <select name="qualificationId" className={field}>
            {programmes.map((programme) => (
              <option key={programme.id} value={programme.id}>
                {programme.title}
                {programme.saqaId ? ` · ${programme.saqaId}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">What to call it</span>
          <input name="title" className={field} placeholder="FISA — first sitting" />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Duration, minutes</span>
          <input name="durationMinutes" type="number" min="1" className={field} placeholder="120" />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Total marks</span>
          <input name="totalMarks" type="number" min="1" className={field} placeholder="80" />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Pass mark, %</span>
          <input name="passMarkPercent" type="number" min="1" max="100" className={field} placeholder="70" />
          <span className="block text-xs text-[var(--muted)]">
            A FISA is an examination, so it has one — unlike internal competence.
          </span>
        </label>
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <input type="checkbox" name="hasPracticalComponent" className="mt-1" />
        <span>
          It also has a practical component judged competent or not yet competent
          <input
            name="practicalNote"
            className={`${field} mt-1.5`}
            placeholder="e.g. Practical: 4 hours, judged competent / not yet competent"
          />
        </span>
      </label>

      <button
        type="submit"
        disabled={working}
        className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--brand-primary)" }}
      >
        {working ? "Opening…" : "Open the FISA"}
      </button>

      <Message state={state} />
    </form>
  );
}

/** Appointing an examiner or a moderator. */
export function AppointForm({
  instrumentId,
  role,
  staff,
}: {
  instrumentId: string;
  role: "examiner" | "moderator";
  staff: { id: string; name: string }[];
}) {
  const [state, act, working] = useActionState<FisaState, FormData>(
    appointAction,
    {},
  );

  return (
    <form action={act} className="space-y-3">
      <input type="hidden" name="instrumentId" value={instrumentId} />
      <input type="hidden" name="role" value={role} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Full names</span>
          <input name="fullName" className={field} />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Identity number</span>
          <input name="idNumber" className={field} />
          <span className="block text-xs text-[var(--muted)]">
            How the platform tells one person from another when they have no
            account here.
          </span>
        </label>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Email</span>
          <input name="email" type="email" className={field} />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Mobile</span>
          <input name="mobile" type="tel" className={field} />
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">
          Their account here, if they have one
        </span>
        <select name="userId" className={field}>
          <option value="">Somebody from outside, with no account</option>
          {staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
        <span className="block text-xs text-[var(--muted)]">
          Only somebody with an account can fill in their own report here.
        </span>
      </label>

      <button
        type="submit"
        disabled={working}
        className="rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
      >
        {working ? "Appointing…" : `Appoint the ${role}`}
      </button>

      <Message state={state} />
    </form>
  );
}

/** Recording that somebody signed their confidentiality agreement. */
export function SignConfidentialityForm({
  instrumentId,
  appointmentId,
}: {
  instrumentId: string;
  appointmentId: string;
}) {
  const [state, act, working] = useActionState<FisaState, FormData>(
    signConfidentialityAction,
    {},
  );

  return (
    <form action={act} className="inline">
      <input type="hidden" name="instrumentId" value={instrumentId} />
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <button
        type="submit"
        disabled={working}
        className="rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--brand-primary)" }}
      >
        {working ? "Recording…" : "Record the signed agreement"}
      </button>
      <Message state={state} />
    </form>
  );
}

/**
 * One report: every numbered item, with the answer and the recommendation.
 *
 * Laid out as the paper is, section by section, so somebody holding the
 * printed report can follow along. The section number shown is the paper's own
 * — which is why the moderator's report shows "5" twice.
 */
export function ChecklistForm({
  instrumentId,
  role,
  answers,
  recommendations,
  readOnly,
}: {
  instrumentId: string;
  role: "examiner" | "moderator";
  answers: Record<string, ChecklistAnswer | undefined>;
  recommendations: Record<string, string | null>;
  readOnly: boolean;
}) {
  const sections: ChecklistSection[] =
    role === "examiner" ? EXAMINER_SECTIONS : MODERATOR_SECTIONS;

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <section key={`${section.number}`}>
          <h4 className="mb-2 text-sm font-semibold">
            <span className="mr-2 font-mono text-[var(--muted)]">
              {section.printedAs}.
            </span>
            {section.title}
          </h4>

          <div className="space-y-2">
            {section.items.map((item) => (
              <ChecklistRow
                key={item.code}
                instrumentId={instrumentId}
                role={role}
                code={item.code}
                text={item.text}
                allowsNa={Boolean(item.allowsNotApplicable)}
                answer={answers[item.code]}
                recommendation={recommendations[item.code] ?? ""}
                readOnly={readOnly}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ChecklistRow({
  instrumentId,
  role,
  code,
  text,
  allowsNa,
  answer,
  recommendation,
  readOnly,
}: {
  instrumentId: string;
  role: "examiner" | "moderator";
  code: string;
  text: string;
  allowsNa: boolean;
  answer: ChecklistAnswer | undefined;
  recommendation: string;
  readOnly: boolean;
}) {
  const [state, act, working] = useActionState<FisaState, FormData>(
    answerAction,
    {},
  );

  return (
    <form
      action={act}
      className="grid gap-2 border-b border-[var(--border)] pb-2 sm:grid-cols-[3rem_1fr_auto]"
    >
      <input type="hidden" name="instrumentId" value={instrumentId} />
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="itemCode" value={code} />

      <span className="font-mono text-xs text-[var(--muted)]">{code}</span>

      <div>
        <p className="text-sm">{text}</p>
        {answer === "no" || recommendation ? (
          <input
            name="recommendation"
            defaultValue={recommendation}
            disabled={readOnly}
            placeholder="Recommendation"
            className={`${field} mt-1.5`}
          />
        ) : (
          <input type="hidden" name="recommendation" value="" />
        )}
      </div>

      <div className="flex items-start gap-1">
        {(allowsNa
          ? (["yes", "no", "na"] as const)
          : (["yes", "no"] as const)
        ).map((value) => (
          <button
            key={value}
            type="submit"
            name="answer"
            value={value}
            disabled={readOnly || working}
            className="rounded-md border px-2.5 py-1 text-xs disabled:opacity-60"
            style={
              answer === value
                ? {
                    background: "var(--brand-primary)",
                    color: "white",
                    borderColor: "var(--brand-primary)",
                  }
                : { borderColor: "var(--border)" }
            }
          >
            {value === "na" ? "n/a" : value}
          </button>
        ))}
      </div>

      {state.error ? (
        <p className="text-xs text-[var(--danger)] sm:col-span-3">{state.error}</p>
      ) : null}
    </form>
  );
}

/** Section 2: one exit level outcome, and where the paper assesses it. */
export function CoverageForm({
  instrumentId,
  role,
  outcome,
  existing,
  readOnly,
}: {
  instrumentId: string;
  role: "examiner" | "moderator";
  outcome: { id: string; number: string; description: string | null };
  existing: {
    requiredStandard: string | null;
    competenceLevel: string | null;
    questionReference: string | null;
    comment: string | null;
    standardAchieved: boolean | null;
  } | null;
  readOnly: boolean;
}) {
  const [state, act, working] = useActionState<FisaState, FormData>(
    coverageAction,
    {},
  );

  return (
    <form
      action={act}
      className="space-y-2 border-b border-[var(--border)] py-3"
    >
      <input type="hidden" name="instrumentId" value={instrumentId} />
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="exitLevelOutcomeId" value={outcome.id} />

      <p className="text-sm font-medium">
        {outcome.number}
        {outcome.description ? (
          <span className="font-normal text-[var(--muted)]">
            {" "}
            · {outcome.description}
          </span>
        ) : null}
      </p>

      <div className="grid gap-2 sm:grid-cols-4">
        <input
          name="requiredStandard"
          defaultValue={existing?.requiredStandard ?? ""}
          disabled={readOnly}
          placeholder="Required standard"
          className={`${field} sm:col-span-2`}
        />
        <input
          name="competenceLevel"
          defaultValue={existing?.competenceLevel ?? ""}
          disabled={readOnly}
          placeholder="H, M, L"
          className={field}
        />
        <input
          name="questionReference"
          defaultValue={existing?.questionReference ?? ""}
          disabled={readOnly}
          placeholder="Question no."
          className={field}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input
          name="comment"
          defaultValue={existing?.comment ?? ""}
          disabled={readOnly}
          placeholder="Comment on the standard achieved"
          className={field}
        />
        {role === "moderator" ? (
          <select
            name="standardAchieved"
            defaultValue={
              existing?.standardAchieved === null ||
              existing?.standardAchieved === undefined
                ? ""
                : existing.standardAchieved
                  ? "yes"
                  : "no"
            }
            disabled={readOnly}
            className={field}
          >
            <option value="">Achieved?</option>
            <option value="yes">Achieved</option>
            <option value="no">Not achieved</option>
          </select>
        ) : (
          <input type="hidden" name="standardAchieved" value="" />
        )}
        <button
          type="submit"
          disabled={readOnly || working}
          className="rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
        >
          {working ? "Saving…" : "Save"}
        </button>
      </div>

      <Message state={state} />
    </form>
  );
}

/** The examiner hands over. */
export function SendToModerationForm({
  instrumentId,
}: {
  instrumentId: string;
}) {
  const [state, act, working] = useActionState<FisaState, FormData>(
    sendToModerationAction,
    {},
  );

  return (
    <form action={act}>
      <input type="hidden" name="instrumentId" value={instrumentId} />
      <button
        type="submit"
        disabled={working}
        className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--brand-primary)" }}
      >
        {working ? "Sending…" : "Send to the moderator"}
      </button>
      <Message state={state} />
    </form>
  );
}

/** The moderator signs it off, which is the gate. */
export function SignOffForm({ instrumentId }: { instrumentId: string }) {
  const [state, act, working] = useActionState<FisaState, FormData>(
    signOffAction,
    {},
  );

  return (
    <form action={act} className="space-y-3">
      <input type="hidden" name="instrumentId" value={instrumentId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Overall quality</span>
          <select name="qualityRating" className={field} defaultValue="good">
            {QUALITY_RATINGS.map((rating) => (
              <option key={rating.code} value={rating.code}>
                {rating.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Motivate</span>
          <input name="qualityMotivation" className={field} />
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">
          Further comments for the improvement of assessment standards
        </span>
        <textarea name="comments" rows={3} className={field} />
      </label>

      <button
        type="submit"
        disabled={working}
        className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--brand-primary)" }}
      >
        {working ? "Signing off…" : "Sign off as fit for purpose"}
      </button>
      <p className="text-xs text-[var(--muted)]">
        No candidate may sit this paper until you do.
      </p>

      <Message state={state} />
    </form>
  );
}

/** A new version of a paper that has already been signed off. */
export function NewVersionForm({ instrumentId }: { instrumentId: string }) {
  const [state, act, working] = useActionState<FisaState, FormData>(
    newVersionAction,
    {},
  );

  return (
    <form action={act}>
      <input type="hidden" name="instrumentId" value={instrumentId} />
      <button
        type="submit"
        disabled={working}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {working ? "Opening…" : "Open a new version"}
      </button>
      <Message state={state} />
    </form>
  );
}
