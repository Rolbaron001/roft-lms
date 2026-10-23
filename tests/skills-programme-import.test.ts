/**
 * Adding an occupational skills programme from its two published documents:
 * SP220320 Assessment Practitioner (job sheet D39, 23 October 2026).
 *
 * A skills programme is founded on its Skills Programme Document and its own
 * Curriculum Document, not on a qualification's three. Until this was built
 * the document was read as a SAQA qualification document (no title, level 4,
 * 11 credits, no outcomes) and the import refused it for want of a parent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import { curriculumModules, organisations, qualifications, userRoles, users } from "@/db/schema";
import { readPdfText } from "@/lib/office";
import { isSkillsProgrammeDocument, parseSkillsProgrammeDocument } from "@/lib/skills-programme-parse";
import { createQualificationFromDocuments, readQualificationSources } from "@/lib/qualification-from-document";
import { programmeReadiness } from "@/lib/programme-readiness";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let author: AuthenticatedSession;

function fixture(name: string) {
  return { filename: name, bytes: new Uint8Array(readFileSync(join(__dirname, "fixtures", name))) };
}
const PROGRAMME = () => fixture("sp220320-skills-programme.pdf");
const CURRICULUM = () => fixture("sp220320-curriculum.pdf");

beforeAll(async () => {
  const slug = `spimport-${Date.now()}`;
  organisationId = await withPlatformScope("skills programme import setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: "Skills Programme Test Co", status: "active" })
      .returning({ id: organisations.id });
    return organisation.id;
  });
  const userId = await withPlatformScope("skills programme import user", async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ organisationId, email: "admin@sp.test", firstName: "Admin", lastName: "Tester", status: "active" })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({ organisationId, userId: user.id, role: "tenant_admin" });
    return user.id;
  });
  const roles: Role[] = ["tenant_admin"];
  author = {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "admin@sp.test",
    firstName: "Admin",
    lastName: "Tester",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
});

afterAll(async () => {
  await withPlatformScope("skills programme import teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

describe("the Skills Programme Document", () => {
  it("reads what SP220320 registers", async () => {
    const { text } = await readPdfText(PROGRAMME().bytes);
    expect(isSkillsProgrammeDocument(text)).toBe(true);
    const parsed = parseSkillsProgrammeDocument(text);
    expect(parsed.spId).toBe("SP-220320");
    expect(parsed.title).toBe("Assessment Practitioner");
    expect([parsed.nqfLevel, parsed.totalCredits, parsed.durationDays]).toEqual([5, 20, 30]);
    expect(parsed.ofoCode).toBe("242401");
    expect(parsed.lastEnrolmentDate?.toISOString().slice(0, 10)).toBe("2028-03-02");
    expect(parsed.lastAchievementDate?.toISOString().slice(0, 10)).toBe("2031-03-02");
    expect(parsed.moduleCodes).toEqual(["242401001-KM-05", "242401001-PM-06", "242401001-WM-06"]);
    expect(parsed.exitLevelOutcomes).toHaveLength(1);
    expect(parsed.exitLevelOutcomes[0].criteria).toHaveLength(9);
  });
});

describe("adding SP220320", () => {
  it("reads it as a skills programme standing on its own", async () => {
    const reading = await readQualificationSources(author, { curriculum: CURRICULUM(), skillsProgramme: PROGRAMME() });
    expect(reading.details.kind).toBe("skills_programme");
    expect(reading.part).toBeNull();
    expect(reading.details.saqaId).toBe("SP-220320");
    expect(reading.details.title).toBe("Assessment Practitioner");
    expect(reading.details.nqfLevel).toBe(5);
    expect(reading.details.totalCredits).toBe(20);
    expect(reading.modules.map((one) => one.code)).toEqual(["KM05", "PM06", "WM06"]);
    expect(reading.notes.some((note) => /Assessment Specification was supplied/.test(note))).toBe(false);
    expect(reading.skillsProgramme?.durationDays).toBe(30);
  });

  it("is recognised in the qualification document's place too", async () => {
    const reading = await readQualificationSources(author, { curriculum: CURRICULUM(), qualification: PROGRAMME() });
    expect(reading.details.kind).toBe("skills_programme");
    expect(reading.details.saqaId).toBe("SP-220320");
  });

  it("creates it with its modules, dates and documents, and asks for no assessment specification", async () => {
    const { qualificationId } = await createQualificationFromDocuments(
      author,
      { curriculum: CURRICULUM(), skillsProgramme: PROGRAMME() },
      { title: "Assessment Practitioner", curriculumCode: "900096-000-00-00", saqaId: "SP-220320", nqfLevel: 5, totalCredits: 20 },
    );

    const [row] = await withTenant(organisationId, (tx) => tx.select().from(qualifications).where(eq(qualifications.id, qualificationId)));
    expect(row.kind).toBe("skills_programme");
    expect(row.durationDays).toBe(30);
    expect(row.lastEnrolmentDate?.toISOString().slice(0, 10)).toBe("2028-03-02");
    expect(row.ofoCode).toBe("242401");

    const modules = await withTenant(organisationId, (tx) =>
      tx.select().from(curriculumModules).where(eq(curriculumModules.qualificationId, qualificationId)),
    );
    expect(modules).toHaveLength(3);

    const readiness = await programmeReadiness(author, qualificationId);
    expect(readiness.gaps.some((gap) => /Assessment Specification/.test(gap.what))).toBe(false);
    expect(readiness.documents.qualification).toBe(true);

    // A second time is refused, pointing at the first.
    await expect(
      createQualificationFromDocuments(
        author,
        { curriculum: CURRICULUM(), skillsProgramme: PROGRAMME() },
        { title: "Assessment Practitioner" },
      ),
    ).rejects.toThrow(/already has the code/);
  });
});
