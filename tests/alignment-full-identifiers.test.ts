/**
 * The curriculum under its QCTO identifiers, the alignment document under its
 * short codes, and the two linking anyway.
 *
 * This is the fault Roland hit on 21 September, reproduced exactly. Curiosa's
 * curriculum document numbers knowledge module one `242303-001-00-KM-01`; the
 * alignment document beside it numbers the same module `KM-01`. Both are the
 * published convention for the document they appear in, and the import that
 * read the long form read it correctly.
 *
 * All fifteen modules failed to link, and the fix somebody would reach for -
 * renaming fifteen modules by hand - would have thrown away the identifier the
 * QCTO actually publishes to make the software happy.
 *
 * It is a rule instead: the module code is the last run of letters followed by
 * digits. This proves it against the real alignment document rather than
 * against a string somebody typed, because the whole lesson of this week is
 * that the documents disagree in ways nobody predicts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  organisations,
  studyUnitModules,
  studyUnits,
  userRoles,
  users,
} from "@/db/schema";
import { addCurriculumModule, createQualification } from "@/lib/authoring";
import { readDocxText } from "@/lib/office";
import { applyAlignmentDocument } from "@/lib/study-unit-alignment";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let qualificationId: string;

beforeAll(async () => {
  const slug = `fullid-${Date.now()}`;

  const made = await withPlatformScope("full identifier fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Full Identifier Provider",
        status: "active",
      })
      .returning({ id: organisations.id });

    const [person] = await tx
      .insert(users)
      .values({
        organisationId: organisation.id,
        email: `admin@${slug}.test`,
        firstName: "Full",
        lastName: "Identifier",
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
  admin = {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId: made.userId,
    organisationId,
    email: "admin@fullid.test",
    firstName: "Full",
    lastName: "Identifier",
    roles: ["tenant_admin"] as Role[],
    permissions: permissionsFor({ roles: ["tenant_admin"] as Role[] }),
    mustChangePassword: false,
    aiOn: false,
  };

  const qualification = await createQualification(admin, {
    title: "HRM Officer",
    curriculumCode: "242303-001-00-00",
  });
  qualificationId = qualification.id;

  /*
   * Fifteen modules under the identifiers the curriculum document prints.
   * Not a contrivance - this is what the production database holds, and what
   * the Settings screen showed as "Only 24230300100KM04 itself".
   */
  for (const component of ["KM", "PM", "WM"] as const) {
    for (let number = 1; number <= 5; number += 1) {
      await addCurriculumModule(admin, {
        qualificationId,
        component:
          component === "KM"
            ? "knowledge"
            : component === "PM"
              ? "practical"
              : "workplace",
        code: `242303-001-00-${component}-0${number}`,
        title: `${component} 0${number}`,
      });
    }
  }
}, 180_000);

afterAll(async () => {
  await withPlatformScope("full identifier teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("Curiosa's real alignment document against full QCTO identifiers", () => {
  it("links every module, with no alias table confirmed", async () => {
    const text = readDocxText(
      new Uint8Array(
        readFileSync(join(process.cwd(), "tests/fixtures/121151-alignment.docx")),
      ),
    );

    const applied = await applyAlignmentDocument(admin, qualificationId, text);

    // Five study units, and every one of the fifteen modules placed.
    expect(applied.studyUnitsCreated).toBe(5);
    expect(applied.modulesLinked).toBe(15);

    // And nothing reported as missing, which is the sentence Roland saw
    // fifteen times.
    expect(applied.notes.join(" ")).not.toMatch(/could not be matched/i);
    expect(applied.notes.join(" ")).not.toMatch(/not in this qualification/i);
  }, 120_000);

  it("places them under the right units, not merely under some unit", async () => {
    /*
     * The failure worth guarding is not "nothing linked" - that is loud. It is
     * a knowledge module linked to the workplace unit, which looks like
     * success on every screen and puts a learner's evidence against the wrong
     * half of the curriculum.
     */
    const placed = await withTenant(organisationId, (tx) =>
      tx
        .select({
          unit: studyUnits.code,
          moduleId: studyUnitModules.curriculumModuleId,
        })
        .from(studyUnitModules)
        .innerJoin(studyUnits, eq(studyUnits.id, studyUnitModules.studyUnitId))
        .where(eq(studyUnits.qualificationId, qualificationId)),
    );

    expect(placed).toHaveLength(15);

    // SU2 takes the three modules numbered 02, one of each component.
    const su2 = placed.filter((row) => row.unit === "SU2");
    expect(su2).toHaveLength(3);
  });
});
