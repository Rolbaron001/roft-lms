"use client";

import { useActionState, useState } from "react";
import {
  ALTERNATE_ID_TYPES,
  CITIZEN_RESIDENT_CODES,
  DISABILITY_RATING_CODES,
  HOME_LANGUAGE_CODES,
  IMMIGRANT_STATUS_CODES,
  PROVINCE_CODES,
  SOCIOECONOMIC_CODES,
  ratingRequiredFor,
  type CodeOption,
} from "@/lib/learner-codes";
import { saveEnrolmentFormAction, type FormState } from "./actions";

const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

export type FormProfile = {
  title: string | null;
  middleName: string | null;
  alternateId: string | null;
  alternateIdType: string | null;
  homeLanguageCode: string | null;
  citizenResidentStatusCode: string | null;
  socioeconomicStatusCode: string | null;
  disabilityRating: string | null;
  immigrantStatus: string | null;
  homeAddress1: string | null;
  homeAddress2: string | null;
  homeAddress3: string | null;
  homeAddressPostalCode: string | null;
  postalAddress1: string | null;
  postalAddress2: string | null;
  postalAddress3: string | null;
  postalAddressPostalCode: string | null;
  phoneNumber: string | null;
  cellPhoneNumber: string | null;
  faxNumber: string | null;
  provinceCode: string | null;
  statssaAreaCode: string | null;
  flc: string | null;
  flcStatementNumber: string | null;
  employerName: string | null;
  confirmedAt: Date | null;
};

function Field({
  label,
  name,
  value,
  hint,
  type = "text",
}: {
  label: string;
  name: string;
  value: string | null;
  hint?: string;
  type?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={value ?? ""}
        className={inputClass}
      />
      {hint ? (
        <span className="block text-xs text-[var(--muted)]">{hint}</span>
      ) : null}
    </label>
  );
}

function Choice({
  label,
  name,
  value,
  options,
  hint,
  onChange,
}: {
  label: string;
  name: string;
  value: string | null;
  options: CodeOption[];
  hint?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium">{label}</span>
      <select
        name={name}
        defaultValue={value ?? ""}
        onChange={(event) => onChange?.(event.target.value)}
        className={inputClass}
      >
        <option value="">Not answered yet</option>
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <span className="block text-xs text-[var(--muted)]">{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * The learner's own enrolment form.
 *
 * Written in a learner's words rather than the QCTO's. The return calls this
 * `HomeLanguageCode`; the person filling it in is being asked what language
 * they speak at home, and gets a list of languages rather than a list of codes.
 * The code is what is submitted and is never shown.
 *
 * What the platform already knows is shown but not asked again - name, identity
 * number, date of birth, the programme, the induction date. A form that asks
 * somebody their own name is a form they stop trusting, and every one of those
 * is already on the record and inherited from the cohort.
 */
export function EnrolmentForm({
  learnerId,
  profile,
  disabilityCode,
  popiaAgreedAt,
  readOnlyReason,
}: {
  learnerId: string;
  profile: FormProfile;
  disabilityCode: string | null;
  popiaAgreedAt: Date | null;
  readOnlyReason: string | null;
}) {
  const [state, save, saving] = useActionState<FormState, FormData>(
    saveEnrolmentFormAction,
    {},
  );

  // Kept in state because the rating below appears only when a difficulty is
  // recorded. Asking everybody how much difficulty they have with a disability
  // they do not have is the sort of question that makes a form feel careless.
  const [disability] = useState(disabilityCode ?? "");
  const needsRating = ratingRequiredFor(disability);

  return (
    <form action={save} className="space-y-8">
      <input type="hidden" name="learnerId" value={learnerId} />

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          About you
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" name="title" value={profile.title} hint="Mr, Ms, Dr, and so on." />
          <Field
            label="Middle name"
            name="middleName"
            value={profile.middleName}
            hint="If you have one. Leave it blank if not."
          />
          <Choice
            label="Language you speak at home"
            name="homeLanguageCode"
            value={profile.homeLanguageCode}
            options={HOME_LANGUAGE_CODES}
          />
          <Choice
            label="Citizenship or residence"
            name="citizenResidentStatusCode"
            value={profile.citizenResidentStatusCode}
            options={CITIZEN_RESIDENT_CODES}
          />
          <Choice
            label="Are you working at the moment?"
            name="socioeconomicStatusCode"
            value={profile.socioeconomicStatusCode}
            options={SOCIOECONOMIC_CODES}
          />
          <Choice
            label="Immigrant status"
            name="immigrantStatus"
            value={profile.immigrantStatus}
            options={IMMIGRANT_STATUS_CODES}
          />
        </div>

        {needsRating ? (
          <Choice
            label="How much difficulty does it cause?"
            name="disabilityRating"
            value={profile.disabilityRating}
            options={DISABILITY_RATING_CODES}
            hint="Asked because a disability is recorded against your name. The QCTO requires it alongside."
          />
        ) : null}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          If you do not have a South African identity number
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Choice
            label="What you are enrolled on instead"
            name="alternateIdType"
            value={profile.alternateIdType}
            options={ALTERNATE_ID_TYPES}
          />
          <Field
            label="Its number"
            name="alternateId"
            value={profile.alternateId}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Where you live
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Address line 1" name="homeAddress1" value={profile.homeAddress1} />
          <Field label="Address line 2" name="homeAddress2" value={profile.homeAddress2} />
          <Field label="Address line 3" name="homeAddress3" value={profile.homeAddress3} />
          <Field
            label="Postal code"
            name="homeAddressPostalCode"
            value={profile.homeAddressPostalCode}
          />
        </div>

        <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Where post reaches you, if it is somewhere else
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Postal line 1" name="postalAddress1" value={profile.postalAddress1} />
          <Field label="Postal line 2" name="postalAddress2" value={profile.postalAddress2} />
          <Field label="Postal line 3" name="postalAddress3" value={profile.postalAddress3} />
          <Field
            label="Postal code"
            name="postalAddressPostalCode"
            value={profile.postalAddressPostalCode}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          How to reach you
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Cell phone"
            name="cellPhoneNumber"
            value={profile.cellPhoneNumber}
            type="tel"
          />
          <Field
            label="Other phone"
            name="phoneNumber"
            value={profile.phoneNumber}
            type="tel"
          />
          <Field label="Fax" name="faxNumber" value={profile.faxNumber} hint="If you have one." />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Where you work
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Employer" name="employerName" value={profile.employerName} />
          <Choice
            label="Province you work in"
            name="provinceCode"
            value={profile.provinceCode}
            options={PROVINCE_CODES}
            hint="Where you work, which is not always where you live."
          />
          <Field
            label="STATSSA area code"
            name="statssaAreaCode"
            value={profile.statssaAreaCode}
            hint="Your coordinator can look this one up if you do not know it."
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Foundational Learning Competence
        </h2>
        <p className="text-sm text-[var(--muted)]">
          Only needed on a qualification at NQF level 3 or 4. Leave it blank if
          nobody has asked you for it.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="FLC" name="flc" value={profile.flc} />
          <Field
            label="FLC statement number"
            name="flcStatementNumber"
            value={profile.flcStatementNumber}
          />
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-sm font-semibold">Your permission</h2>
        {popiaAgreedAt ? (
          <p className="text-sm text-[var(--muted)]">
            You agreed on{" "}
            {popiaAgreedAt.toLocaleDateString("en-ZA", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            . That date is part of the record and does not change if you edit
            this form.
          </p>
        ) : (
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" name="popiaAgreed" className="mt-1" />
            <span className="text-sm">
              I agree that these details may be held and submitted to the
              Quality Council for Trades and Occupations for my enrolment, as
              the Protection of Personal Information Act requires.
              <span className="mt-1 block text-xs text-[var(--muted)]">
                The date you agree is recorded, because the return asks for
                both.
              </span>
            </span>
          </label>
        )}
      </section>

      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm text-[var(--success)]">
          {state.notice}
        </p>
      ) : null}

      {readOnlyReason ? (
        <p className="text-sm text-[var(--muted)]">{readOnlyReason}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            name="intent"
            value="confirm"
            disabled={saving}
            className="rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--brand-primary)" }}
          >
            {saving ? "Saving…" : "Save and confirm these are right"}
          </button>
          <button
            type="submit"
            name="intent"
            value="save"
            disabled={saving}
            className="rounded-md border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-60"
          >
            Save and finish later
          </button>
        </div>
      )}
    </form>
  );
}
