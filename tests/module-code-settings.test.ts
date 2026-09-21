/**
 * A tenant's module code table, against a live database.
 *
 * The pure rules are tested next door. This is the half that matters for
 * isolation and for trust: a table is per tenant, it is not used until a
 * person has confirmed it, and it cannot be edited into something that makes
 * one module match another.
 *
 * That last one is the reason the whole feature is gated behind a
 * confirmation. A wrong alias links a learner's evidence to the wrong half of
 * a curriculum and nothing on any screen looks amiss.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { organisations, userRoles, users } from "@/db/schema";
import { addCurriculumModule, createQualification } from "@/lib/authoring";
import {
  ModuleCodeError,
  moduleCodeAliasesFor,
  moduleCodesInUse,
  proposeModuleCodeTable,
  setModuleCodeAliases,
} from "@/lib/module-code-settings";
import { resolveCode } from "@/lib/module-codes";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let otherOrganisationId: string;
let admin: AuthenticatedSession;
let otherAdmin: AuthenticatedSession;

function sessionFor(
  roles: Role[],
  userId: string,
  orgId: string,
): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId: orgId,
    email: "admin@codes.test",
    firstName: "Code",
    lastName: "Table",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

async function makeTenant(slug: string) {
  return withPlatformScope("module code fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: slug,
        status: "active",
      })
      .returning({ id: organisations.id });

    const [person] = await tx
      .insert(users)
      .values({
        organisationId: organisation.id,
        email: `admin@${slug}.test`,
        firstName: "Code",
        lastName: "Table",
        status: "active",
      })
      .returning({ id: users.id });

    await tx.insert(userRoles).values({
      organisationId: organisation.id,
      userId: person.id,
      role: "tenant_admin",
    });

    return { orgId: organisation.id, userId: person.id };
  });
}

beforeAll(async () => {
  const stamp = Date.now();
  const mine = await makeTenant(`codes-${stamp}`);
  const theirs = await makeTenant(`codes-other-${stamp}`);

  organisationId = mine.orgId;
  otherOrganisationId = theirs.orgId;
  admin = sessionFor(["tenant_admin"], mine.userId, mine.orgId);
  otherAdmin = sessionFor(["tenant_admin"], theirs.userId, theirs.orgId);

  const qualification = await createQualification(admin, {
    title: "A qualification",
  });

  for (const code of ["KM01", "PM01", "WM01"]) {
    await addCurriculumModule(admin, {
      qualificationId: qualification.id,
      component: code.startsWith("KM")
        ? "knowledge"
        : code.startsWith("PM")
          ? "practical"
          : "workplace",
      code,
      title: `Module ${code}`,
    });
  }
}, 120_000);

afterAll(async () => {
  await withPlatformScope("module code teardown", async (tx) => {
    await tx.delete(organisations).where(eq(organisations.id, organisationId));
    await tx
      .delete(organisations)
      .where(eq(organisations.id, otherOrganisationId));
  });
});

describe("what the App proposes", () => {
  it("reads the codes from the curriculum rather than from a declaration", () => {
    // Proposing against a scheme somebody typed would describe an intention;
    // proposing against the loaded curriculum describes the provider.
    return expect(moduleCodesInUse(admin)).resolves.toEqual([
      "KM01",
      "PM01",
      "WM01",
    ]);
  });

  it("is not in force until somebody confirms it", async () => {
    const proposed = await proposeModuleCodeTable(admin);

    expect(proposed.rows).toHaveLength(3);
    expect(proposed.confirmed).toBe(false);
    // Proposed is not stored. Nothing matches differently until a person has
    // looked at the table, which is the whole reason for the modal.
    expect(await moduleCodeAliasesFor(admin)).toEqual({});
  });
});

describe("confirming a table", () => {
  it("stores it and uses it to resolve a code", async () => {
    const proposed = await proposeModuleCodeTable(admin);
    const table = Object.fromEntries(
      proposed.rows.map((row) => [row.canonical, row.aliases]),
    );

    await setModuleCodeAliases(admin, table);
    const stored = await moduleCodeAliasesFor(admin);

    expect(stored.KM01).toContain("KM1");
    expect(resolveCode("KM1", ["KM01", "PM01", "WM01"], stored)).toBe("KM01");
  });

  it("keeps a removed spelling removed", async () => {
    // Re-proposing it on every visit would undo the edit silently and
    // repeatedly, which is worse than never having offered it.
    await setModuleCodeAliases(admin, { KM01: ["KM001"] });

    const proposed = await proposeModuleCodeTable(admin);
    const km01 = proposed.rows.find((row) => row.canonical === "KM01");

    expect(km01?.aliases).toEqual(["KM001"]);
    expect(km01?.aliases).not.toContain("KM1");
  });

  it("refuses an alias that is a module code of its own", async () => {
    // It could never win - the resolver takes exact matches first - but it
    // would sit in the table looking as though it does.
    await expect(
      setModuleCodeAliases(admin, { KM01: ["PM01"] }),
    ).rejects.toThrow(ModuleCodeError);
  });

  it("refuses a spelling claimed by two modules", async () => {
    await expect(
      setModuleCodeAliases(admin, { KM01: ["ZZ9"], PM01: ["ZZ9"] }),
    ).rejects.toThrow(/only mean one module/i);
  });

  it("normalises what it stores, so punctuation cannot smuggle a duplicate", async () => {
    await setModuleCodeAliases(admin, { "km-01": ["k m 1", "K-M-1"] });
    const stored = await moduleCodeAliasesFor(admin);

    // Both spellings reduce to KM1, so one row and no duplicate.
    expect(stored).toEqual({ KM01: ["KM1"] });
  });
});

describe("one tenant's table is their own", () => {
  it("is not visible to another tenant", async () => {
    await setModuleCodeAliases(admin, { KM01: ["KM1"] });

    // Same module codes are entirely normal across providers - every QCTO
    // curriculum has a KM01. The spellings must not leak between them.
    expect(await moduleCodeAliasesFor(otherAdmin)).toEqual({});
  });

  it("does not offer another tenant's module codes", async () => {
    expect(await moduleCodesInUse(otherAdmin)).toEqual([]);
  });
});
