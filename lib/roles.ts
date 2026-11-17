/**
 * How a provider's roles are shown and held (job sheet D50).
 *
 * Heidi, 13 November 2026: at Curiosa a facilitator and an assessor are one
 * person and one role, "Facilitator / Assessor". Underneath they stay two
 * roles, because another provider may keep a facilitator who does not assess;
 * a provider that combines them (Settings) holds both whenever it holds
 * either, and every screen shows the one.
 *
 * This module imports only types, so a form can use it.
 */
import type { Role } from "./rbac";

/** The pair a provider may combine. The first is the one shown. */
export const FACILITATOR_ASSESSOR: readonly Role[] = ["instructor", "assessor"];

/** Roles as held: with the pair combined, either brings the other. */
export function withCombined(roles: Role[], combined: boolean): Role[] {
  if (!combined || !roles.some((role) => FACILITATOR_ASSESSOR.includes(role))) return roles;
  return [...new Set([...roles, ...FACILITATOR_ASSESSOR])];
}

/** Roles as shown: with the pair combined, one badge for the two. */
export function displayRoles(roles: Role[], combined: boolean): Role[] {
  if (!combined || !roles.includes("instructor")) return roles;
  return roles.filter((role) => role !== "assessor");
}

/** The phrase key naming a role, "Facilitator / Assessor" for the pair when combined. */
export function roleLabelKey(role: Role, combined: boolean): "role.facilitatorAssessor" | `role.${Role}` {
  return combined && FACILITATOR_ASSESSOR.includes(role) ? "role.facilitatorAssessor" : `role.${role}`;
}

/**
 * The roles a person works in when they choose one: the pair together when
 * combined, otherwise the one chosen.
 */
export function actingRoles(chosen: Role, held: Role[], combined: boolean): Role[] {
  if (combined && FACILITATOR_ASSESSOR.includes(chosen)) return held.filter((role) => FACILITATOR_ASSESSOR.includes(role));
  return [chosen];
}
