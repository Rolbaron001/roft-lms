/**
 * Resets one person's password from the server.
 *
 * The break-glass path, for when nobody can get in through the interface.
 * Every other reset goes through People, by an administrator, and is the right
 * way to do it. This exists for the case that route cannot cover: the
 * administrator is the person locked out, so there is no session to act with.
 *
 * Deliberately requires access to the server itself. Until there is a mail
 * server there can be no "email me a reset link", and inventing a self-service
 * route without one would mean a security question or a recovery code — both
 * weaker than the SSH key already protecting this machine. Whoever can run
 * this can already read the database.
 *
 *   npx tsx scripts/reset-password.mts someone@example.org
 *   npx tsx scripts/reset-password.mts someone@example.org --org roft
 *
 * The new password is shown once. The person must change it at first sign-in.
 */
import { config } from "dotenv";
import { and, eq } from "drizzle-orm";

config({ path: ".env.local" });

const { withPlatformScope, withTenant } = await import("../db/client");
const { users, organisations } = await import("../db/schema");
const { hashPassword } = await import("../lib/password");
const { generateInitialPassword } = await import("../lib/people");
const { recordAudit } = await import("../lib/audit");
const { revokeAllSessionsForUser } = await import("../lib/session");

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
const orgIndex = args.indexOf("--org");
const orgSlug = orgIndex === -1 ? undefined : args[orgIndex + 1];

if (!email) {
  console.error(
    "Give the email address:\n" +
      "  npx tsx scripts/reset-password.mts someone@example.org [--org slug]\n",
  );
  process.exit(1);
}

// Cross-tenant on purpose: the same address can exist in more than one tenant,
// and at this point we have no session telling us which one is meant.
const matches = await withPlatformScope(
  "resetting a password from the server, where no administrator session exists",
  async (tx) =>
    tx
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        status: users.status,
        organisationId: users.organisationId,
        orgSlug: organisations.slug,
        orgName: organisations.displayName,
      })
      .from(users)
      .innerJoin(organisations, eq(organisations.id, users.organisationId))
      .where(
        orgSlug
          ? and(eq(users.email, email), eq(organisations.slug, orgSlug))
          : eq(users.email, email),
      ),
);

if (matches.length === 0) {
  console.error(`No account with that address${orgSlug ? ` in ${orgSlug}` : ""}.`);
  process.exit(1);
}

if (matches.length > 1) {
  console.error(
    `That address exists in ${matches.length} tenants. Say which one:\n` +
      matches.map((m) => `  --org ${m.orgSlug}   (${m.orgName})`).join("\n") +
      "\n",
  );
  process.exit(1);
}

const person = matches[0];
const password = generateInitialPassword();
const passwordHash = await hashPassword(password);

await withTenant(person.organisationId, async (tx) => {
  await tx
    .update(users)
    .set({
      passwordHash,
      mustChangePassword: true,
      // Someone locked out of a suspended account would otherwise get a
      // working password and still be refused at the door.
      status: person.status === "invited" ? "active" : person.status,
      updatedAt: new Date(),
    })
    .where(eq(users.id, person.id));

  // No actor id: nobody was signed in. The audit log should say plainly that
  // this came from the server rather than name a user who did not do it.
  await recordAudit(tx, {
    organisationId: person.organisationId,
    actorId: null,
    action: "user.password_reset_from_server",
    entityType: "user",
    entityId: person.id,
  });
});

// Any session opened with the old password stops working now. If the reset is
// happening because the account was interfered with, leaving those alive would
// defeat the point.
const revoked = await revokeAllSessionsForUser(
  person.organisationId,
  person.id,
  "password_reset_from_server",
);

console.log(`
  Password reset for ${person.firstName} ${person.lastName} <${person.email}>
  Tenant: ${person.orgName} (${person.orgSlug})
  ${revoked} existing session(s) signed out.

  ─────────────────────────────────────────────
   New password:  ${password}
  ─────────────────────────────────────────────

  Shown once. It must be changed at first sign-in.
  This reset is in the audit log as user.password_reset_from_server.
`);

process.exit(0);
