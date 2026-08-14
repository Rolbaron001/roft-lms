"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  createAgreementAction,
  openLogbookAction,
  type WorkplaceState,
} from "../actions";

const FIELD =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

type Person = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string | null;
};

type Module = {
  id: string;
  code: string;
  title: string;
  qualificationTitle: string;
  elementCount: number;
};

type Agreement = {
  id: string;
  learnerFirst: string;
  learnerLast: string;
  employerName: string;
  coachName: string;
  moduleIdsOpen: string[];
};

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? busy : label}
    </button>
  );
}

function Result({ state }: { state: WorkplaceState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
      >
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p
        className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm"
        style={{ color: "var(--success)" }}
      >
        {state.message}
      </p>
    );
  }
  return null;
}

export function AgreementForm({
  learners,
  coaches,
}: {
  learners: Person[];
  coaches: Person[];
}) {
  const [state, formAction] = useActionState<WorkplaceState, FormData>(
    createAgreementAction,
    {},
  );

  if (coaches.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Nobody holds the Workplace Coach role yet. Add the learner&rsquo;s
        supervisor through <strong>People</strong> first — they work for the
        employer, not for you, and they will only ever see the learners named on
        their own agreements.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <Result state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="learnerId" className="block text-sm font-medium">
            Learner
          </label>
          <select id="learnerId" name="learnerId" required className={FIELD}>
            <option value="">Choose a learner</option>
            {learners.map((person) => (
              <option key={person.id} value={person.id}>
                {person.firstName} {person.lastName} — {person.email}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="coachId" className="block text-sm font-medium">
            Workplace coach
          </label>
          <select id="coachId" name="coachId" required className={FIELD}>
            <option value="">Choose a coach</option>
            {coaches.map((person) => (
              <option key={person.id} value={person.id}>
                {person.firstName} {person.lastName} — {person.email}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--muted)]">
            The learner cannot be their own coach; the database refuses it.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="employerName" className="block text-sm font-medium">
            Employer
          </label>
          <input
            id="employerName"
            name="employerName"
            type="text"
            required
            className={FIELD}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="coachDesignation"
            className="block text-sm font-medium"
          >
            Coach&rsquo;s designation
          </label>
          <input
            id="coachDesignation"
            name="coachDesignation"
            type="text"
            placeholder="HR Manager"
            className={FIELD}
          />
          <p className="text-xs text-[var(--muted)]">
            Recorded on the agreement as it stands today, so the sign-off keeps
            saying who signed and in what capacity.
          </p>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <label
            htmlFor="employerAddress"
            className="block text-sm font-medium"
          >
            Employer address
          </label>
          <input
            id="employerAddress"
            name="employerAddress"
            type="text"
            className={FIELD}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="startDate" className="block text-sm font-medium">
            Starts
          </label>
          <input id="startDate" name="startDate" type="date" className={FIELD} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="endDate" className="block text-sm font-medium">
            Ends
          </label>
          <input id="endDate" name="endDate" type="date" className={FIELD} />
        </div>
      </div>

      <Submit label="Create agreement" busy="Creating…" />
    </form>
  );
}

export function LogbookForm({
  agreements,
  modules,
}: {
  agreements: Agreement[];
  modules: Module[];
}) {
  const [state, formAction] = useActionState<WorkplaceState, FormData>(
    openLogbookAction,
    {},
  );
  const [agreementId, setAgreementId] = useState("");

  const chosen = agreements.find((agreement) => agreement.id === agreementId);

  if (agreements.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        No workplace agreements yet. Create one above first — a logbook records
        work done at a named employer under a named coach, so it cannot exist
        without one.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <Result state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="agreementId" className="block text-sm font-medium">
            Agreement
          </label>
          <select
            id="agreementId"
            name="agreementId"
            required
            className={FIELD}
            value={agreementId}
            onChange={(event) => setAgreementId(event.target.value)}
          >
            <option value="">Choose an agreement</option>
            {agreements.map((agreement) => (
              <option key={agreement.id} value={agreement.id}>
                {agreement.learnerFirst} {agreement.learnerLast} at{" "}
                {agreement.employerName} (coach: {agreement.coachName})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="curriculumModuleId"
            className="block text-sm font-medium"
          >
            Work experience module
          </label>
          <select
            id="curriculumModuleId"
            name="curriculumModuleId"
            required
            className={FIELD}
          >
            <option value="">Choose a module</option>
            {modules.map((entry) => {
              // A module with no work activities would produce a logbook that
              // attests to nothing, and one already open would be a duplicate.
              // Both are disabled here rather than refused after submitting.
              const alreadyOpen = chosen?.moduleIdsOpen.includes(entry.id);
              const empty = entry.elementCount === 0;
              return (
                <option
                  key={entry.id}
                  value={entry.id}
                  disabled={empty || alreadyOpen}
                >
                  {entry.code} — {entry.title}
                  {empty
                    ? " (curriculum not transcribed)"
                    : alreadyOpen
                      ? " (already open)"
                      : ` (${entry.elementCount} requirements)`}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      <p className="text-xs text-[var(--muted)]">
        The logbook is generated from the curriculum&rsquo;s own work
        activities, workplace knowledge and supporting evidence, so it cannot
        omit a requirement.
      </p>

      <Submit label="Open logbook" busy="Opening…" />
    </form>
  );
}
