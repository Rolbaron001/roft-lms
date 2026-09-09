/**
 * Importing Commercial Cleaner and then one of its parts, from the published
 * documents themselves.
 *
 * The fixtures are the real SAQA and curriculum documents. There is only one
 * curriculum fixture because there is only one curriculum: the file filed under
 * 118710 is byte-identical to the one under 118709 - same MD5 - which is the
 * fact the whole part-qualification model rests on. The test uses the same file
 * for both imports because that is what a provider's folders actually contain.
 *
 * What this proves that the unit tests cannot: that the platform reads "this is
 * a part", finds its parent, matches nine module codes against the parent's
 * curriculum, and creates the part without a second copy of anything.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  curriculumModules,
  organisations,
  qualifications,
  userRoles,
  users,
} from "@/db/schema";
import {
  createQualificationFromDocuments,
  readQualificationSources,
} from "@/lib/qualification-from-document";
import { creditsAgree, modulesOf } from "@/lib/part-qualifications";
import { programmeReadiness } from "@/lib/programme-readiness";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let author: AuthenticatedSession;
let parentId: string;

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

function fixture(name: string) {
  return {
    filename: name,
    bytes: new Uint8Array(readFileSync(join(__dirname, "fixtures", name))),
  };
}

/** The one curriculum. Both 118709 and 118710 file this exact document. */
const CURRICULUM = () => fixture("118709-curriculum.pdf");

beforeAll(async () => {
  const slug = `partimport-${Date.now()}`;

  organisationId = await withPlatformScope("part import setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Part Import Test Co",
        status: "active",
      })
      .returning({ id: organisations.id });
    return organisation.id;
  });

  const userId = await withPlatformScope("part import fixture", async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        organisationId,
        email: "author@partimport.test",
        firstName: "Author",
        lastName: "Tester",
        status: "active",
      })
      .returning({ id: users.id });
    await tx
      .insert(userRoles)
      .values({ organisationId, userId: user.id, role: "tenant_admin" });
    return user.id;
  });

  author = sessionFor(["tenant_admin"], userId);

  const parent = await createQualificationFromDocuments(
    author,
    {
      curriculum: CURRICULUM(),
      qualification: fixture("118709-qualification.pdf"),
    },
    {
      title: "Occupational Certificate: Commercial Cleaner",
      curriculumCode: "811201-000-00",
      saqaId: "118709",
      totalCredits: 120,
    },
  );

  parentId = parent.qualificationId;
}, 120_000);

afterAll(async () => {
  await withPlatformScope("part import teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("reading a part's documents", () => {
  it("recognises 118710 as a part of what is already there", async () => {
    const reading = await readQualificationSources(author, {
      curriculum: CURRICULUM(),
      qualification: fixture("118710-qualification.pdf"),
    });

    expect(reading.details.kind).toBe("part");
    expect(reading.details.saqaId).toBe("118710");
    expect(reading.details.totalCredits).toBe(47);

    expect(reading.part).not.toBeNull();
    expect(reading.part!.parent.id).toBe(parentId);
  });

  /**
   * Nine codes, every one of them found in the parent's curriculum - including
   * the two the document mistypes with a doubled hyphen. A module not matched
   * here is a module the part would silently not be assessed against.
   */
  it("matches every module its rules name to the parent's curriculum", async () => {
    const reading = await readQualificationSources(author, {
      curriculum: CURRICULUM(),
      qualification: fixture("118710-qualification.pdf"),
    });

    expect(reading.part!.modules).toHaveLength(9);
    expect(reading.part!.modules.every((entry) => entry.found)).toBe(true);
  });

  it("still refuses a full qualification imported twice", async () => {
    const reading = await readQualificationSources(author, {
      curriculum: CURRICULUM(),
      qualification: fixture("118709-qualification.pdf"),
    });

    expect(reading.details.kind).toBe("full");
    expect(reading.part).toBeNull();
    expect(reading.existing?.id).toBe(parentId);
  });
});

describe("creating the part", () => {
  it("attaches it to the parent and takes nine of its modules", async () => {
    const { qualificationId, summary } = await createQualificationFromDocuments(
      author,
      {
        curriculum: CURRICULUM(),
        qualification: fixture("118710-qualification.pdf"),
      },
      {
        title: "Occupational Certificate: Commercial Kitchenette Cleaner",
        curriculumCode: "811201-000-00",
        saqaId: "118710",
        totalCredits: 47,
      },
    );

    const [created] = await withTenant(organisationId, (tx) =>
      tx
        .select({
          kind: qualifications.kind,
          parentId: qualifications.parentQualificationId,
          curriculumCode: qualifications.curriculumCode,
        })
        .from(qualifications)
        .where(eq(qualifications.id, qualificationId)),
    );

    expect(created.kind).toBe("part");
    expect(created.parentId).toBe(parentId);
    // The parent's code, shared rather than duplicated.
    expect(created.curriculumCode).toBe("811201-000-00");
    expect(summary.modules).toBe(9);

    const chosen = await modulesOf(author, qualificationId);
    expect(chosen).toHaveLength(9);
  }, 120_000);

  /**
   * The thing this whole design exists to prevent: two copies of one
   * curriculum. If the part had imported its own, the tenant would hold
   * forty-four modules under one curriculum code and a learner's work would be
   * marked complete in one ledger and not the other.
   */
  it("creates no second copy of the curriculum", async () => {
    const parentModules = await withTenant(organisationId, (tx) =>
      tx
        .select({ id: curriculumModules.id })
        .from(curriculumModules)
        .where(eq(curriculumModules.qualificationId, parentId)),
    );

    const all = await withTenant(organisationId, (tx) =>
      tx.select({ id: curriculumModules.id }).from(curriculumModules),
    );

    expect(all).toHaveLength(parentModules.length);
    expect(parentModules).toHaveLength(22);
  });

  /** 16 + 14 + 17 = 47, which is what 118710 states under Minimum Credits. */
  it("adds up to the credit total the document claims", async () => {
    const [part] = await withTenant(organisationId, (tx) =>
      tx
        .select({ id: qualifications.id })
        .from(qualifications)
        .where(eq(qualifications.saqaId, "118710")),
    );

    const check = await creditsAgree(author, part.id);

    expect(check.fromModules).toBe(47);
    expect(check.claimed).toBe(47);
    expect(check.agree).toBe(true);
    expect(check.perComponent).toEqual({
      knowledge: 16,
      practical: 14,
      workplace: 17,
    });
  });

  /**
   * And it is usable. Readiness reads the parent's filed documents and the
   * part's own module selection, so a part imported this way is ready for
   * material immediately - as a full qualification imported this way is.
   */
  it("is ready for material without documents of its own", async () => {
    const [part] = await withTenant(organisationId, (tx) =>
      tx
        .select({ id: qualifications.id })
        .from(qualifications)
        .where(eq(qualifications.saqaId, "118710")),
    );

    const readiness = await programmeReadiness(author, part.id);
    const what = readiness.gaps.map((gap) => gap.what).join(" ");

    expect(what).not.toContain("Curriculum Document");
    expect(readiness.curriculum.modules).toBe(9);
  });
});
