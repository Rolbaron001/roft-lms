/**
 * Learning from corrections (job sheet D60 stage 5, 24 November 2026): a
 * correction to what a file is, remembered per provider by the shape of its
 * name, and applied to the next folder.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { organisations } from "@/db/schema";
import { applyLessons, lessonsOf, namePattern, rememberKind } from "@/lib/filing-lessons";
import { classifyDocument, type IngestionPlan } from "@/lib/folder-plan";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

const orgs: string[] = [];
const sessionOf = (organisationId: string): AuthenticatedSession => ({
  sessionId: "0",
  userId: "00000000-0000-0000-0000-000000000000",
  organisationId,
  email: "admin@lessons.test",
  firstName: "Admin",
  lastName: "Test",
  roles: ["tenant_admin"] as Role[],
  permissions: permissionsFor({ roles: ["tenant_admin"] }),
  mustChangePassword: false,
  aiOn: false,
});

beforeAll(async () => {
  await withPlatformScope("filing lessons fixture: two providers", async (tx) => {
    for (const name of ["one", "two"]) {
      const [org] = await tx.insert(organisations).values({ slug: `lessons-${name}-${Date.now()}`, legalName: `Lessons ${name}`, displayName: name, status: "active" }).returning({ id: organisations.id });
      orgs.push(org.id);
    }
  });
});

afterAll(async () => {
  await withPlatformScope("filing lessons teardown", async (tx) => {
    for (const id of orgs) await tx.delete(organisations).where(eq(organisations.id, id));
  });
});

const planOf = (names: string[]): IngestionPlan => ({
  source: "filing",
  qualification: { title: "T", saqaId: null, curriculumCode: null, nqfLevel: null, credits: null, purpose: null },
  modules: [],
  studyUnits: [],
  documents: names.map((name) => classifyDocument(name, name, 1)),
  warnings: [],
});

describe("the shape of a file name", () => {
  it("makes numbers and part letters general, so one correction covers the set", () => {
    expect(namePattern("Formative_Assessor_Guide_Part_A.docx")).toBe("formative assessor guide part x");
    expect(namePattern("Formative_Assessor_Guide_Part_C.docx")).toBe("formative assessor guide part x");
    expect(namePattern("CA 121151 SU3 WB1 AG.docx")).toBe("ca # su# wb# ag");
  });
});

describe("a provider's corrections", () => {
  it("file the next folder's files of that shape the same way", async () => {
    await rememberKind(sessionOf(orgs[0]), "Model_Answers_Part_A.docx", "workbook_memorandum");
    const plan = planOf(["Model_Answers_Part_B.docx", "Model_Answers_Part_C.docx", "Something else.docx"]);
    expect(applyLessons(plan, await lessonsOf(sessionOf(orgs[0])))).toBe(2);
    expect(plan.documents.map((one) => one.kind)).toEqual(["workbook_memorandum", "workbook_memorandum", "other"]);
    expect(plan.documents[0].because).toMatch(/as you corrected "Model_Answers_Part_A.docx" before/);
  });

  it("never shape another provider's reading", async () => {
    expect((await lessonsOf(sessionOf(orgs[1]))).size).toBe(0);
  });

  it("are replaced by a later correction of the same shape", async () => {
    await rememberKind(sessionOf(orgs[0]), "Model_Answers_Part_D.docx", "summative_memorandum");
    const lessons = await lessonsOf(sessionOf(orgs[0]));
    expect(lessons.get("model answers part x")?.kind).toBe("summative_memorandum");
  });
});
