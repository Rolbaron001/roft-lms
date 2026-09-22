/**
 * Creates the sandbox tenant Heidi tests on.
 *
 * Roland, 22 September 2026: Heidi is in Pretoria and the development server is
 * in Betty's Bay, so she cannot reach it. Testing has to happen over the
 * internet, and doing it inside Curiosa's own tenant would put a test person,
 * an enrolment and assessment submissions into the records they will show the
 * QCTO. Some of that is deliberately hard to remove.
 *
 * So: a second tenant on the same server, reached at lms.roftbusiness.org,
 * which Roland already controls and which stopped serving anything on
 * 31 August. Caddy issues its certificate on the first request after asking
 * the platform whether the hostname belongs to a real tenant, which is why
 * this runs before the DNS record changes rather than after.
 *
 * Named for what it is rather than after ROFT. ROFT and Curiosa run separate
 * deployments, and a tenant called ROFT living inside Curiosa's server would
 * quietly contradict that.
 *
 * Run once, on the server, in the tools container. Refuses if it already
 * exists rather than making a second one.
 */
import { config } from "dotenv";
config({ path: ".env" });

const { withPlatformScope } = await import("../db/client");
const { organisations, userRoles, users } = await import("../db/schema");
const { createTenant } = await import("../lib/provisioning");
const { permissionsFor } = await import("../lib/rbac");
const { eq } = await import("drizzle-orm");

const SLUG = "sandbox";
const DOMAIN = "lms.roftbusiness.org";

const already = await withPlatformScope("checking for the sandbox", (tx) =>
  tx.select({ id: organisations.id }).from(organisations).where(eq(organisations.slug, SLUG)),
);

if (already.length > 0) {
  console.log(`The "${SLUG}" tenant already exists. Nothing done.`);
  process.exit(0);
}

/*
 * Acting as the platform owner, because createTenant asks for that permission
 * and should keep asking. Found rather than assumed: the owner is whoever
 * holds platform:manage_tenants on the platform organisation.
 */
const owner = await withPlatformScope("finding the platform owner", async (tx) => {
  const platformSlug = process.env.PLATFORM_ORG_SLUG ?? "roft";
  const [org] = await tx
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.slug, platformSlug));

  if (!org) throw new Error(`No platform organisation with slug "${platformSlug}".`);

  const people = await tx
    .select({ id: users.id, email: users.email, role: userRoles.role })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(eq(users.organisationId, org.id));

  const found = people.find((person) =>
    permissionsFor({ roles: [person.role as never] }).includes("platform:manage_tenants"),
  );

  if (!found) throw new Error("Nobody on the platform organisation may create tenants.");
  return { organisationId: org.id, userId: found.id, email: found.email, role: found.role };
});

const session = {
  sessionId: "00000000-0000-0000-0000-000000000000",
  userId: owner.userId,
  organisationId: owner.organisationId,
  email: owner.email,
  firstName: "Platform",
  lastName: "Owner",
  roles: [owner.role] as never,
  permissions: permissionsFor({ roles: [owner.role] as never }),
  mustChangePassword: false,
  aiOn: false,
};

const { initialPassword } = await createTenant(
  session as never,
  {
    slug: SLUG,
    legalName: "Curiosa Academy (sandbox)",
    displayName: "Curiosa Sandbox",
    customDomain: DOMAIN,
    timezone: "Africa/Johannesburg",
  } as never,
  {
    email: process.env.SANDBOX_ADMIN_EMAIL ?? "heidi@curiosa.academy",
    firstName: "Heidi",
    lastName: "Edwards",
  },
);

console.log(`
  Created "${SLUG}" at https://${DOMAIN}
  Administrator: ${process.env.SANDBOX_ADMIN_EMAIL ?? "heidi@curiosa.academy"}

  ─────────────────────────────────────────────
   First password:  ${initialPassword}
  ─────────────────────────────────────────────

  Shown once. It must be changed at first sign-in.
  The address works once lms.roftbusiness.org points at this server.
`);
process.exit(0);
