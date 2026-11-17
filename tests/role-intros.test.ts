/**
 * Heidi, 13 November 2026 (job sheet D50): every role is introduced on Home
 * with what it can do, and a provider may make Facilitator and Assessor one
 * role, "Facilitator / Assessor".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import { organisations, userRoles, users } from "@/db/schema";
import { hashPassword } from "@/lib/password";
import { permissionsFor, type Role } from "@/lib/rbac";
import { displayRoles, roleLabelKey, withCombined } from "@/lib/roles";
import { INTRO_ITEMS, introsFor, itemsFor } from "@/lib/role-intros";
import { resolveSession, setActingRole, signIn, type AuthenticatedSession } from "@/lib/session";
import { setTenantCombinedRoles } from "@/lib/provisioning";
import { setRoles } from "@/lib/people";
import { en } from "@/lib/i18n/en";

describe("the introductions", () => {
  it("has a welcome and a title for every introduction, and words for every item", () => {
    const catalogue = en as Record<string, string>;
    for (const [key, items] of Object.entries(INTRO_ITEMS)) {
      expect(catalogue[`intro.${key}.title`], key).toBeTruthy();
      expect(catalogue[`intro.${key}.welcome`], key).toBeTruthy();
      for (const one of items) expect(catalogue[`intro.item.${one.key}`], one.key).toBeTruthy();
    }
  });

  it("uses Heidi's wording for the roles she named", () => {
    const catalogue = en as Record<string, string>;
    expect(catalogue["intro.facilitatorAssessor.welcome"]).toMatch(/^Welcome to the Facilitator & Assessor Portal\./);
    expect(catalogue["intro.moderator.welcome"]).toMatch(/uphold the integrity, fairness, and consistency/);
    expect(catalogue["intro.coach.welcome"]).toMatch(/link between theoretical learning/);
  });

  it("gives one introduction to the pair when combined, and two when not", () => {
    expect(introsFor(["instructor", "assessor"], true)).toEqual(["facilitatorAssessor"]);
    expect(introsFor(["instructor", "assessor"], false)).toEqual(["facilitator", "assessor"]);
    expect(introsFor(["tenant_admin", "learner"], false)).toEqual(["admin", "learner"]);
  });

  it("lists only what the person can open", () => {
    const facilitator = itemsFor("facilitatorAssessor", permissionsFor({ roles: ["instructor"] })).map((one) => one.key);
    expect(facilitator).toContain("classes");
    expect(facilitator).not.toContain("assess");
    const both = itemsFor("facilitatorAssessor", permissionsFor({ roles: ["instructor", "assessor"] })).map((one) => one.key);
    expect(both).toContain("assess");
  });
});

describe("Facilitator and Assessor as one role", () => {
  it("shows one badge and one name for the pair", () => {
    expect(withCombined(["instructor"], true).sort()).toEqual(["assessor", "instructor"]);
    expect(withCombined(["instructor"], false)).toEqual(["instructor"]);
    expect(displayRoles(["tenant_admin", "instructor", "assessor"], true)).toEqual(["tenant_admin", "instructor"]);
    expect(roleLabelKey("assessor", true)).toBe("role.facilitatorAssessor");
    expect(roleLabelKey("assessor", false)).toBe("role.assessor");
  });

  const PASSWORD = "correct-horse-battery";
  let organisationId: string;
  let admin: AuthenticatedSession;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const passwordHash = await hashPassword(PASSWORD);
    await withPlatformScope("combined roles test fixture", async (tx) => {
      const [org] = await tx
        .insert(organisations)
        .values({ slug: `combined-${Date.now()}`, legalName: "Combined Ltd", displayName: "Combined", status: "active" })
        .returning({ id: organisations.id });
      organisationId = org.id;
      const people: [string, Role[]][] = [["admin", ["tenant_admin"]], ["facilitator", ["instructor"]], ["assessor", ["assessor"]], ["both", ["tenant_admin", "instructor"]]];
      for (const [name, roles] of people) {
        const [user] = await tx
          .insert(users)
          .values({ organisationId: org.id, email: `${name}@combined.test`, passwordHash, firstName: name, lastName: "Test", status: "active" })
          .returning({ id: users.id });
        ids[name] = user.id;
        for (const role of roles) await tx.insert(userRoles).values({ organisationId: org.id, userId: user.id, role });
      }
    });
    admin = {
      sessionId: "00000000-0000-0000-0000-000000000000",
      userId: ids.admin,
      organisationId,
      email: "admin@combined.test",
      firstName: "admin",
      lastName: "Test",
      roles: ["tenant_admin"],
      permissions: permissionsFor({ roles: ["tenant_admin"] }),
      mustChangePassword: false,
      aiOn: false,
    };
  });

  afterAll(async () => {
    await withPlatformScope("combined roles test teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
  });

  const stored = (userId: string) =>
    withTenant(organisationId, async (tx) =>
      (await tx.select({ role: userRoles.role }).from(userRoles).where(and(eq(userRoles.userId, userId), isNull(userRoles.revokedAt)))).map((row) => row.role).sort(),
    );

  it("gives everyone holding one of the pair the other when switched on", async () => {
    const { granted } = await setTenantCombinedRoles(admin, true);
    expect(granted).toBe(3);
    expect(await stored(ids.facilitator)).toEqual(["assessor", "instructor"]);
    expect(await stored(ids.assessor)).toEqual(["assessor", "instructor"]);
    expect(await stored(ids.admin)).toEqual(["tenant_admin"]);
  });

  it("stores both when one is given, and removes both when it is taken away", async () => {
    await setRoles(admin, ids.facilitator, ["learner", "instructor"]);
    expect(await stored(ids.facilitator)).toEqual(["assessor", "instructor", "learner"]);
    await setRoles(admin, ids.facilitator, ["learner"]);
    expect(await stored(ids.facilitator)).toEqual(["learner"]);
  });

  it("works as both when the combined role is chosen", async () => {
    const result = await signIn(organisationId, "both@combined.test", PASSWORD);
    if (!result.ok) throw new Error("sign-in failed");
    const session = (await resolveSession(organisationId, result.token))!;
    await setActingRole(session, "instructor");
    const acting = (await resolveSession(organisationId, result.token))!;
    expect(acting.roles.sort()).toEqual(["assessor", "instructor"]);
    expect(acting.permissions).toContain("assessment:assess");
    expect(acting.permissions).not.toContain("tenant:manage_settings");
  });

  it("takes nothing away when switched off", async () => {
    await setTenantCombinedRoles(admin, false);
    expect(await stored(ids.assessor)).toEqual(["assessor", "instructor"]);
  });
});
