/**
 * The alignment document doing its work without anybody pointing at it.
 *
 * The test next door applies it directly, which proves the reading and the
 * writing. This proves the wiring: the document arrives inside a folder of
 * material, like every other file, and the study units are built anyway.
 *
 * That is the path Heidi will actually take — she will not upload an alignment
 * document on purpose, she will drop a folder that happens to contain one — and
 * it is the path with the most places to come apart. The classifier has to
 * recognise a document called "KM PM ELO Alignment" as an alignment document;
 * the commit has to file it; filing it has to trigger the reading; and the
 * reading has to happen after the curriculum exists, or every module it names
 * is reported as missing.
 *
 * Ordering is the part worth guarding. Modules are created before documents in
 * the commit, and if that were ever reversed this would fail with five study
 * units and nothing linked to them — which looks like success on a screen.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  curriculumModules,
  exitLevelOutcomes,
  organisations,
  studyUnitModules,
  studyUnits,
  userRoles,
  users,
} from "@/db/schema";
import { ingestUpload } from "@/lib/folder-import";
import { commitPlan } from "@/lib/folder-commit";
import {
  createQualificationFromDocuments,
  readQualificationSources,
} from "@/lib/qualification-from-document";
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
    firstName: "In",
    lastName: "Folder",
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

beforeAll(async () => {
  const slug = `infolder-${Date.now()}`;

  const made = await withPlatformScope("in-folder fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "In Folder Provider",
        status: "active",
      })
      .returning({ id: organisations.id });

    const [person] = await tx
      .insert(users)
      .values({
        organisationId: organisation.id,
        email: "admin@infolder.test",
        firstName: "In",
        lastName: "Folder",
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

  // The qualification first, from its own documents, exactly as somebody does
  // it. The curriculum has to exist before the alignment document can link to
  // it.
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

  /*
   * Then the folder, with the alignment document sitting in it among ordinary
   * material — under the name Curiosa actually use, which does not contain the
   * word "matrix".
   */
  const job = await ingestUpload(
    admin,
    [
      {
        path: "CA - 121151 - KM PM ELO Alignment.docx",
        bytes: fixture("121151-alignment.docx"),
      },
      {
        path: "Study Unit 1/CA 121151 SU1 WB1.docx",
        bytes: fixture("121151-alignment.docx"),
      },
    ],
    "material",
    "a folder of material",
    { qualificationId },
  );

  await commitPlan(admin, { jobId: job.id, qualificationId });
}, 180_000);

afterAll(async () => {
  await withPlatformScope("in-folder teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("a folder that happens to contain an alignment document", () => {
  it("builds the study units without being asked to", async () => {
    const units = await withTenant(organisationId, (tx) =>
      tx
        .select({ code: studyUnits.code, title: studyUnits.title })
        .from(studyUnits)
        .where(eq(studyUnits.qualificationId, qualificationId)),
    );

    expect(units.map((one) => one.code).sort()).toEqual([
      "SU1",
      "SU2",
      "SU3",
      "SU4",
      "SU5",
    ]);

    // Named from the document, not from the folder. A unit built from the
    // filename alone would be called "Study Unit 1".
    expect(units.find((one) => one.code === "SU3")?.title).toBe(
      "Operationalising L&D",
    );
  });

  /**
   * The ordering guard. Modules are created before documents are filed, and
   * if that were reversed every module the alignment document names would be
   * reported missing — leaving five study units with nothing linked to them,
   * which on a screen looks like it worked.
   */
  it("links the modules, which means the curriculum existed first", async () => {
    const links = await withTenant(organisationId, async (tx) => {
      const units = await tx
        .select({ id: studyUnits.id, code: studyUnits.code })
        .from(studyUnits)
        .where(eq(studyUnits.qualificationId, qualificationId));

      const rows = await tx
        .select({
          unitId: studyUnitModules.studyUnitId,
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

      return { units, rows };
    });

    expect(links.rows).toHaveLength(15);

    const su1 = links.units.find((one) => one.code === "SU1")!;
    expect(
      links.rows
        .filter((one) => one.unitId === su1.id)
        .map((one) => one.code)
        .sort(),
    ).toEqual(["KM01", "PM01", "WM01"]);
  });

  it("records the outcome each unit serves", async () => {
    const outcomes = await withTenant(organisationId, (tx) =>
      tx
        .select({ number: exitLevelOutcomes.number })
        .from(exitLevelOutcomes)
        .where(eq(exitLevelOutcomes.qualificationId, qualificationId)),
    );

    expect(outcomes.map((one) => one.number).sort()).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
  });
});
