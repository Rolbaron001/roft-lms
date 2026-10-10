import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { organisations, users } from "@/db/schema";
import { recordAudit } from "./audit";
import { isLocale } from "./i18n/locales";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { clearTenantCache } from "./tenant";

/**
 * Choosing the language the platform speaks in. Job sheet D9.
 */

export class LanguageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LanguageError";
  }
}

/** A person's own choice, or null to follow their provider's. Anybody may set their own. */
export async function setOwnLocale(session: AuthenticatedSession, code: string | null) {
  if (code !== null && !isLocale(code)) throw new LanguageError("That is not a language this platform offers.");
  await withTenant(session.organisationId, async (tx) => {
    await tx.update(users).set({ locale: code }).where(eq(users.id, session.userId));
  }, { ownSitting: true });
}

/** The provider's default, for everybody who has not chosen their own. */
export async function setProviderLocale(session: AuthenticatedSession, code: string) {
  assertSessionCan(session, "tenant:manage_settings");
  if (!isLocale(code)) throw new LanguageError("That is not a language this platform offers.");
  await withTenant(session.organisationId, async (tx) => {
    await tx.update(organisations).set({ defaultLocale: code }).where(eq(organisations.id, session.organisationId));
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "organisation.language_changed",
      entityType: "organisation",
      entityId: session.organisationId,
      after: { defaultLocale: code },
    });
  });
  // The tenant's identity is cached briefly; the new language shows at once.
  clearTenantCache();
}
