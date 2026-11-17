/**
 * The introduction each person sees on Home: who they are on the platform,
 * and what they can do there (Heidi, 13 November 2026; job sheet D50).
 *
 * Heidi: "On login, each role player must see only what the role allows them
 * to do", and "the first thing the role player sees upon login must be an
 * introduction and a summary of what they can do." The welcome wording for
 * the roles she named is hers (Design/Curious Callum Role Specs & Intros.docx);
 * the rest follows it. Every item is a link to where the thing is done, and
 * an item shows only to someone who may open that page.
 *
 * This module imports only types, so a page can use it as it is.
 */
import type { Permission, Role } from "./rbac";
import { FACILITATOR_ASSESSOR } from "./roles";

export type IntroKey =
  | "facilitatorAssessor"
  | "facilitator"
  | "assessor"
  | "moderator"
  | "sdf"
  | "coach"
  | "verifier"
  | "admin"
  | "viewer"
  | "learner"
  | "manager"
  | "platform";

/** What a person can do, as a link. Phrase key `intro.item.<key>`. */
export type IntroItem = { key: string; href: string; anyPermission: Permission[] };

const item = (key: string, href: string, ...anyPermission: Permission[]): IntroItem => ({ key, href, anyPermission });

const FACILITATOR_ITEMS = [
  item("cohorts", "/cohorts", "enrolment:read_all"),
  item("classes", "/cohorts", "attendance:record"),
  item("discussions", "/discussions", "course:read"),
  item("material", "/material", "course:author"),
];

const ASSESSOR_ITEMS = [
  item("assess", "/assess", "assessment:assess"),
  item("heldForReview", "/reassessments", "enrolment:read_all"),
];

export const INTRO_ITEMS: Record<IntroKey, IntroItem[]> = {
  facilitatorAssessor: [...FACILITATOR_ITEMS, ...ASSESSOR_ITEMS],
  facilitator: FACILITATOR_ITEMS,
  assessor: ASSESSOR_ITEMS,
  moderator: [
    item("moderate", "/moderate", "assessment:moderate"),
    item("appeals", "/appeals", "appeal:manage"),
    item("fisa", "/fisa", "assessment:moderate"),
    item("priorLearning", "/recognition", "assessment:moderate"),
  ],
  sdf: [
    item("statutory", "/statutory", "report:statutory"),
    item("leisa", "/statutory/notify", "report:statutory"),
    item("reports", "/reports", "report:tenant"),
    item("enrol", "/cohorts", "enrolment:manage"),
  ],
  coach: [item("logbooks", "/workplace", "workplace:sign")],
  verifier: [
    item("readiness", "/readiness", "enrolment:read_all"),
    item("qualifications", "/qualifications", "course:read"),
    item("records", "/records", "records:read"),
  ],
  admin: [
    item("dashboard", "/", "report:own"),
    item("people", "/people", "user:invite"),
    item("buildQualifications", "/qualifications", "qualification:manage"),
    item("runCohorts", "/cohorts", "enrolment:manage"),
    item("settings", "/settings", "tenant:manage_settings"),
  ],
  viewer: [
    item("dashboard", "/", "report:own"),
    item("people", "/people", "user:invite"),
    item("seeCohorts", "/cohorts", "enrolment:read_all"),
  ],
  learner: [
    item("toDo", "/", "report:own"),
    item("discussions", "/discussions", "course:read"),
    item("badges", "/badges", "course:read"),
    item("myAppeals", "/my-appeals", "appeal:lodge"),
  ],
  manager: [item("teamReports", "/reports", "report:team")],
  platform: [item("clients", "/platform", "platform:manage_tenants")],
};

const BY_ROLE: Record<Role, IntroKey> = {
  platform_owner: "platform",
  tenant_admin: "admin",
  tenant_viewer: "viewer",
  instructor: "facilitator",
  assessor: "assessor",
  moderator: "moderator",
  line_manager: "manager",
  learner: "learner",
  skills_development_facilitator: "sdf",
  external_verifier: "verifier",
  workplace_coach: "coach",
};

/** The introduction for one role, the pair's one when the provider combines them. */
export function introFor(role: Role, combined: boolean): IntroKey {
  return combined && FACILITATOR_ASSESSOR.includes(role) ? "facilitatorAssessor" : BY_ROLE[role];
}

/** The introductions for the roles shown, one each, in the order shown. */
export function introsFor(roles: Role[], combined: boolean): IntroKey[] {
  return [...new Set(roles.map((role) => introFor(role, combined)))];
}

/** The items this person may open. */
export function itemsFor(key: IntroKey, permissions: readonly Permission[]): IntroItem[] {
  return INTRO_ITEMS[key].filter((one) => one.anyPermission.some((permission) => permissions.includes(permission)));
}
