/**
 * Working in one role at a time (Heidi, 30 October 2026): a person with
 * several roles chooses one from the badges on their home page and works in
 * it alone, returns to all of them at will, and starts every new sitting with
 * all of them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { organisations, userRoles, users } from "@/db/schema";
import { hashPassword } from "@/lib/password";
import { resolveSession, setActingRole, signIn, signOut } from "@/lib/session";

const PASSWORD = "correct-horse-battery";
let organisationId: string;

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  organisationId = await withPlatformScope("acting role test fixture", async (tx) => {
    const [org] = await tx
      .insert(organisations)
      .values({ slug: `acting-${Date.now()}`, legalName: "Acting Ltd", displayName: "Acting", status: "active" })
      .returning({ id: organisations.id });
    const [admin] = await tx
      .insert(users)
      .values({ organisationId: org.id, email: "many@acting.test", passwordHash, firstName: "Many", lastName: "Roles", status: "active" })
      .returning({ id: users.id });
    for (const role of ["tenant_admin", "instructor"] as const) await tx.insert(userRoles).values({ organisationId: org.id, userId: admin.id, role });
    const [learner] = await tx
      .insert(users)
      .values({ organisationId: org.id, email: "one@acting.test", passwordHash, firstName: "One", lastName: "Role", status: "active" })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({ organisationId: org.id, userId: learner.id, role: "learner" });
    return org.id;
  });
});

afterAll(async () => {
  await withPlatformScope("acting role test teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

async function signedIn(email: string) {
  const result = await signIn(organisationId, email, PASSWORD);
  if (!result.ok) throw new Error("sign-in failed");
  const session = await resolveSession(organisationId, result.token);
  if (!session) throw new Error("no session");
  return { token: result.token, session };
}

describe("working in one role", () => {
  it("starts with every role", async () => {
    const { session } = await signedIn("many@acting.test");
    expect(session.roles.sort()).toEqual(["instructor", "tenant_admin"]);
    expect(session.actingRole).toBeNull();
    expect(session.permissions).toContain("tenant:manage_settings");
  });

  it("narrows to the chosen role, keeps the full set for the badges, and returns to all", async () => {
    const { token, session } = await signedIn("many@acting.test");
    await setActingRole(session, "instructor");
    const acting = (await resolveSession(organisationId, token))!;
    expect(acting.roles).toEqual(["instructor"]);
    expect(acting.actingRole).toBe("instructor");
    expect(acting.heldRoles?.sort()).toEqual(["instructor", "tenant_admin"]);
    expect(acting.permissions).toContain("session:manage");
    expect(acting.permissions).not.toContain("tenant:manage_settings");

    await setActingRole(acting, null);
    const all = (await resolveSession(organisationId, token))!;
    expect(all.roles.sort()).toEqual(["instructor", "tenant_admin"]);
    expect(all.actingRole).toBeNull();
  });

  it("refuses a role the person does not hold", async () => {
    const { session } = await signedIn("many@acting.test");
    await expect(setActingRole(session, "assessor")).rejects.toThrow();
  });

  it("drops the chosen role when the person signs out and in again", async () => {
    const first = await signedIn("many@acting.test");
    await setActingRole(first.session, "instructor");
    await signOut(organisationId, first.token);
    const second = await signedIn("many@acting.test");
    expect(second.session.actingRole).toBeNull();
    expect(second.session.roles.sort()).toEqual(["instructor", "tenant_admin"]);
  });

  it("forgets a chosen role the person no longer holds", async () => {
    const { token, session } = await signedIn("many@acting.test");
    await setActingRole(session, "instructor");
    await withPlatformScope("acting role test: role withdrawn", (tx) =>
      tx.update(userRoles).set({ revokedAt: new Date() }).where(and(eq(userRoles.userId, session.userId), eq(userRoles.role, "instructor"))),
    );
    const after = (await resolveSession(organisationId, token))!;
    expect(after.actingRole).toBeNull();
    expect(after.roles).toEqual(["tenant_admin"]);
  });

  it("has nothing to choose for a person with one role", async () => {
    const { token, session } = await signedIn("one@acting.test");
    await setActingRole(session, "learner");
    const after = (await resolveSession(organisationId, token))!;
    expect(after.actingRole).toBeNull();
    expect(after.roles).toEqual(["learner"]);
  });
});
