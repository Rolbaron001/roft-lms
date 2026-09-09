/**
 * Part qualifications: one curriculum, a subset of it, and the arithmetic.
 *
 * The shape under test was settled by the documents rather than chosen. The
 * curriculum document and the assessment specification filed under SAQA
 * 118710 are byte-identical to the ones under 118709 - the same file, filed
 * twice - and 118710's own SAQA document lists the parent's module codes and
 * states a credit total of 47 that its listed modules add up to exactly.
 *
 * So the tests below are really three assertions about the real world: a part
 * has no curriculum of its own, it may only take modules its parent has, and
 * the credit total on the document can be checked instead of believed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  assessmentCriteria,
  curriculumModules,
  organisations,
  programmeDocuments,
  qualifications,
  userRoles,
  users,
} from "@/db/schema";
import {
  creditsAgree,
  modulesOf,
  PartQualificationError,
  partsOf,
  selectModules,
} from "@/lib/part-qualifications";
import { programmeReadiness } from "@/lib/programme-readiness";
import { criterionCoverage } from "@/lib/programme-reports";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let learner: AuthenticatedSession;

function suffix() {
  return Math.random().toString(36).slice(2, 8);
}

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

/**
 * Commercial Cleaner, in miniature.
 *
 * Real module codes and real credit values, taken from the documents in
 * `Design/Part Qualifications/`, because the arithmetic below is the point and
 * inventing numbers would test nothing.
 */
const PARENT_MODULES = [
  { code: "811201-000-00-KM-01", component: "knowledge" as const, credits: 6 },
  { code: "811201-000-00-KM-04", component: "knowledge" as const, credits: 5 },
  { code: "811201-000-00-KM-05", component: "knowledge" as const, credits: 5 },
  { code: "811201-000-00-PM-01", component: "practical" as const, credits: 14 },
  { code: "811201-000-00-WM-01", component: "workplace" as const, credits: 17 },
  { code: "811201-000-00-KM-09", component: "knowledge" as const, credits: 8 },
];

/** The three knowledge modules, the practical and the workplace: 16+14+17. */
const KITCHENETTE_CODES = PARENT_MODULES.filter(
  (module) => module.code !== "811201-000-00-KM-09",
).map((module) => module.code);

async function buildFamily(options: { partCredits?: number } = {}) {
  return withTenant(organisationId, async (tx) => {
    const code = `811201-000-00-${suffix()}`;

    const [parent] = await tx
      .insert(qualifications)
      .values({
        organisationId,
        title: `Commercial Cleaner ${suffix()}`,
        kind: "full",
        saqaId: `parent-${suffix()}`,
        curriculumCode: code,
        totalCredits: 55,
      })
      .returning({ id: qualifications.id });

    for (const kind of [
      "qualification_document",
      "curriculum_document",
      "assessment_specification",
    ] as const) {
      await tx.insert(programmeDocuments).values({
        organisationId,
        qualificationId: parent.id,
        kind,
        title: kind,
        filename: `${kind}.pdf`,
        storageKey: `key-${suffix()}`,
        mimeType: "application/pdf",
        sizeBytes: 1,
        sha256: "a".repeat(64),
      });
    }

    const modules: Record<string, string> = {};
    for (const spec of PARENT_MODULES) {
      const [row] = await tx
        .insert(curriculumModules)
        .values({
          organisationId,
          qualificationId: parent.id,
          component: spec.component,
          code: spec.code,
          title: spec.code,
          credits: spec.credits,
        })
        .returning({ id: curriculumModules.id });

      // One criterion each, so the reports below have something to count.
      await tx.insert(assessmentCriteria).values({
        organisationId,
        curriculumModuleId: row.id,
        code: `IAC-${spec.code}`,
        description: "Something a learner must demonstrate.",
      });

      modules[spec.code] = row.id;
    }

    const [part] = await tx
      .insert(qualifications)
      .values({
        organisationId,
        title: `Commercial Kitchenette Cleaner ${suffix()}`,
        kind: "part",
        parentQualificationId: parent.id,
        saqaId: `part-${suffix()}`,
        // The same curriculum code as its parent. This is the case the
        // unconditional unique index used to make impossible.
        curriculumCode: code,
        totalCredits: options.partCredits ?? 47,
      })
      .returning({ id: qualifications.id });

    return { parentId: parent.id, partId: part.id, modules };
  });
}

beforeAll(async () => {
  const slug = `parts-${Date.now()}`;

  organisationId = await withPlatformScope(
    "part qualification setup",
    async (tx) => {
      const [organisation] = await tx
        .insert(organisations)
        .values({
          slug,
          legalName: `${slug} Ltd`,
          displayName: "Part Qualification Test Co",
          status: "active",
        })
        .returning({ id: organisations.id });
      return organisation.id;
    },
  );

  const made = await withPlatformScope(
    "part qualification fixture",
    async (tx) => {
      const ids: string[] = [];
      for (const [email, role] of [
        ["admin@parts.test", "tenant_admin"],
        ["learner@parts.test", "learner"],
      ] as const) {
        const [user] = await tx
          .insert(users)
          .values({
            organisationId,
            email,
            firstName: "Part",
            lastName: "Tester",
            status: "active",
          })
          .returning({ id: users.id });
        await tx
          .insert(userRoles)
          .values({ organisationId, userId: user.id, role });
        ids.push(user.id);
      }
      return ids;
    },
  );

  admin = sessionFor(["tenant_admin"], made[0]);
  learner = sessionFor(["learner"], made[1]);
});

afterAll(async () => {
  await withPlatformScope("part qualification teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("two qualifications sharing one curriculum code", () => {
  /**
   * The database has to permit it, even though the published documents turn
   * out not to need it.
   *
   * 118709 states its curriculum code as 811201-000-00 and 118710 states
   * 811201-000-01 - the numeric suffix Heidi described - so in that family the
   * codes differ. But nothing in the sub-framework requires the suffix, a
   * provider transcribing a part may well enter the parent's code, and the
   * modules 118710 lists all carry the parent's prefix. A unique index over
   * (organisation, curriculum code) would turn that into a constraint
   * violation on import rather than a wrong answer, which is worse: it stops
   * the work with a database error nobody can act on.
   */
  it("records a part under its parent's curriculum code", async () => {
    const { parentId, partId } = await buildFamily();

    const rows = await withTenant(organisationId, (tx) =>
      tx
        .select({
          id: qualifications.id,
          code: qualifications.curriculumCode,
          kind: qualifications.kind,
        })
        .from(qualifications)
        .where(eq(qualifications.parentQualificationId, parentId)),
    );

    const [parent] = await withTenant(organisationId, (tx) =>
      tx
        .select({ code: qualifications.curriculumCode })
        .from(qualifications)
        .where(eq(qualifications.id, parentId)),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(partId);
    expect(rows[0].code).toBe(parent.code);
  });

  it("shows a provider which parts came out of a qualification", async () => {
    const { parentId, partId } = await buildFamily();
    const parts = await partsOf(admin, parentId);

    expect(parts.map((row) => row.id)).toEqual([partId]);
    expect(parts[0].kind).toBe("part");
  });
});

describe("the modules a part is assessed against", () => {
  it("is the whole curriculum for a full qualification", async () => {
    const { parentId } = await buildFamily();
    const modules = await modulesOf(admin, parentId);
    expect(modules).toHaveLength(PARENT_MODULES.length);
  });

  it("is nothing at all until somebody selects", async () => {
    const { partId } = await buildFamily();
    expect(await modulesOf(admin, partId)).toHaveLength(0);
  });

  it("is the selected subset once they have", async () => {
    const { partId, modules } = await buildFamily();
    await selectModules(
      admin,
      partId,
      KITCHENETTE_CODES.map((code) => modules[code]),
    );

    const selected = await modulesOf(admin, partId);
    expect(selected.map((module) => module.code).sort()).toEqual(
      [...KITCHENETTE_CODES].sort(),
    );
  });

  /**
   * Re-reading a corrected SAQA document should produce that document's
   * subset, not the union of both readings. A part that quietly grew by three
   * modules would report a credit total nobody typed and nobody could explain.
   */
  it("replaces the selection rather than adding to it", async () => {
    const { partId, modules } = await buildFamily();

    await selectModules(admin, partId, [
      modules["811201-000-00-KM-01"],
      modules["811201-000-00-KM-09"],
    ]);
    await selectModules(admin, partId, [modules["811201-000-00-KM-01"]]);

    const selected = await modulesOf(admin, partId);
    expect(selected.map((module) => module.code)).toEqual([
      "811201-000-00-KM-01",
    ]);
  });

  it("refuses a module the parent does not have", async () => {
    const { partId } = await buildFamily();
    const stranger = await buildFamily();

    await expect(
      selectModules(admin, partId, [stranger.modules["811201-000-00-KM-01"]]),
    ).rejects.toMatchObject({ code: "not_in_parent" });
  });

  it("refuses to give a full qualification a selection", async () => {
    const { parentId, modules } = await buildFamily();

    await expect(
      selectModules(admin, parentId, [modules["811201-000-00-KM-01"]]),
    ).rejects.toBeInstanceOf(PartQualificationError);
  });

  it("is not something a learner may change", async () => {
    const { partId, modules } = await buildFamily();
    await expect(
      selectModules(learner, partId, [modules["811201-000-00-KM-01"]]),
    ).rejects.toThrow();
  });
});

describe("checking the credit total instead of believing it", () => {
  /** 16 + 14 + 17 = 47, which is what SAQA 118710 states. */
  it("agrees when the subset adds up to what the document claims", async () => {
    const { partId, modules } = await buildFamily();
    await selectModules(
      admin,
      partId,
      KITCHENETTE_CODES.map((code) => modules[code]),
    );

    const check = await creditsAgree(admin, partId);
    expect(check.fromModules).toBe(47);
    expect(check.claimed).toBe(47);
    expect(check.agree).toBe(true);
    expect(check.perComponent).toEqual({
      knowledge: 16,
      practical: 14,
      workplace: 17,
    });
  });

  it("reports a mismatch rather than refusing to hold it", async () => {
    const { partId, modules } = await buildFamily({ partCredits: 60 });
    await selectModules(
      admin,
      partId,
      KITCHENETTE_CODES.map((code) => modules[code]),
    );

    const check = await creditsAgree(admin, partId);
    expect(check.agree).toBe(false);
    expect(check.claimed).toBe(60);
    expect(check.fromModules).toBe(47);
  });
});

describe("readiness, for something with no curriculum document of its own", () => {
  /**
   * The bug this was written against: readiness demanded three published
   * documents filed against the qualification itself, so no part qualification
   * could ever have become ready. Not a strict rule - an impossible one.
   */
  it("accepts the parent's documents and curriculum", async () => {
    const { partId, modules } = await buildFamily();
    await selectModules(
      admin,
      partId,
      KITCHENETTE_CODES.map((code) => modules[code]),
    );

    const readiness = await programmeReadiness(admin, partId);
    const what = readiness.gaps.map((gap) => gap.what).join(" ");

    expect(what).not.toContain("Curriculum Document");
    expect(what).not.toContain("Qualification Document");
    expect(what).not.toContain("Assessment Specification");
  });

  /** But it counts the part's own subset, not everything the parent has. */
  it("counts the subset, not the parent's whole curriculum", async () => {
    const { parentId, partId, modules } = await buildFamily();
    await selectModules(admin, partId, [modules["811201-000-00-KM-01"]]);

    const part = await programmeReadiness(admin, partId);
    const parent = await programmeReadiness(admin, parentId);

    expect(part.curriculum.modules).toBe(1);
    expect(parent.curriculum.modules).toBe(PARENT_MODULES.length);
  });
});

/**
 * The sweep, locked in.
 *
 * Four places outside readiness ask a qualification for its modules and meant
 * the whole curriculum: the EISA calculation, criterion coverage, what a
 * document may be attached to, and the alignment matrix. Each one read the
 * curriculum directly, which for a part returns nothing at all - so a part
 * reported no criteria, no coverage and nothing to be assessed on, and looked
 * like a qualification nobody had finished setting up.
 *
 * This covers the one whose arithmetic a person actually reads. If it breaks,
 * check the other three: they share `modulesOfCondition`.
 */
describe("reports over a part", () => {
  it("counts the criteria of the modules it takes, and no others", async () => {
    const { parentId, partId, modules } = await buildFamily();
    await selectModules(
      admin,
      partId,
      KITCHENETTE_CODES.map((code) => modules[code]),
    );

    const forPart = await criterionCoverage(admin, partId);
    const forParent = await criterionCoverage(admin, parentId);

    expect(forPart).toHaveLength(KITCHENETTE_CODES.length);
    expect(forParent).toHaveLength(PARENT_MODULES.length);

    // The module the part does not take must not appear in its coverage.
    expect(forPart.map((row) => row.moduleCode)).not.toContain(
      "811201-000-00-KM-09",
    );
  });
});
