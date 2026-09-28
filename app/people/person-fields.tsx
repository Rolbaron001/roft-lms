"use client";

import { useT } from "@/components/i18n";
import { maybe } from "@/lib/i18n/maybe";

/**
 * The fields describing a person, shared by the add and edit forms so the two
 * cannot drift apart.
 */

export const inputClass =
  "w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

export type PersonDefaults = {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  jobTitle?: string | null;
  team?: string | null;
  site?: string | null;
  lineManagerId?: string | null;
  ofoCode?: string | null;
  nationalId?: string | null;
  gender?: string | null;
  equityCode?: string | null;
  disabilityCode?: string | null;
  nationality?: string | null;
};

function Field({
  label,
  name,
  defaultValue,
  hint,
  ...props
}: {
  label: string;
  name: string;
  /** Null is normal here: an unset column comes back as null, not "". */
  defaultValue?: string | null;
  hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "defaultValue">) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium">{label}</span>
      <input name={name} defaultValue={defaultValue ?? ""} className={inputClass} {...props} />
      {hint ? <span className="block text-xs text-[var(--muted)]">{hint}</span> : null}
    </label>
  );
}

export function PersonFields({
  defaults = {},
  managers,
}: {
  defaults?: PersonDefaults;
  managers: { id: string; label: string }[];
}) {
  const t = useT();
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("person.firstName")} name="firstName" defaultValue={defaults.firstName} required />
        <Field label={t("person.lastName")} name="lastName" defaultValue={defaults.lastName} required />
        <Field label={t("person.email")} name="email" type="email" defaultValue={defaults.email} required />
        <Field label={t("person.jobTitle")} name="jobTitle" defaultValue={defaults.jobTitle} />
        <Field label={t("person.team")} name="team" defaultValue={defaults.team} />
        <Field label={t("person.site")} name="site" defaultValue={defaults.site} />

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">{t("person.lineManager")}</span>
          <select name="lineManagerId" defaultValue={defaults.lineManagerId ?? ""} className={inputClass}>
            <option value="">{t("person.nobody")}</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.label}
              </option>
            ))}
          </select>
          <span className="block text-xs text-[var(--muted)]">{t("person.lineManagerNote")}</span>
        </label>

        <Field label={t("person.ofo")} name="ofoCode" defaultValue={defaults.ofoCode} hint={t("person.ofoNote")} />
      </div>

      <fieldset className="mt-6 space-y-3 rounded-md border border-[var(--border)] p-4">
        <legend className="px-1 text-sm font-medium">{t("person.statutory")}</legend>
        <p className="text-xs text-[var(--muted)]">{t("person.statutoryNote")}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("person.idNumber")} name="nationalId" defaultValue={defaults.nationalId} inputMode="numeric" />
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("person.gender")}</span>
            <select name="gender" defaultValue={defaults.gender ?? ""} className={inputClass}>
              <option value="">{t("person.notRecorded")}</option>
              <option value="female">{t("person.female")}</option>
              <option value="male">{t("person.male")}</option>
              <option value="other">{t("person.other")}</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("person.equity")}</span>
            <select name="equityCode" defaultValue={defaults.equityCode ?? ""} className={inputClass}>
              <option value="">{t("person.notRecorded")}</option>
              {(["AF", "CO", "IN", "WH", "OT"] as const).map((code) => (
                <option key={code} value={code}>
                  {t(`person.equity.${code}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("person.disability")}</span>
            <select name="disabilityCode" defaultValue={defaults.disabilityCode ?? ""} className={inputClass}>
              <option value="">{t("person.notRecorded")}</option>
              <option value="N">{t("person.none")}</option>
              <option value="Y">{t("person.disabilityRecorded")}</option>
            </select>
          </label>

          <Field label={t("person.nationality")} name="nationality" defaultValue={defaults.nationality} />
        </div>
      </fieldset>
    </>
  );
}

const ROLES = [
  "tenant_admin",
  "instructor",
  "assessor",
  "moderator",
  "line_manager",
  "learner",
  "skills_development_facilitator",
  "external_verifier",
  "workplace_coach",
] as const;

export function RoleChecklist({
  selected = [],
  registrationNumbers = {},
}: {
  selected?: string[];
  registrationNumbers?: Record<string, string | null>;
}) {
  const t = useT();
  return (
    <fieldset className="space-y-2 rounded-md border border-[var(--border)] p-4">
      <legend className="px-1 text-sm font-medium">{t("person.roles")}</legend>

      {ROLES.map((role) => {
        const label = t(`role.${role}`);
        const note = maybe(t, `person.roleNote.${role}`);
        return (
          <div key={role}>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="roles"
                value={role}
                defaultChecked={selected.includes(role)}
                className="mt-1"
              />
              <span>
                {label}
                {note ? <span className="block text-xs text-[var(--muted)]">{note}</span> : null}
              </span>
            </label>

            {role === "assessor" || role === "moderator" ? (
              <input
                name={`registration:${role}`}
                defaultValue={registrationNumbers[role] ?? ""}
                placeholder={t("person.registration", { role: label })}
                className={`${inputClass} mt-1.5 ml-6 w-[calc(100%-1.5rem)] text-xs`}
              />
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}
