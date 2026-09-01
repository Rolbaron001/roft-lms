/**
 * Who may do what.
 *
 * Roles are named in the design document; permissions are named after the
 * action they allow. Code asks `can(session, "course:publish")` rather than
 * `session.roles.includes("instructor")`, so that changing which roles may
 * publish a course is a change to this file and nowhere else.
 *
 * Two rules are deliberately absent here because they are enforced in the
 * database instead: a moderator may not moderate their own decision, and no
 * role may amend the audit log. Permissions describe intent; the database
 * enforces the rules that must hold even if this file is wrong.
 */

import type { userRole } from "@/db/schema";

export type Role = (typeof userRole.enumValues)[number];

export const PERMISSIONS = [
  // Platform, across all tenants. Reserved for ROFT.
  "platform:manage_tenants",
  "platform:view_health",

  // This tenant's own configuration.
  "tenant:manage_settings",
  "tenant:manage_branding",

  // People.
  "user:read",
  "user:invite",
  "user:manage_roles",
  "user:anonymise",

  // Content.
  "course:read",
  "course:author",
  "course:publish",
  "qualification:manage",
  "competency:manage",

  // Enrolment.
  "enrolment:read_all",
  "enrolment:read_team",
  "enrolment:read_own",
  "enrolment:manage",

  // Delivery: the dated occasions a cohort meets, and who was there.
  //
  // Scheduling and taking a register are separated because they are done by
  // different people at different times. A coordinator lays out the term; the
  // facilitator standing in front of the cohort marks who came. Giving the
  // facilitator the power to reschedule as a side effect of marking a register
  // would be a permission granted by accident.
  "session:manage",
  "attendance:record",

  // Assessment.
  "assessment:author",
  "assessment:take",
  "assessment:assess",
  "assessment:moderate",
  "evidence:read_all",
  "evidence:read_own",
  "evidence:submit",

  // Work Integrated Learning.
  //
  // A work experience module is signed off by the learner's Workplace
  // Coach — somebody employed by the host employer, not by the provider — and
  // the curriculum requires it: "the supervisor must provide coaching and must
  // sign the logbook". Without a role for that person the sign-off has to be
  // faked by a member of staff, which is the one thing an external verifier
  // checks.
  "workplace:manage",
  "workplace:log",
  "workplace:sign",

  // Certification.
  "certificate:issue",
  "certificate:read_all",
  "certificate:read_own",

  // Oversight.
  "report:tenant",
  "report:team",
  "report:own",
  "report:statutory",
  "audit:read",
  "verification:external_audit",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Every learner-facing permission that any signed-in person holds, because
 * every role belongs to someone who may also be assigned training.
 */
const SELF_SERVICE: Permission[] = [
  "course:read",
  "assessment:take",
  "workplace:log",
  "enrolment:read_own",
  "evidence:read_own",
  "evidence:submit",
  "certificate:read_own",
  "report:own",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  /**
   * ROFT. Manages tenants and sees platform health, but deliberately holds no
   * permission over a tenant's content or learner data. Section 3 of the
   * design document is explicit that the Platform Owner does not get to read
   * a client's records simply by virtue of hosting them.
   */
  platform_owner: ["platform:manage_tenants", "platform:view_health"],

  tenant_admin: [
    "tenant:manage_settings",
    "tenant:manage_branding",
    "user:read",
    "user:invite",
    "user:manage_roles",
    "user:anonymise",
    "course:read",
    "course:author",
    "course:publish",
    "qualification:manage",
    "competency:manage",
    "enrolment:read_all",
    "enrolment:manage",
    "session:manage",
    "attendance:record",
    "assessment:author",
    "evidence:read_all",
    "certificate:issue",
    "certificate:read_all",
    "report:tenant",
    "report:statutory",
    "audit:read",
    "workplace:manage",
    ...SELF_SERVICE,
  ],

  /**
   * The learner's supervisor at the host employer. Deliberately the narrowest
   * role on the platform: they sign work experience logbooks for the learners
   * they have an agreement with, and can do nothing else. They are not the
   * provider's staff, and giving them a view of other learners would put one
   * employer's people in front of another's.
   *
   * Which learners they can see is decided by the workplace agreement, not by
   * this list — a permission cannot express "only mine".
   */
  workplace_coach: ["workplace:sign"],

  instructor: [
    "user:read",
    "course:read",
    "course:author",
    "course:publish",
    "competency:manage",
    "enrolment:read_all",
    "enrolment:manage",
    "session:manage",
    "attendance:record",
    "assessment:author",
    "report:tenant",
    ...SELF_SERVICE,
  ],

  /**
   * Marks evidence and records a competent / not-yet-competent judgement.
   * Reads evidence in order to do so; cannot author the assessment they mark,
   * and cannot issue the certificate that follows from it.
   */
  assessor: [
    "user:read",
    "course:read",
    "enrolment:read_all",
    "assessment:assess",
    "evidence:read_all",
    "report:team",
    ...SELF_SERVICE,
  ],

  /**
   * Independently reviews an assessor's decisions. Holds no authoring or
   * assessing permission at all: the separation is the point of the role.
   */
  moderator: [
    "user:read",
    "course:read",
    "enrolment:read_all",
    "assessment:moderate",
    "evidence:read_all",
    "audit:read",
    "report:tenant",
    ...SELF_SERVICE,
  ],

  line_manager: [
    "enrolment:read_team",
    "report:team",
    "course:read",
    ...SELF_SERVICE,
  ],

  learner: [...SELF_SERVICE],

  /**
   * Drives Workplace Skills Plan and Annual Training Report returns. Needs
   * workforce-wide training data and the statutory reports, but no authority
   * over content or assessment outcomes.
   */
  skills_development_facilitator: [
    "user:read",
    "course:read",
    "enrolment:read_all",
    "enrolment:manage",
    "session:manage",
    "attendance:record",
    "report:tenant",
    "report:statutory",
    "certificate:read_all",
    ...SELF_SERVICE,
  ],

  /**
   * A SETA, AQP or QCTO auditor. Read-only by construction: this role holds
   * no permission whose name implies a write.
   */
  external_verifier: [
    "course:read",
    "enrolment:read_all",
    "evidence:read_all",
    "certificate:read_all",
    "audit:read",
    "report:tenant",
    "verification:external_audit",
  ],
};

export type PermissionSubject = {
  roles: Role[];
};

/** True when any of the subject's roles grants the permission. */
export function can(subject: PermissionSubject, permission: Permission): boolean {
  return subject.roles.some((role) =>
    ROLE_PERMISSIONS[role]?.includes(permission),
  );
}

export function canAny(
  subject: PermissionSubject,
  permissions: Permission[],
): boolean {
  return permissions.some((permission) => can(subject, permission));
}

export function canAll(
  subject: PermissionSubject,
  permissions: Permission[],
): boolean {
  return permissions.every((permission) => can(subject, permission));
}

/** Every permission the subject holds, deduplicated. */
export function permissionsFor(subject: PermissionSubject): Permission[] {
  const granted = new Set<Permission>();
  for (const role of subject.roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) {
      granted.add(permission);
    }
  }
  return [...granted];
}

/** Thrown when an action is attempted without the permission it requires. */
export class PermissionDeniedError extends Error {
  constructor(public readonly permission: Permission) {
    super(`Permission denied: ${permission}`);
    this.name = "PermissionDeniedError";
  }
}

export function assertCan(
  subject: PermissionSubject,
  permission: Permission,
): void {
  if (!can(subject, permission)) {
    throw new PermissionDeniedError(permission);
  }
}
