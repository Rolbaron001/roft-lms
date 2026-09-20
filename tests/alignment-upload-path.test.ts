/**
 * The alignment document uploaded one at a time, from the form.
 *
 * Roland, 20 September, on the third attempt at this: "Uploading the alignment
 * document still doesn't work. The document is uploaded but nothing seems to
 * happen from it. The navigation still shows outstanding study units."
 *
 * Two tests already cover this document - one applies it directly, one drops
 * it inside a folder - and both pass. Neither covers the path he was actually
 * taking, which is the single-document uploader on the qualification page, and
 * that path was gated on a dropdown.
 *
 * The screen told him to set the kind to Curriculum Alignment Matrix. The
 * dropdown's first option, and so its default, is "SAQA qualification
 * document". Leave it, and the document was filed and never read: no error, no
 * mention, and a progress map still saying study units were outstanding.
 *
 * So the gate is gone. What the file contains decides, the way it already
 * decided between the Word table and the spreadsheet one level down. This is
 * the test for the way in that had none.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  organisations,
  programmeDocuments,
  studyUnitModules,
  studyUnits,
  userRoles,
  users,
} from "@/db/schema";
import { uploadProgrammeDocument } from "@/lib/programme-documents";
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
    email: "admin@uploadpath.test",
    firstName: "Upload",
    lastName: "Path",
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
  const slug = `uploadpath-${Date.now()}`;

  const made = await withPlatformScope("upload path fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Upload Path Provider",
        status: "active",
      })
      .returning({ id: organisations.id });

    const [person] = await tx
      .insert(users)
      .values({
        organisationId: organisation.id,
        email: "admin@uploadpath.test",
        firstName: "Upload",
        lastName: "Path",
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

  // The curriculum has to be there first, or the modules the alignment
  // document names match nothing.
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
}, 180_000);

afterAll(async () => {
  await withPlatformScope("upload path teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("the alignment document uploaded with the kind left as it came", () => {
  /*
   * "qualification_document" is not a careless choice for this fixture: it is
   * the first entry in DOCUMENT_KINDS, so it is what the select shows before
   * anybody touches it. This is the exact upload Roland performed.
   */
  let result: Awaited<ReturnType<typeof uploadProgrammeDocument>>;

  beforeAll(async () => {
    result = await uploadProgrammeDocument(
      admin,
      {
        kind: "qualification_document",
        title: "CA - 121151 - KM PM ELO Alignment",
        qualificationId,
      },
      {
        filename: "CA - 121151 - KM PM ELO Alignment.docx",
        bytes: fixture("121151-alignment.docx"),
      },
    );
  }, 120_000);

  it("is read anyway, and builds the study units", () => {
    expect(result.alignment?.studyUnitsCreated).toBe(5);
    expect(result.alignment?.modulesLinked).toBeGreaterThan(0);
  });

  it("says the kind was corrected rather than correcting it quietly", () => {
    // A platform that silently refiles somebody's document is worse than one
    // that ignores it. The caller is handed the fact so the screen can say so.
    expect(result.reclassified).toBe(true);
    expect(result.kind).toBe("alignment_matrix");
  });

  it("is filed under the kind it actually is", async () => {
    const rows = await withTenant(organisationId, (tx) =>
      tx
        .select({ kind: programmeDocuments.kind })
        .from(programmeDocuments)
        .where(eq(programmeDocuments.qualificationId, qualificationId)),
    );

    // Filed as what it is, not as what the dropdown said. Otherwise the
    // document library lists Curiosa's alignment document as a SAQA
    // qualification document for ever.
    expect(rows.map((row) => row.kind)).toContain("alignment_matrix");
  });

  it("leaves the study units named from the document", async () => {
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
    expect(units.find((one) => one.code === "SU3")?.title).toBe(
      "Operationalising L&D",
    );
  });

  it("places modules under them, which is what the progress map counts", async () => {
    // The step Roland was watching is "study units", and it is done when no
    // module is left unplaced. Five empty units would still have read as
    // outstanding, which is how this looked like nothing happening.
    const links = await withTenant(organisationId, (tx) =>
      tx
        .select({ id: studyUnitModules.id })
        .from(studyUnitModules)
        .innerJoin(studyUnits, eq(studyUnits.id, studyUnitModules.studyUnitId))
        .where(eq(studyUnits.qualificationId, qualificationId)),
    );

    expect(links.length).toBeGreaterThanOrEqual(15);
  });
});

describe("an ordinary document uploaded the same way", () => {
  it("is filed as chosen and nothing is read from it", async () => {
    const result = await uploadProgrammeDocument(
      admin,
      {
        kind: "theory_guide",
        title: "A theory guide",
        qualificationId,
      },
      {
        // The curriculum PDF standing in for any ordinary document: it is long
        // prose about this qualification, and it must not be mistaken for an
        // alignment document. The guard is narrow on purpose.
        filename: "121151-curriculum.pdf",
        bytes: fixture("121151-curriculum.pdf"),
      },
    );

    expect(result.reclassified).toBeFalsy();
    expect(result.kind).toBe("theory_guide");
    expect(result.alignment).toBeUndefined();
    expect(result.matrix).toBeUndefined();
  }, 120_000);
});
