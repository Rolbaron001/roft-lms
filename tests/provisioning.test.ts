/**
 * Provisioning client organisations, against a live database.
 *
 * The claim being tested is the one a client relies on when they put their
 * people's assessment records on somebody else's platform: ROFT can manage
 * their organisation without being able to read what is in it.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import { auditLog, organisations, userRoles, users } from "@/db/schema";
import {
  createTenant,
  getTenant,
  listTenants,
  platformHealth,
  ProvisioningError,
  setTenantStatus,
  updateOwnBranding,
  updateTenant,
} from "@/lib/provisioning";
import { clearTenantCache, resolveTenant } from "@/lib/tenant";
import { signIn } from "@/lib/session";
import { PermissionDeniedError, permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let platformOrgId: string;
let owner: AuthenticatedSession;
let tenantAdmin: AuthenticatedSession;
const createdSlugs: string[] = [];

function sessionFor(
  roles: Role[],
  userId: string,
  organisationId: string,
): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "test@example.test",
    firstName: "Test",
    lastName: "User",
    roles,
    permissions: permissionsFor({ roles }),
  };
}

function suffix() {
  return Math.random().toString(36).slice(2, 8);
}

function tenantFields(slug: string) {
  return {
    slug,
    legalName: `${slug} Holdings (Pty) Ltd`,
    displayName: `${slug} Holdings`,
    deploymentMode: "shared_cloud" as const,
    primaryColour: "#123456",
    accentColour: "#abcdef",
    dataRetentionYears: 5,
    featureFlags: {
      qcto_portfolio: false,
      statutory_reporting: false,
      learning_paths: true,
    },
  };
}

function administrator(slug: string) {
  return {
    email: `admin@${slug}.test`,
    firstName: "First",
    lastName: "Administrator",
  };
}

beforeAll(async () => {
  const slug = `plat-${Date.now()}`;
  createdSlugs.push(slug);

  const created = await withPlatformScope(
    "provisioning test fixture setup",
    async (tx) => {
      const [organisation] = await tx
        .insert(organisations)
        .values({
          slug,
          legalName: "Platform Owner Test Co",
          displayName: "Platform Owner Test Co",
          status: "active",
        })
        .returning({ id: organisations.id });

      const [platformOwner] = await tx
        .insert(users)
        .values({
          organisationId: organisation.id,
          email: "owner@platform.test",
          firstName: "Platform",
          lastName: "Owner",
          status: "active",
        })
        .returning({ id: users.id });

      await tx.insert(userRoles).values({
        organisationId: organisation.id,
        userId: platformOwner.id,
        role: "platform_owner",
      });

      const [admin] = await tx
        .insert(users)
        .values({
          organisationId: organisation.id,
          email: "admin@platform.test",
          firstName: "Tenant",
          lastName: "Administrator",
          status: "active",
        })
        .returning({ id: users.id });

      await tx.insert(userRoles).values({
        organisationId: organisation.id,
        userId: admin.id,
        role: "tenant_admin",
      });

      return {
        organisationId: organisation.id,
        ownerId: platformOwner.id,
        adminId: admin.id,
      };
    },
  );

  platformOrgId = created.organisationId;
  owner = sessionFor(["platform_owner"], created.ownerId, platformOrgId);
  tenantAdmin = sessionFor(["tenant_admin"], created.adminId, platformOrgId);
});

afterAll(async () => {
  await withPlatformScope("provisioning test teardown", (tx) =>
    tx.delete(organisations).where(inArray(organisations.slug, createdSlugs)),
  );
  clearTenantCache();
});

describe("creating a client organisation", () => {
  it("creates the organisation and a working administrator together", async () => {
    const slug = `client${suffix()}`;
    createdSlugs.push(slug);

    const { initialPassword, tenantId } = await createTenant(
      owner,
      tenantFields(slug),
      administrator(slug),
    );

    // The administrator can actually sign in — a tenant handed over with an
    // account that does not work is worse than none at all.
    const result = await signIn(
      tenantId,
      `admin@${slug}.test`,
      initialPassword,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.roles).toEqual(["tenant_admin"]);
  });

  it("makes the new organisation reachable at its address immediately", async () => {
    const slug = `instant${suffix()}`;
    createdSlugs.push(slug);

    await createTenant(owner, tenantFields(slug), administrator(slug));

    // Without cache invalidation on create, a brand-new client would report
    // "this address is not in use" for the first minute of its life.
    const resolved = await resolveTenant(`${slug}.localhost:3000`);
    expect(resolved?.slug).toBe(slug);
  });

  it("refuses a duplicate address", async () => {
    const slug = `dupe${suffix()}`;
    createdSlugs.push(slug);

    await createTenant(owner, tenantFields(slug), administrator(slug));

    await expect(
      createTenant(owner, tenantFields(slug), administrator(slug)),
    ).rejects.toMatchObject({ code: "duplicate" });
  });

  /** A tenant called "www" or "api" would shadow a platform hostname. */
  it("refuses a reserved address", async () => {
    await expect(
      createTenant(owner, tenantFields("www"), administrator("www")),
    ).rejects.toMatchObject({ code: "invalid_input" });

    await expect(
      createTenant(owner, tenantFields("verify"), administrator("verify")),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("refuses an address that would not work in a hostname", async () => {
    await expect(
      createTenant(
        owner,
        { ...tenantFields("bad"), slug: "Not A Host!" },
        administrator("bad"),
      ),
    ).rejects.toThrow();
  });

  it("records the setup in the new organisation's own audit log", async () => {
    const slug = `audited${suffix()}`;
    createdSlugs.push(slug);

    const { tenantId } = await createTenant(
      owner,
      tenantFields(slug),
      administrator(slug),
    );

    const entries = await withTenant(tenantId, (tx) =>
      tx
        .select({ action: auditLog.action, actorId: auditLog.actorId })
        .from(auditLog)
        .where(eq(auditLog.entityId, tenantId)),
    );

    expect(entries[0].action).toBe("tenant.provisioned");
    expect(entries[0].actorId).toBe(owner.userId);
  });

  it("stops a tenant administrator creating organisations", async () => {
    const slug = `nope${suffix()}`;
    await expect(
      createTenant(tenantAdmin, tenantFields(slug), administrator(slug)),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("the Platform Owner's boundary", () => {
  /**
   * The design document says the Platform Owner has visibility into usage
   * across tenants "but not into a tenant's private content or learner data".
   * This is that sentence, tested.
   */
  it("returns counts about a client, never their people", async () => {
    const slug = `private${suffix()}`;
    createdSlugs.push(slug);
    const { tenantId } = await createTenant(
      owner,
      tenantFields(slug),
      administrator(slug),
    );

    const listed = (await listTenants(owner)).find((row) => row.id === tenantId);
    expect(listed).toBeDefined();
    expect(listed!.people).toBe(1);

    // The shape itself carries no learner, course or assessment record.
    const keys = Object.keys(listed!);
    for (const forbidden of ["users", "learners", "courses", "certificatesList"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("holds no permission to read a client's learner data", () => {
    // Belt and braces alongside the RBAC suite: whatever this file adds, the
    // role itself must never gain these.
    expect(owner.permissions).not.toContain("evidence:read_all");
    expect(owner.permissions).not.toContain("enrolment:read_all");
    expect(owner.permissions).not.toContain("report:tenant");
    expect(owner.permissions).not.toContain("user:read");
  });

  it("reports platform totals without identifying any client", async () => {
    const health = await platformHealth(owner);
    expect(health.tenants).toBeGreaterThan(0);
    expect(Object.keys(health)).toEqual([
      "tenants",
      "activeTenants",
      "people",
      "enrolments",
      "certificates",
      "tenantsWithoutAdministrator",
    ]);
  });

  it("names a client's administrators, so ROFT knows who to contact", async () => {
    const slug = `contact${suffix()}`;
    createdSlugs.push(slug);
    const { tenantId } = await createTenant(
      owner,
      tenantFields(slug),
      administrator(slug),
    );

    const { administrators } = await getTenant(owner, tenantId);
    expect(administrators).toHaveLength(1);
    expect(administrators[0].email).toBe(`admin@${slug}.test`);
  });
});

describe("suspending a client", () => {
  it("stops their address resolving, so nobody there reaches a login page", async () => {
    const slug = `suspend${suffix()}`;
    createdSlugs.push(slug);
    const { tenantId } = await createTenant(
      owner,
      tenantFields(slug),
      administrator(slug),
    );

    expect(await resolveTenant(`${slug}.localhost:3000`)).not.toBeNull();

    await setTenantStatus(owner, tenantId, "suspended", "Subscription lapsed.");

    expect(await resolveTenant(`${slug}.localhost:3000`)).toBeNull();
  });

  it("keeps their records, so a returning client is not starting again", async () => {
    const slug = `returning${suffix()}`;
    createdSlugs.push(slug);
    const { tenantId } = await createTenant(
      owner,
      tenantFields(slug),
      administrator(slug),
    );

    await setTenantStatus(owner, tenantId, "suspended", "Subscription lapsed.");
    await setTenantStatus(owner, tenantId, "active", "Subscription renewed.");

    const [row] = await withPlatformScope("checking a reactivated tenant", (tx) =>
      tx.select().from(organisations).where(eq(organisations.id, tenantId)),
    );
    expect(row.status).toBe("active");

    const people = await withTenant(tenantId, (tx) =>
      tx.select({ id: users.id }).from(users),
    );
    expect(people).toHaveLength(1);
  });

  it("requires a reason for cutting off access", async () => {
    const slug = `reason${suffix()}`;
    createdSlugs.push(slug);
    const { tenantId } = await createTenant(
      owner,
      tenantFields(slug),
      administrator(slug),
    );

    await expect(
      setTenantStatus(owner, tenantId, "suspended", "x"),
    ).rejects.toBeInstanceOf(ProvisioningError);
  });
});

describe("branding", () => {
  it("lets the Platform Owner change a client's configuration", async () => {
    const slug = `brand${suffix()}`;
    createdSlugs.push(slug);
    const { tenantId } = await createTenant(
      owner,
      tenantFields(slug),
      administrator(slug),
    );

    await updateTenant(owner, tenantId, {
      ...tenantFields(slug),
      displayName: "Renamed Holdings",
      primaryColour: "#004488",
    });

    const resolved = await resolveTenant(`${slug}.localhost:3000`);
    expect(resolved?.displayName).toBe("Renamed Holdings");
    expect(resolved?.primaryColour).toBe("#004488");
  });

  it("lets a tenant administrator restyle their own organisation", async () => {
    await updateOwnBranding(tenantAdmin, {
      displayName: "Restyled By Client",
      primaryColour: "#112233",
      accentColour: "#445566",
    });

    const [row] = await withTenant(platformOrgId, (tx) =>
      tx.select().from(organisations).where(eq(organisations.id, platformOrgId)),
    );

    expect(row.displayName).toBe("Restyled By Client");
    expect(row.primaryColour).toBe("#112233");
  });

  /** A client may restyle their portal; they may not move it or re-accredit it. */
  it("does not let a tenant administrator change anything but appearance", async () => {
    await expect(
      updateTenant(tenantAdmin, platformOrgId, tenantFields("hijack")),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("rejects a colour that is not a colour", async () => {
    await expect(
      updateOwnBranding(tenantAdmin, {
        displayName: "Fine",
        primaryColour: "navy blue",
        accentColour: "#445566",
      }),
    ).rejects.toThrow();
  });
});
