import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withPlatformScope, withTenant } from "@/db/client";
import { organisations, userRoles, users } from "@/db/schema";
import { recordAudit } from "./audit";
import { hashPassword } from "./password";
import { generateInitialPassword } from "./people";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { clearTenantCache } from "./tenant";
import { DEFAULT_TIME_ZONE, isSupportedTimeZone } from "./timezone";

/**
 * Provisioning client organisations — the Platform Owner's job.
 *
 * The design document is explicit that the Platform Owner "has visibility into
 * system health and usage across all tenants, but not into a tenant's private
 * content or learner data". That line is the whole reason a client would put
 * their people's assessment records on somebody else's platform, so it is
 * enforced rather than assumed:
 *
 *   - every function here returns counts and configuration, never a learner,
 *     a course, an assessment decision or a certificate;
 *   - the RBAC test suite asserts the Platform Owner role holds no permission
 *     to read tenant data;
 *   - row-level security still applies underneath, so even a mistake here
 *     could not casually spill one client's records into another's view.
 *
 * Creating a tenant necessarily crosses the tenant boundary, so it runs under
 * withPlatformScope with a written reason, which lands in the audit log.
 */

export class ProvisioningError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "duplicate"
      | "invalid_input"
      | "not_empty",
  ) {
    super(message);
    this.name = "ProvisioningError";
  }
}

/**
 * Reserved because they are, or could become, platform hostnames. A tenant
 * called "www" or "api" would be unreachable at best and would shadow a
 * platform route at worst.
 */
const RESERVED_SLUGS = new Set([
  "www", "api", "app", "admin", "mail", "smtp", "ftp", "ns", "ns1", "ns2",
  "verify", "status", "health", "assets", "static", "cdn", "docs", "support",
  "platform", "login", "signup", "billing", "help",
]);

/**
 * A logo address: either somewhere on the web, or a file served by this
 * application. The relative form matters — a tenant whose logo is hosted on
 * their own marketing site loses it the day that site is redesigned, so being
 * able to hold the file here is the more durable option.
 *
 * Anything else is refused. In particular a `javascript:` or `data:` address
 * has no business in a src attribute rendered for every user.
 */
const logoAddress = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (value) =>
      value === "" ||
      value.startsWith("/") ||
      /^https?:\/\//i.test(value),
    { message: "Use a web address beginning http:// or https://, or a path beginning /." },
  )
  .optional()
  .or(z.literal(""));

export const tenantInput = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(40)
    .regex(
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
      "Use lower-case letters, numbers and hyphens; it becomes part of the web address.",
    ),
  legalName: z.string().trim().min(2).max(300),
  displayName: z.string().trim().min(2).max(200),
  deploymentMode: z
    .enum(["shared_cloud", "dedicated_cloud", "on_premise"])
    .default("shared_cloud"),
  primaryColour: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #0D1E32.")
    .default("#0D1E32"),
  accentColour: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #B9975B.")
    .default("#B9975B"),
  logoUrl: logoAddress,
  customDomain: z.string().trim().max(255).optional().or(z.literal("")),
  accreditationNumber: z.string().trim().max(100).optional(),
  wardCode: z.string().trim().max(20).optional(),
  qualityAssurancePartner: z.string().trim().max(200).optional(),
  timezone: z
    .string()
    .trim()
    .refine(isSupportedTimeZone, "That is not a time zone this server knows.")
    .default(DEFAULT_TIME_ZONE),
  dataRetentionYears: z.coerce.number().int().min(1).max(50).default(5),
  featureFlags: z
    .object({
      qcto_portfolio: z.boolean().default(false),
      statutory_reporting: z.boolean().default(false),
      learning_paths: z.boolean().default(true),
    })
    .default({
      qcto_portfolio: false,
      statutory_reporting: false,
      learning_paths: true,
    }),
});

export type TenantInput = z.input<typeof tenantInput>;

export const administratorInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
});

export type TenantSummary = {
  id: string;
  slug: string;
  displayName: string;
  legalName: string;
  status: string;
  deploymentMode: string;
  customDomain: string | null;
  createdAt: Date;
  /** Counts only. Never the records themselves. */
  people: number;
  enrolments: number;
  certificates: number;
  administrators: number;
};

export async function listTenants(
  session: AuthenticatedSession,
): Promise<TenantSummary[]> {
  assertSessionCan(session, "platform:manage_tenants");

  return withPlatformScope(
    "Platform Owner listing tenants and their usage counts",
    (tx) =>
      tx
        .select({
          id: organisations.id,
          slug: organisations.slug,
          displayName: organisations.displayName,
          legalName: organisations.legalName,
          status: organisations.status,
          deploymentMode: organisations.deploymentMode,
          customDomain: organisations.customDomain,
          createdAt: organisations.createdAt,
          people: sql<number>`(
            select count(*)::int from users u
            where u.organisation_id = organisations.id and u.status = 'active'
          )`,
          enrolments: sql<number>`(
            select count(*)::int from enrolments e
            where e.organisation_id = organisations.id
          )`,
          certificates: sql<number>`(
            select count(*)::int from certificates c
            where c.organisation_id = organisations.id and c.revoked_at is null
          )`,
          administrators: sql<number>`(
            select count(*)::int from user_roles r
            where r.organisation_id = organisations.id
              and r.role = 'tenant_admin' and r.revoked_at is null
          )`,
        })
        .from(organisations)
        .orderBy(asc(organisations.displayName)),
  );
}

export async function getTenant(
  session: AuthenticatedSession,
  tenantId: string,
) {
  assertSessionCan(session, "platform:manage_tenants");

  return withPlatformScope(
    "Platform Owner reading a tenant's configuration",
    async (tx) => {
      const [tenant] = await tx
        .select()
        .from(organisations)
        .where(eq(organisations.id, tenantId));

      if (!tenant) {
        throw new ProvisioningError("Organisation not found.", "not_found");
      }

      // Names of the administrators only, so the Platform Owner knows who to
      // contact. Not a directory of the client's people.
      const administrators = await tx
        .select({
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          status: users.status,
        })
        .from(userRoles)
        .innerJoin(users, eq(users.id, userRoles.userId))
        .where(
          sql`${userRoles.organisationId} = ${tenantId}
              and ${userRoles.role} = 'tenant_admin'
              and ${userRoles.revokedAt} is null`,
        );

      return { tenant, administrators };
    },
  );
}

/**
 * Creates an organisation and its first administrator together.
 *
 * Deliberately one operation. A tenant without an administrator cannot be
 * handed over — somebody would have to go back into the database to finish it
 * — and a half-provisioned client is the state most likely to be forgotten.
 */
export async function createTenant(
  session: AuthenticatedSession,
  input: TenantInput,
  administrator: z.infer<typeof administratorInput>,
): Promise<{ tenantId: string; initialPassword: string }> {
  assertSessionCan(session, "platform:manage_tenants");

  const parsed = tenantInput.parse(input);
  const admin = administratorInput.parse(administrator);

  if (RESERVED_SLUGS.has(parsed.slug)) {
    throw new ProvisioningError(
      `"${parsed.slug}" is reserved for the platform itself. Choose another.`,
      "invalid_input",
    );
  }

  const initialPassword = generateInitialPassword();
  const passwordHash = await hashPassword(initialPassword);

  const tenantId = await withPlatformScope(
    "Platform Owner provisioning a new client organisation",
    async (tx) => {
      const [existing] = await tx
        .select({ id: organisations.id })
        .from(organisations)
        .where(eq(organisations.slug, parsed.slug));

      if (existing) {
        throw new ProvisioningError(
          `The address "${parsed.slug}" is already in use.`,
          "duplicate",
        );
      }

      const [organisation] = await tx
        .insert(organisations)
        .values({
          slug: parsed.slug,
          legalName: parsed.legalName,
          displayName: parsed.displayName,
          deploymentMode: parsed.deploymentMode,
          status: "active",
          primaryColour: parsed.primaryColour,
          accentColour: parsed.accentColour,
          logoUrl: parsed.logoUrl || null,
          customDomain: parsed.customDomain || null,
          accreditationNumber: parsed.accreditationNumber ?? null,
          wardCode: parsed.wardCode ?? null,
          qualityAssurancePartner: parsed.qualityAssurancePartner ?? null,
          timezone: parsed.timezone,
          dataRetentionYears: parsed.dataRetentionYears,
          featureFlags: parsed.featureFlags,
        })
        .returning({ id: organisations.id });

      const [created] = await tx
        .insert(users)
        .values({
          organisationId: organisation.id,
          email: admin.email,
          passwordHash,
          firstName: admin.firstName,
          lastName: admin.lastName,
          status: "active",
        })
        .returning({ id: users.id });

      await tx.insert(userRoles).values({
        organisationId: organisation.id,
        userId: created.id,
        role: "tenant_admin",
      });

      // Written into the new tenant's own audit log, so their record begins
      // with who set them up and when.
      await recordAudit(tx, {
        organisationId: organisation.id,
        actorId: session.userId,
        actorRole: "platform_owner",
        action: "tenant.provisioned",
        entityType: "organisation",
        entityId: organisation.id,
        after: {
          slug: parsed.slug,
          legalName: parsed.legalName,
          deploymentMode: parsed.deploymentMode,
          firstAdministrator: admin.email,
        },
      });

      return organisation.id;
    },
  );

  // A newly created tenant must be reachable straight away, not after the
  // hostname cache expires.
  clearTenantCache();

  return { tenantId, initialPassword };
}

export async function updateTenant(
  session: AuthenticatedSession,
  tenantId: string,
  input: TenantInput,
) {
  assertSessionCan(session, "platform:manage_tenants");
  const parsed = tenantInput.parse(input);

  const result = await withPlatformScope(
    "Platform Owner updating a tenant's configuration",
    async (tx) => {
      const [before] = await tx
        .select()
        .from(organisations)
        .where(eq(organisations.id, tenantId));

      if (!before) {
        throw new ProvisioningError("Organisation not found.", "not_found");
      }

      if (parsed.slug !== before.slug && RESERVED_SLUGS.has(parsed.slug)) {
        throw new ProvisioningError(
          `"${parsed.slug}" is reserved for the platform itself.`,
          "invalid_input",
        );
      }

      const [updated] = await tx
        .update(organisations)
        .set({
          slug: parsed.slug,
          legalName: parsed.legalName,
          displayName: parsed.displayName,
          deploymentMode: parsed.deploymentMode,
          primaryColour: parsed.primaryColour,
          accentColour: parsed.accentColour,
          logoUrl: parsed.logoUrl || null,
          customDomain: parsed.customDomain || null,
          accreditationNumber: parsed.accreditationNumber ?? null,
          wardCode: parsed.wardCode ?? null,
          qualityAssurancePartner: parsed.qualityAssurancePartner ?? null,
          timezone: parsed.timezone,
          dataRetentionYears: parsed.dataRetentionYears,
          featureFlags: parsed.featureFlags,
          updatedAt: new Date(),
        })
        .where(eq(organisations.id, tenantId))
        .returning();

      await recordAudit(tx, {
        organisationId: tenantId,
        actorId: session.userId,
        actorRole: "platform_owner",
        action: "tenant.updated",
        entityType: "organisation",
        entityId: tenantId,
        before,
        after: updated,
      });

      return updated;
    },
  );

  clearTenantCache();
  return result;
}

/**
 * Suspending an organisation makes its hostname stop resolving, so nobody
 * there can even reach a login form. Nothing is deleted: a client who has
 * stopped paying may well start again, and their assessment records have to
 * survive the gap.
 */
export async function setTenantStatus(
  session: AuthenticatedSession,
  tenantId: string,
  status: "active" | "suspended" | "closed",
  reason: string,
) {
  assertSessionCan(session, "platform:manage_tenants");

  if (reason.trim().length < 5) {
    throw new ProvisioningError(
      "Record why. Cutting off a client's access is not something to do unexplained.",
      "invalid_input",
    );
  }

  await withPlatformScope(
    "Platform Owner changing a tenant's status",
    async (tx) => {
      const [before] = await tx
        .select({ status: organisations.status })
        .from(organisations)
        .where(eq(organisations.id, tenantId));

      if (!before) {
        throw new ProvisioningError("Organisation not found.", "not_found");
      }

      await tx
        .update(organisations)
        .set({ status, updatedAt: new Date() })
        .where(eq(organisations.id, tenantId));

      await recordAudit(tx, {
        organisationId: tenantId,
        actorId: session.userId,
        actorRole: "platform_owner",
        action: `tenant.${status}`,
        entityType: "organisation",
        entityId: tenantId,
        before: { status: before.status },
        after: { status, reason },
      });
    },
  );

  clearTenantCache();
}

export type PlatformHealth = {
  tenants: number;
  activeTenants: number;
  people: number;
  enrolments: number;
  certificates: number;
  tenantsWithoutAdministrator: number;
};

/** Platform-wide totals. Aggregates only — no tenant is identified here. */
export async function platformHealth(
  session: AuthenticatedSession,
): Promise<PlatformHealth> {
  assertSessionCan(session, "platform:view_health");

  return withPlatformScope(
    "Platform Owner reading platform-wide health totals",
    async (tx) => {
      const [row] = await tx
        .select({
          tenants: sql<number>`(select count(*)::int from organisations)`,
          activeTenants: sql<number>`(
            select count(*)::int from organisations where status = 'active'
          )`,
          people: sql<number>`(
            select count(*)::int from users where status = 'active'
          )`,
          enrolments: sql<number>`(select count(*)::int from enrolments)`,
          certificates: sql<number>`(
            select count(*)::int from certificates where revoked_at is null
          )`,
          tenantsWithoutAdministrator: sql<number>`(
            select count(*)::int from organisations o
            where o.status = 'active'
              and not exists (
                select 1 from user_roles r
                where r.organisation_id = o.id
                  and r.role = 'tenant_admin'
                  and r.revoked_at is null
              )
          )`,
        })
        .from(sql`(select 1) as one`);

      return row;
    },
  );
}

/**
 * A tenant administrator changing their own organisation's appearance.
 *
 * Separate from `updateTenant` because it is a different job with different
 * authority: a client may restyle their own portal, but not change their
 * accreditation number, deployment mode or web address.
 */
export const brandingInput = z.object({
  displayName: z.string().trim().min(2).max(200),
  primaryColour: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #0D1E32."),
  accentColour: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #B9975B."),
  logoUrl: logoAddress,
  /** A graphic for the sign-in page, and a line under it. Both optional. */
  signInGraphicUrl: logoAddress,
  strapline: z.string().trim().max(120).optional().or(z.literal("")),
});

export async function updateOwnBranding(
  session: AuthenticatedSession,
  input: z.infer<typeof brandingInput>,
) {
  assertSessionCan(session, "tenant:manage_branding");
  const parsed = brandingInput.parse(input);

  const result = await withTenant(session.organisationId, async (tx) => {
    const [before] = await tx
      .select()
      .from(organisations)
      .where(eq(organisations.id, session.organisationId));

    const [updated] = await tx
      .update(organisations)
      .set({
        displayName: parsed.displayName,
        primaryColour: parsed.primaryColour,
        accentColour: parsed.accentColour,
        logoUrl: parsed.logoUrl || null,
        signInGraphicUrl: parsed.signInGraphicUrl || null,
        strapline: parsed.strapline || null,
        updatedAt: new Date(),
      })
      .where(eq(organisations.id, session.organisationId))
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "tenant.branding_updated",
      entityType: "organisation",
      entityId: session.organisationId,
      before: {
        displayName: before.displayName,
        primaryColour: before.primaryColour,
        accentColour: before.accentColour,
      },
      after: {
        displayName: updated.displayName,
        primaryColour: updated.primaryColour,
        accentColour: updated.accentColour,
      },
    });

    return updated;
  });

  clearTenantCache();
  return result;
}

/**
 * Sets the provider's own clock.
 *
 * Its own function and its own permission, deliberately. This is the setting
 * that decides whether a candidate arriving at 09:05 is admitted to a 09:00
 * sitting, so moving it is not the same kind of act as changing a logo, and it
 * is audited like the other things that change what the record means.
 */
export async function setTenantTimeZone(
  session: AuthenticatedSession,
  timezone: string,
) {
  assertSessionCan(session, "tenant:manage_settings");
  const parsed = z
    .string()
    .trim()
    .refine(isSupportedTimeZone, "That is not a time zone this server knows.")
    .parse(timezone);

  const result = await withTenant(session.organisationId, async (tx) => {
    const [before] = await tx
      .select({ timezone: organisations.timezone })
      .from(organisations)
      .where(eq(organisations.id, session.organisationId));

    const [updated] = await tx
      .update(organisations)
      .set({ timezone: parsed, updatedAt: new Date() })
      .where(eq(organisations.id, session.organisationId))
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "tenant.timezone_updated",
      entityType: "organisation",
      entityId: session.organisationId,
      before: { timezone: before?.timezone ?? null },
      after: { timezone: updated.timezone },
    });

    return updated;
  });

  clearTenantCache();
  return result;
}

export { RESERVED_SLUGS };
