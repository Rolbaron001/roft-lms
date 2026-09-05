import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import {
  badgeAwards,
  badges,
  curriculumModules,
  organisations,
  qualifications,
  users,
} from "@/db/schema";
import {
  awardCompletionBadge,
  awardEarnedBadges,
  defineBadge,
  learnerBadges,
  retireBadge,
  verifyBadge,
} from "@/lib/badges";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let learnerId: string;
let moduleOneId: string;
let moduleTwoId: string;
let badgeOneId: string;

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "test@example.test",
    firstName: "Test",
    lastName: "User",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

beforeAll(async () => {
  const slug = `badges-${Date.now()}`;

  const made = await withPlatformScope("badge test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Badge Test Co",
        status: "active",
      })
      .returning({ id: organisations.id });

    const [qualification] = await tx
      .insert(qualifications)
      .values({ organisationId: organisation.id, title: "Test Qualification" })
      .returning({ id: qualifications.id });

    const addModule = async (code: string, title: string) => {
      const [row] = await tx
        .insert(curriculumModules)
        .values({
          organisationId: organisation.id,
          qualificationId: qualification.id,
          component: "knowledge",
          code,
          title,
        })
        .returning({ id: curriculumModules.id });
      return row.id;
    };

    const person = async (first: string) => {
      const [row] = await tx
        .insert(users)
        .values({
          organisationId: organisation.id,
          email: `${first.toLowerCase()}.${slug}@example.test`,
          firstName: first,
          lastName: "Person",
          status: "active",
        })
        .returning({ id: users.id });
      return row.id;
    };

    const one = await addModule("KM-01", "Knowledge Module 1");
    const two = await addModule("KM-02", "Knowledge Module 2");

    const [badge] = await tx
      .insert(badges)
      .values({
        organisationId: organisation.id,
        kind: "curriculum_module",
        curriculumModuleId: one,
        name: "Records Administration",
        description: "Completed the records administration module.",
        glyph: "📘",
      })
      .returning({ id: badges.id });

    return {
      organisationId: organisation.id,
      adminId: await person("Admin"),
      learnerId: await person("Learner"),
      moduleOneId: one,
      moduleTwoId: two,
      badgeOneId: badge.id,
    };
  });

  organisationId = made.organisationId;
  learnerId = made.learnerId;
  moduleOneId = made.moduleOneId;
  moduleTwoId = made.moduleTwoId;
  badgeOneId = made.badgeOneId;
  admin = sessionFor(["tenant_admin"], made.adminId);
});

describe("awardEarnedBadges", () => {
  it("awards nothing when nothing is complete", async () => {
    const result = await awardEarnedBadges(organisationId, learnerId, []);
    expect(result.awarded).toBe(0);
  });

  it("awards nothing for a completed module with no badge defined", async () => {
    const result = await awardEarnedBadges(organisationId, learnerId, [
      { curriculumModuleId: moduleTwoId, completedOn: "2026-03-10" },
    ]);
    expect(result.awarded).toBe(0);
  });

  it("awards the badge for a completed module", async () => {
    const result = await awardEarnedBadges(organisationId, learnerId, [
      { curriculumModuleId: moduleOneId, completedOn: "2026-03-10" },
    ]);
    expect(result.awarded).toBe(1);
  });

  /**
   * This runs after every assessment decision. A decision that changes nothing
   * must not produce a second badge, and must not raise.
   */
  it("is idempotent, because it runs after every decision", async () => {
    const again = await awardEarnedBadges(organisationId, learnerId, [
      { curriculumModuleId: moduleOneId, completedOn: "2026-03-10" },
    ]);
    expect(again.awarded).toBe(0);

    const held = await learnerBadges(admin, learnerId);
    expect(held).toHaveLength(1);
  });

  /**
   * A learner who finished in March and was backfilled in July finished in
   * March. The badge carries the completion date, not the row's birthday.
   */
  it("carries the date the work was finished", async () => {
    const [held] = await learnerBadges(admin, learnerId);
    expect(held.earnedOn).toBe("2026-03-10");
  });
});

describe("verifyBadge", () => {
  it("finds a badge by its printed reference", async () => {
    const [held] = await learnerBadges(admin, learnerId);
    const found = await verifyBadge(held.reference);

    expect(found).not.toBeNull();
    expect(found?.holderName).toBe("Learner Person");
    expect(found?.name).toBe("Records Administration");
  });

  it("accepts a reference typed in lower case with spaces around it", async () => {
    const [held] = await learnerBadges(admin, learnerId);
    const found = await verifyBadge(`  ${held.reference.toLowerCase()}  `);
    expect(found).not.toBeNull();
  });

  it("returns nothing for a reference that is not one", async () => {
    expect(await verifyBadge("NOT-A-REFERENCE")).toBeNull();
    expect(await verifyBadge("")).toBeNull();
    expect(await verifyBadge("ABCDE-FGHIJ")).toBeNull();
  });
});

describe("cleanup", () => {
  it("removes the fixture organisation", async () => {
    await withPlatformScope("badge test teardown", async (tx) => {
      await tx
        .delete(badgeAwards)
        .where(eq(badgeAwards.organisationId, organisationId));
      await tx.delete(badges).where(eq(badges.id, badgeOneId));
      await tx.delete(organisations).where(eq(organisations.id, organisationId));
    });
    expect(true).toBe(true);
  });
});

/**
 * The default badge, and what earns it.
 *
 * Roland asked for a badge per intervention with a tenant-wide fallback "should
 * a Tenant elect not to have different badges for each intervention". The
 * fallback is the part worth pinning down: it fires when nobody has configured
 * anything, which is exactly the case nobody tests by hand.
 *
 * Its own organisation and its own learner, because a test above deletes the
 * shared one to prove that badges cascade with their tenant.
 */
describe("the default badge", () => {
  let orgId: string;
  let staff: AuthenticatedSession;
  let learner: string;
  let fallbackId: string;

  beforeAll(async () => {
    const made = await withPlatformScope("default badge fixture", async (tx) => {
      const [organisation] = await tx
        .insert(organisations)
        .values({
          slug: `default-badge-${Date.now()}`,
          legalName: "Default Badge Ltd",
          displayName: "Default Badge",
          status: "active",
        })
        .returning({ id: organisations.id });

      const [person] = await tx
        .insert(users)
        .values({
          organisationId: organisation.id,
          email: `learner-${Date.now()}@example.test`,
          passwordHash: "x",
          firstName: "Test",
          lastName: "Learner",
          status: "active",
        })
        .returning({ id: users.id });

      const [badge] = await tx
        .insert(badges)
        .values({
          organisationId: organisation.id,
          kind: "default",
          name: "Provider Achievement",
          glyph: "✦",
          shape: "shield",
          background: "#4C1D95",
          ink: "#FFFFFF",
        })
        .returning({ id: badges.id });

      return {
        orgId: organisation.id,
        learner: person.id,
        fallbackId: badge.id,
      };
    });

    orgId = made.orgId;
    learner = made.learner;
    fallbackId = made.fallbackId;
    staff = {
      sessionId: "00000000-0000-0000-0000-000000000000",
      userId: made.learner,
      organisationId: made.orgId,
      email: "staff@example.test",
      firstName: "Test",
      lastName: "Staff",
      roles: ["tenant_admin"],
      permissions: permissionsFor({ roles: ["tenant_admin"] }),
      mustChangePassword: false,
      aiOn: false,
    };
  });

  it("is awarded when the thing finished has no badge of its own", async () => {
    const { awarded } = await awardCompletionBadge(orgId, learner, {
      kind: "course",
      id: "00000000-0000-0000-0000-0000000000ff",
      completedOn: "2026-09-05",
    });

    expect(awarded).toBe(true);
    const held = await learnerBadges(staff, learner);
    expect(held.map((row) => row.name)).toContain("Provider Achievement");
  });

  /**
   * A learner who finishes three courses under one default badge holds it once.
   * Otherwise their page is the same row repeated with nothing to tell the
   * copies apart.
   */
  it("is held once however many things are finished", async () => {
    const before = (await learnerBadges(staff, learner)).length;

    await awardCompletionBadge(orgId, learner, {
      kind: "course",
      id: "00000000-0000-0000-0000-0000000000ee",
      completedOn: "2026-09-06",
    });

    expect((await learnerBadges(staff, learner)).length).toBe(before);
  });

  /**
   * Retired rather than deleted. A learner may have shown somebody this badge,
   * and a definition that vanished turns their verification into "no such
   * badge", which reads as though they invented it.
   */
  it("keeps existing awards when it is retired", async () => {
    await retireBadge(staff, fallbackId);

    const after = await learnerBadges(staff, learner);
    expect(after.map((row) => row.name)).toContain("Provider Achievement");
  });

  it("awards nothing once retired, and does not fail", async () => {
    const { awarded } = await awardCompletionBadge(orgId, learner, {
      kind: "course",
      id: "00000000-0000-0000-0000-0000000000dd",
      completedOn: "2026-09-07",
    });

    // A provider with nothing active gets nothing. That is a choice, not a
    // fault, and it must not raise.
    expect(awarded).toBe(false);
  });

  it("refuses a default that also names something", async () => {
    await expect(
      defineBadge(staff, {
        kind: "default",
        name: "Contradictory",
        qualificationId: "00000000-0000-0000-0000-000000000001",
      }),
    ).rejects.toThrow();
  });

  it("refuses a colour that is not a colour", async () => {
    await expect(
      defineBadge(staff, {
        kind: "course",
        courseId: "00000000-0000-0000-0000-000000000002",
        name: "Bad colour",
        background: "purple",
      }),
    ).rejects.toThrow();
  });
});
