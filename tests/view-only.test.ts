/**
 * "Administrator View" (Roland, 10 October 2026): sees everything an
 * administrator sees and changes nothing. The lock is the database's, decided
 * from the session cookie and the person's roles, so these tests send a
 * cookie the way a browser would and try to write.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

let cookieToken: string | null = null;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "roft_lms_session" && cookieToken ? { value: cookieToken } : undefined),
  }),
}));

import { forgetViewOnly, withPlatformScope, withTenant } from "@/db/client";
import { organisations, sessions, userRoles, users } from "@/db/schema";
import { can, isViewOnly, PermissionDeniedError } from "@/lib/rbac";

let organisationId: string;
const people: Record<string, string> = {};
const tokens: Record<string, string> = {};

beforeAll(async () => {
  const slug = `viewonly-${Date.now()}`;
  await withPlatformScope("view-only test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: "View Only Co", status: "active" })
      .returning({ id: organisations.id });
    organisationId = organisation.id;
    for (const [name, roles] of [
      ["admin", ["tenant_admin"]],
      ["linda", ["tenant_viewer"]],
      ["mixed", ["tenant_viewer", "assessor"]],
    ] as const) {
      const [user] = await tx
        .insert(users)
        .values({ organisationId, email: `${name}-${slug}@example.test`, firstName: name, lastName: "Tester", status: "active" })
        .returning({ id: users.id });
      for (const role of roles) await tx.insert(userRoles).values({ organisationId, userId: user.id, role });
      people[name] = user.id;
      const token = `token-${name}-${slug}`;
      tokens[name] = token;
      const later = new Date(Date.now() + 60 * 60 * 1000);
      await tx.insert(sessions).values({
        organisationId,
        userId: user.id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        absoluteExpiresAt: later,
        idleExpiresAt: later,
      });
    }
  });
});

afterAll(async () => {
  cookieToken = null;
  await withPlatformScope("view-only test teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

async function rename(as: string, firstName: string, ownSitting = false) {
  cookieToken = tokens[as];
  return withTenant(organisationId, (tx) => tx.update(users).set({ firstName }).where(eq(users.id, people[as])), { ownSitting });
}

describe("Administrator View", () => {
  it("opens every screen an administrator's permissions open, without the extension", () => {
    expect(can({ roles: ["tenant_viewer"] }, "tenant:manage_settings")).toBe(true);
    expect(can({ roles: ["tenant_viewer"] }, "enrolment:read_all")).toBe(true);
    expect(can({ roles: ["tenant_viewer"] }, "extension:use")).toBe(false);
    expect(isViewOnly({ roles: ["tenant_viewer", "assessor"] })).toBe(true);
    expect(isViewOnly({ roles: ["tenant_admin"] })).toBe(false);
  });

  it("reads like anybody else", async () => {
    cookieToken = tokens.linda;
    const rows = await withTenant(organisationId, (tx) => tx.select({ id: users.id }).from(users));
    expect(rows).toHaveLength(3);
  });

  it("is refused every change by the database, even alongside another role", async () => {
    forgetViewOnly();
    // PostgreSQL's own refusal, said as a permission refusal so every action
    // that answers "Your role does not allow that" says so here too.
    await expect(rename("linda", "Changed")).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(rename("mixed", "Changed")).rejects.toThrow(/Administrator View can see this but not change it/);
  });

  it("may still do what belongs to their own sitting", async () => {
    await expect(rename("linda", "Linda", true)).resolves.toBeDefined();
  });

  it("stays signed in: the session is still found and kept alive", async () => {
    cookieToken = tokens.linda;
    const { resolveSession } = await import("@/lib/session");
    const session = await resolveSession(organisationId, tokens.linda);
    expect(session?.roles).toEqual(["tenant_viewer"]);
  });

  it("leaves an administrator free to change things", async () => {
    await expect(rename("admin", "Admin")).resolves.toBeDefined();
  });

  it("takes effect once the role is withdrawn, and not before", async () => {
    await withPlatformScope("view-only test withdraw", (tx) =>
      tx.update(userRoles).set({ revokedAt: new Date() }).where(eq(userRoles.userId, people.mixed)),
    );
    forgetViewOnly();
    await expect(rename("mixed", "Free")).resolves.toBeDefined();
  });
});
