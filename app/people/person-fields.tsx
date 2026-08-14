"use client";

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
      <input
        name={name}
        defaultValue={defaultValue ?? ""}
        className={inputClass}
        {...props}
      />
      {hint ? (
        <span className="block text-xs text-[var(--muted)]">{hint}</span>
      ) : null}
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
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="First name"
          name="firstName"
          defaultValue={defaults.firstName}
          required
        />
        <Field
          label="Last name"
          name="lastName"
          defaultValue={defaults.lastName}
          required
        />
        <Field
          label="Email address"
          name="email"
          type="email"
          defaultValue={defaults.email}
          required
        />
        <Field
          label="Job title"
          name="jobTitle"
          defaultValue={defaults.jobTitle}
        />
        <Field label="Team" name="team" defaultValue={defaults.team} />
        <Field label="Site" name="site" defaultValue={defaults.site} />

        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Line manager</span>
          <select
            name="lineManagerId"
            defaultValue={defaults.lineManagerId ?? ""}
            className={inputClass}
          >
            <option value="">Nobody</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.label}
              </option>
            ))}
          </select>
          <span className="block text-xs text-[var(--muted)]">
            Decides whose training this person can see in reports.
          </span>
        </label>

        <Field
          label="OFO code"
          name="ofoCode"
          defaultValue={defaults.ofoCode}
          hint="Occupation code used to group a SETA return."
        />
      </div>

      <fieldset className="mt-6 space-y-3 rounded-md border border-[var(--border)] p-4">
        <legend className="px-1 text-sm font-medium">
          Statutory details
        </legend>
        <p className="text-xs text-[var(--muted)]">
          Needed for a SAQA or SETA return. The identity number is checked
          against its check digit as you save, so a typing error is caught here
          rather than by the regulator.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Identity number"
            name="nationalId"
            defaultValue={defaults.nationalId}
            inputMode="numeric"
          />
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Gender</span>
            <select
              name="gender"
              defaultValue={defaults.gender ?? ""}
              className={inputClass}
            >
              <option value="">Not recorded</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Equity code</span>
            <select
              name="equityCode"
              defaultValue={defaults.equityCode ?? ""}
              className={inputClass}
            >
              <option value="">Not recorded</option>
              <option value="AF">African</option>
              <option value="CO">Coloured</option>
              <option value="IN">Indian</option>
              <option value="WH">White</option>
              <option value="OT">Other</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Disability</span>
            <select
              name="disabilityCode"
              defaultValue={defaults.disabilityCode ?? ""}
              className={inputClass}
            >
              <option value="">Not recorded</option>
              <option value="N">None</option>
              <option value="Y">Disability recorded</option>
            </select>
          </label>

          <Field
            label="Nationality"
            name="nationality"
            defaultValue={defaults.nationality}
          />
        </div>
      </fieldset>
    </>
  );
}

const ROLES: { value: string; label: string; note?: string }[] = [
  { value: "tenant_admin", label: "Administrator" },
  { value: "instructor", label: "Instructor" },
  { value: "assessor", label: "Assessor", note: "Needs a registration number" },
  { value: "moderator", label: "Moderator", note: "Cannot moderate own decisions" },
  { value: "line_manager", label: "Line Manager" },
  { value: "learner", label: "Learner" },
  {
    value: "skills_development_facilitator",
    label: "Skills Development Facilitator",
  },
  { value: "external_verifier", label: "External Verifier", note: "Read-only" },
  {
    value: "workplace_coach",
    label: "Workplace Coach",
    note: "The employer's supervisor — sees only their own learners",
  },
];

export function RoleChecklist({
  selected = [],
  registrationNumbers = {},
}: {
  selected?: string[];
  registrationNumbers?: Record<string, string | null>;
}) {
  return (
    <fieldset className="space-y-2 rounded-md border border-[var(--border)] p-4">
      <legend className="px-1 text-sm font-medium">Roles</legend>

      {ROLES.map((role) => (
        <div key={role.value}>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="roles"
              value={role.value}
              defaultChecked={selected.includes(role.value)}
              className="mt-1"
            />
            <span>
              {role.label}
              {role.note ? (
                <span className="block text-xs text-[var(--muted)]">
                  {role.note}
                </span>
              ) : null}
            </span>
          </label>

          {role.value === "assessor" || role.value === "moderator" ? (
            <input
              name={`registration:${role.value}`}
              defaultValue={registrationNumbers[role.value] ?? ""}
              placeholder={`${role.label} registration number`}
              className={`${inputClass} mt-1.5 ml-6 w-[calc(100%-1.5rem)] text-xs`}
            />
          ) : null}
        </div>
      ))}
    </fieldset>
  );
}
