import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { users } from "@/db/schema";
import { can, permissionsFor } from "./rbac";
import { loadRoles, type AuthenticatedSession } from "./session";

/**
 * "View as": an administrator sees the platform exactly as one of their
 * people does, read-only.
 *
 * Roland, 5 October 2026: "I want to see everything for every roleplayer. I
 * don't see the need to have to pretend to be different roleplayers... Heidi
 * and Tenant owners will have administration access. They need to be able to
 * quality check every aspect of the system. They must see it working."
 *
 * The safeguards, each independent of the others:
 *
 *   - Only somebody who may manage the provider's settings can do it, only
 *     for a person of the same provider, and never as themselves. The cookie
 *     carries only the person's id; it means nothing unless the real session
 *     behind it holds that permission, so setting it by hand does nothing.
 *   - Every request other than reading a page is refused at the door while
 *     the cookie is present (proxy.ts), the way out excepted.
 *   - Every database transaction of such a request is read-only
 *     (db/client.ts), so a page that would record something as it renders
 *     cannot, whoever wrote it.
 *   - Starting is written to the audit log, with who looked as whom.
 */

export const VIEW_AS_COOKIE = "roft_view_as";

/** Whether this person may view the platform as somebody else. */
export function mayViewAs(session: AuthenticatedSession): boolean {
  return !session.viewAs && can(session, "tenant:manage_settings");
}

/**
 * The session as `targetUserId` sees the platform, for the administrator
 * behind `real`; null when that is not allowed or the person cannot be found.
 */
export async function viewAsSession(real: AuthenticatedSession, targetUserId: string): Promise<AuthenticatedSession | null> {
  if (!mayViewAs(real) || targetUserId === real.userId) return null;
  return withTenant(real.organisationId, async (tx) => {
    const [person] = await tx
      .select({ id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName, status: users.status, locale: users.locale })
      .from(users)
      .where(eq(users.id, targetUserId));
    if (!person || person.status !== "active") return null;
    const roles = await loadRoles(tx, person.id);
    return {
      // The administrator's own session row: signing out ends both.
      sessionId: real.sessionId,
      userId: person.id,
      organisationId: real.organisationId,
      email: person.email,
      firstName: person.firstName,
      lastName: person.lastName,
      roles,
      permissions: permissionsFor({ roles }),
      mustChangePassword: false,
      aiOn: false,
      locale: person.locale,
      viewAs: { byUserId: real.userId, byName: `${real.firstName} ${real.lastName}`.trim() },
    };
  });
}
