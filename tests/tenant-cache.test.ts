/**
 * A newly provisioned tenant has to be reachable almost immediately. Caching a
 * failed lookup for as long as a successful one would leave a client staring
 * at "this address is not in use" right after their system was set up.
 */
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { organisations } from "@/db/schema";
import { clearTenantCache, resolveTenant } from "@/lib/tenant";

const createdSlugs: string[] = [];

afterEach(async () => {
  if (createdSlugs.length === 0) return;
  await withPlatformScope("tenant cache test teardown", async (tx) => {
    for (const slug of createdSlugs.splice(0)) {
      await tx.delete(organisations).where(eq(organisations.slug, slug));
    }
  });
  clearTenantCache();
});

const HOST_SUFFIX = ".localhost:3000";

describe("tenant resolution against the database", () => {
  it("finds a tenant that has just been created, without waiting out a cached miss", async () => {
    const slug = `cachetest${Date.now()}`;
    createdSlugs.push(slug);

    // Somebody hits the address before the tenant exists — a miss is cached.
    expect(await resolveTenant(`${slug}${HOST_SUFFIX}`)).toBeNull();

    await withPlatformScope("tenant cache test fixture", (tx) =>
      tx.insert(organisations).values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Freshly Provisioned",
        status: "active",
      }),
    );

    // The miss must expire quickly. Four seconds covers the three-second
    // window with room for a slow machine.
    await new Promise((resolve) => setTimeout(resolve, 4_000));

    const resolved = await resolveTenant(`${slug}${HOST_SUFFIX}`);
    expect(resolved?.displayName).toBe("Freshly Provisioned");
  });

  it("does not resolve a suspended tenant, so its people cannot reach a login form", async () => {
    const slug = `suspended${Date.now()}`;
    createdSlugs.push(slug);

    await withPlatformScope("tenant cache test fixture", (tx) =>
      tx.insert(organisations).values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Suspended Client",
        status: "suspended",
      }),
    );
    clearTenantCache();

    expect(await resolveTenant(`${slug}${HOST_SUFFIX}`)).toBeNull();
  });

  /**
   * The platform host resolves to ROFT's own organisation rather than to
   * nothing. ROFT is a tenant like any other — its people sign in the same
   * way — and what marks the Platform Owner out is the permissions they hold,
   * not a separate, less-tested door into the system.
   *
   * This asserted the opposite until the Platform Owner console was built.
   */
  it("resolves the platform host to ROFT's own organisation", async () => {
    const slug = process.env.PLATFORM_ORG_SLUG ?? "roft";

    const [exists] = await withPlatformScope(
      "checking whether the platform organisation is seeded",
      (tx) =>
        tx
          .select({ id: organisations.id })
          .from(organisations)
          .where(eq(organisations.slug, slug)),
    );

    if (!exists) {
      // A database seeded before ROFT existed. Nothing to assert beyond the
      // fallback, which is the same as any unknown hostname.
      expect(await resolveTenant("localhost:3000")).toBeNull();
      return;
    }

    const resolved = await resolveTenant("localhost:3000");
    expect(resolved?.slug).toBe(slug);
  });

  it("still returns nothing for a hostname belonging to nobody", async () => {
    expect(await resolveTenant("nosuchclient.localhost:3000")).toBeNull();
  });

  it("carries the tenant's own branding, not ROFT's", async () => {
    const slug = `branded${Date.now()}`;
    createdSlugs.push(slug);

    await withPlatformScope("tenant cache test fixture", (tx) =>
      tx.insert(organisations).values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Harbour Training Centre",
        status: "active",
        primaryColour: "#123d33",
        accentColour: "#d98032",
      }),
    );
    clearTenantCache();

    const resolved = await resolveTenant(`${slug}${HOST_SUFFIX}`);
    expect(resolved?.primaryColour).toBe("#123d33");
    expect(resolved?.accentColour).toBe("#d98032");
  });
});
