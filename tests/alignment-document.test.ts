/**
 * The alignment document, and the one thing only it can tell the platform.
 *
 * Roland, 17 September: it "is almost on the same level as the 3 base
 * documents… when uploading and indexing a qualification this document (or
 * something similar) must guide the indexing of Modules and Study Units."
 *
 * The reason it has to is worth keeping in front of whoever changes this. A
 * curriculum document publishes modules and says nothing about study units,
 * because grouping modules into units that each serve one Exit Level Outcome
 * is the provider's own decision — two providers may group the same
 * qualification differently and both be correct. So the grouping cannot be
 * derived. It has to be supplied, and this is the document that supplies it.
 *
 * Until it is read, a study unit built from a filename is a label with
 * material hanging off it and no idea what it covers.
 *
 * Tested against Curiosa's real alignment document and their real curriculum,
 * because the shape of both is the whole difficulty.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  curriculumModules,
  exitLevelOutcomeCriteria,
  exitLevelOutcomes,
  organisations,
  studyUnitModules,
  studyUnits,
  userRoles,
  users,
} from "@/db/schema";
import { readAlignmentDocument } from "@/lib/alignment-document";
import { applyAlignmentDocument } from "@/lib/study-unit-alignment";
import {
  createQualificationFromDocuments,
  readQualificationSources,
} from "@/lib/qualification-from-document";
import { readDocxText } from "@/lib/office";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let qualificationId: string;

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "admin@example.test",
    firstName: "Align",
    lastName: "Ment",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(join(process.cwd(), "tests/fixtures", name)),
  );
}

const alignmentText = () => readDocxText(fixture("121151-alignment.docx"));

beforeAll(async () => {
  const slug = `align-${Date.now()}`;

  const made = await withPlatformScope("alignment fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Alignment Provider",
        status: "active",
      })
      .returning({ id: organisations.id });

    const [person] = await tx
      .insert(users)
      .values({
        organisationId: organisation.id,
        email: "admin@align.test",
        firstName: "Align",
        lastName: "Admin",
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

  organisationId = made.orgId;
  admin = sessionFor(["tenant_admin"], made.userId);

  // The curriculum first, because the alignment document names its modules.
  const documents = {
    qualification: {
      filename: "121151-qualification.pdf",
      bytes: fixture("121151-qualification.pdf"),
    },
    curriculum: {
      filename: "121151-curriculum.pdf",
      bytes: fixture("121151-curriculum.pdf"),
    },
  };
  const reading = await readQualificationSources(admin, documents);
  const created = await createQualificationFromDocuments(admin, documents, {
    title: reading.details.title ?? "HRM Officer",
    saqaId: reading.details.saqaId ?? undefined,
  });
  qualificationId = created.qualificationId;
}, 120_000);

afterAll(async () => {
  await withPlatformScope("alignment teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("reading it", () => {
  it("finds every study unit the document names", () => {
    const reading = readAlignmentDocument(alignmentText());

    expect(reading.studyUnits.map((one) => one.code)).toEqual([
      "SU1",
      "SU2",
      "SU3",
      "SU4",
      "SU5",
    ]);
    expect(reading.studyUnits[0].title).toBe("Organisational Architecture");
    expect(reading.studyUnits[2].title).toBe("Operationalising L&D");
  });

  /**
   * The alignment document writes KM-01; the curriculum document writes KM01.
   * Two house styles in two documents describing one qualification, and
   * nothing downstream should have to know that.
   */
  it("normalises module codes so the two documents agree", () => {
    const reading = readAlignmentDocument(alignmentText());

    expect(reading.studyUnits[0].moduleCodes).toEqual(["KM01", "PM01", "WM01"]);
  });

  it("reads the outcome each unit serves, and what it is judged by", () => {
    const reading = readAlignmentDocument(alignmentText());

    const first = reading.studyUnits[0].outcome!;
    expect(first.number).toBe(1);
    expect(first.credits).toBe(24);
    expect(first.description).toContain("workforce architecture");
    expect(first.criteria).toHaveLength(4);
    expect(first.criteria[0]).toContain("work profiles");

    // The level is stated on some outcomes and not on others. Null, not a
    // guess, where the document is silent.
    expect(first.nqfLevel).toBeNull();
    expect(reading.studyUnits[1].outcome!.nqfLevel).toBe(5);
  });

  it("has nothing to complain about in this one", () => {
    expect(readAlignmentDocument(alignmentText()).notes).toEqual([]);
  });

  it("refuses a document that is not one, rather than inventing units", () => {
    expect(() => readAlignmentDocument("A policy about leave.")).toThrow(
      /No study units/i,
    );
  });
});

describe("applying it to a qualification", () => {
  it("creates the study units and links their modules", async () => {
    const applied = await applyAlignmentDocument(
      admin,
      qualificationId,
      alignmentText(),
    );

    expect(applied.studyUnitsCreated).toBe(5);
    expect(applied.outcomesRecorded).toBe(5);
    // Three modules per unit, five units.
    expect(applied.modulesLinked).toBe(15);
    expect(applied.notes).toEqual([]);

    const held = await withTenant(organisationId, async (tx) => {
      const units = await tx
        .select({
          id: studyUnits.id,
          code: studyUnits.code,
          title: studyUnits.title,
          outcomeId: studyUnits.exitLevelOutcomeId,
        })
        .from(studyUnits)
        .where(eq(studyUnits.qualificationId, qualificationId));

      const links = await tx
        .select({
          studyUnitId: studyUnitModules.studyUnitId,
          code: curriculumModules.code,
        })
        .from(studyUnitModules)
        .innerJoin(
          curriculumModules,
          eq(curriculumModules.id, studyUnitModules.curriculumModuleId),
        )
        .where(
          inArray(
            studyUnitModules.studyUnitId,
            units.map((one) => one.id),
          ),
        );

      return { units, links };
    });

    expect(held.units.map((one) => one.code).sort()).toEqual([
      "SU1",
      "SU2",
      "SU3",
      "SU4",
      "SU5",
    ]);

    // Every unit knows the outcome it serves.
    expect(held.units.every((one) => one.outcomeId)).toBe(true);

    const su1 = held.units.find((one) => one.code === "SU1")!;
    expect(
      held.links
        .filter((one) => one.studyUnitId === su1.id)
        .map((one) => one.code)
        .sort(),
    ).toEqual(["KM01", "PM01", "WM01"]);
  });

  it("records the associated assessment criteria under each outcome", async () => {
    const held = await withTenant(organisationId, async (tx) => {
      const outcomes = await tx
        .select({ id: exitLevelOutcomes.id, number: exitLevelOutcomes.number })
        .from(exitLevelOutcomes)
        .where(eq(exitLevelOutcomes.qualificationId, qualificationId));

      const criteria = await tx
        .select({ outcomeId: exitLevelOutcomeCriteria.exitLevelOutcomeId })
        .from(exitLevelOutcomeCriteria)
        .where(
          inArray(
            exitLevelOutcomeCriteria.exitLevelOutcomeId,
            outcomes.map((one) => one.id),
          ),
        );

      return { outcomes, criteria };
    });

    expect(held.outcomes).toHaveLength(5);
    // 4 + 4 + 6 + 3 + 6 in the document.
    expect(held.criteria).toHaveLength(23);
  });

  /**
   * Uploading a corrected document has to correct things rather than doubling
   * them. The study units, the links and the criteria are all keyed on what
   * they are, so the second run should change nothing.
   */
  it("changes nothing when the same document is applied again", async () => {
    const before = await withTenant(organisationId, (tx) =>
      tx
        .select({ id: studyUnitModules.id })
        .from(studyUnitModules)
        .where(eq(studyUnitModules.organisationId, organisationId)),
    );

    const applied = await applyAlignmentDocument(
      admin,
      qualificationId,
      alignmentText(),
    );

    expect(applied.studyUnitsCreated).toBe(0);
    expect(applied.studyUnitsUpdated).toBe(5);
    expect(applied.modulesLinked).toBe(0);

    const after = await withTenant(organisationId, (tx) =>
      tx
        .select({ id: studyUnitModules.id })
        .from(studyUnitModules)
        .where(eq(studyUnitModules.organisationId, organisationId)),
    );

    expect(after).toHaveLength(before.length);
  });

  /**
   * A study unit created from a filename is called "Study Unit 3". The
   * document knows it is "Operationalising L&D", and naming it is half of what
   * this is for.
   */
  it("gives a unit built from a filename its real name", async () => {
    const [su3] = await withTenant(organisationId, (tx) =>
      tx
        .select({ title: studyUnits.title })
        .from(studyUnits)
        .where(eq(studyUnits.code, "SU3")),
    );

    expect(su3.title).toBe("Operationalising L&D");
  });
});

describe("a module the curriculum does not have", () => {
  it("is reported rather than silently skipped", async () => {
    const invented = [
      "Study Unit 9 - Something else",
      "ELO 9 - 10 Credits",
      "A description of the outcome.",
      "KM-99, A module that does not exist, NQF Level 6, 8 Credits.",
    ].join("\n");

    const applied = await applyAlignmentDocument(
      admin,
      qualificationId,
      invented,
    );

    expect(applied.notes.join(" ")).toContain("KM99");
    expect(applied.notes.join(" ")).toMatch(/not in this qualification/i);
  });
});
