/**
 * A provider that answers in text rather than by writing a file.
 *
 * The folder reader stages the documents into a working directory and asks the
 * model to write `proposal.json` into it. That is how Claude Code behaves,
 * because it is an agent with file tools, and it is the only behaviour any
 * test covered.
 *
 * Gemini and OpenAI cannot do that. They are one request and one answer, so
 * they return the JSON as text. The reader has always had a fallback for it —
 * `readJson(result.text)` — and nothing exercised it. Since those two are the
 * only providers that can run on the server at all, that fallback is now the
 * path that matters most, and an untested fallback is a guess.
 *
 * Nothing here calls a model. The extension is replaced with one that answers
 * the way an HTTP provider answers.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const ANSWER = {
  qualification: {
    title: "A qualification read from documents",
    saqaId: "990123",
    nqfLevel: 5,
  },
  modules: [
    {
      component: "knowledge",
      code: "KM01",
      title: "A knowledge module",
      credits: 8,
      topics: [
        {
          code: "KM0101",
          title: "A topic",
          elements: ["Something that must be taught."],
          criteria: ["Something that must be achieved."],
        },
      ],
    },
  ],
  studyUnits: [],
};

/*
 * Replaced before the module under test is imported, which is why this sits
 * above the imports below rather than inside a beforeAll.
 */
vi.mock("@/lib/extensions", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/extensions")>("@/lib/extensions");

  return {
    ...actual,
    extensionOffered: () => true,
    extensionState: async () => ({
      on: true,
      available: true,
      registered: true,
      tokenHint: "0000",
      tokenAddedAt: new Date(),
      model: null,
      provider: "gemini",
      availability: { available: true },
    }),
    // The shape of an answer from an HTTP provider: text, and no file left
    // behind in the working directory.
    runExtension: async () => ({
      ok: true,
      text: JSON.stringify(ANSWER),
      model: "gemini-2.5-flash",
      durationMs: 1200,
    }),
  };
});

const { withPlatformScope, withTenant } = await import("@/db/client");
const {
  assessmentCriteria,
  curriculumModules,
  organisations,
  qualifications,
  userRoles,
  users,
} = await import("@/db/schema");
const { ingestUpload, getIngestJob } = await import("@/lib/folder-import");
const { commitPlan } = await import("@/lib/folder-commit");
const { permissionsFor } = await import("@/lib/rbac");

let organisationId: string;
let admin: import("@/lib/session").AuthenticatedSession;
let qualificationId: string;

beforeAll(async () => {
  const slug = `textanswer-${Date.now()}`;

  const made = await withPlatformScope("text answer fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Text Answer Provider",
        status: "active",
      })
      .returning({ id: organisations.id });

    const [person] = await tx
      .insert(users)
      .values({
        organisationId: organisation.id,
        email: "admin@textanswer.test",
        firstName: "Text",
        lastName: "Answer",
        status: "active",
      })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({
      organisationId: organisation.id,
      userId: person.id,
      role: "tenant_admin",
    });

    const [qualification] = await tx
      .insert(qualifications)
      .values({
        organisationId: organisation.id,
        title: "Somewhere to put it",
        kind: "full",
        saqaId: "990123",
      })
      .returning({ id: qualifications.id });

    return {
      orgId: organisation.id,
      userId: person.id,
      qual: qualification.id,
    };
  });

  organisationId = made.orgId;
  qualificationId = made.qual;
  admin = {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId: made.userId,
    organisationId,
    email: "admin@textanswer.test",
    firstName: "Text",
    lastName: "Answer",
    roles: ["tenant_admin"],
    permissions: permissionsFor({ roles: ["tenant_admin"] }),
    mustChangePassword: false,
    aiOn: true,
  };
});

afterAll(async () => {
  await withPlatformScope("text answer teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("a folder with no summary of itself", () => {
  it("is read from the model's answer, with no file written", async () => {
    const job = await ingestUpload(
      admin,
      [
        {
          path: "121151 Curriculum Document.txt",
          bytes: new TextEncoder().encode(
            "KM01 A knowledge module\nKM0101 A topic",
          ),
        },
      ],
      "qualification",
      "a folder with no blueprint",
    );

    expect(job.status).toBe("proposed");

    const full = await getIngestJob(admin, job.id);
    const plan = full.proposal as { modules?: { code: string }[] } | null;

    expect(plan?.modules?.map((one) => one.code)).toEqual(["KM01"]);
  });

  /**
   * And the whole way through, because a plan that cannot be committed is no
   * better than no plan.
   */
  it("commits into a real curriculum", async () => {
    const job = await ingestUpload(
      admin,
      [
        {
          path: "121151 Curriculum Document.txt",
          bytes: new TextEncoder().encode("KM01 A knowledge module"),
        },
      ],
      "qualification",
      "a folder with no blueprint",
    );

    const report = await commitPlan(admin, { jobId: job.id, qualificationId });

    expect(report.modules).toBe(1);
    expect(report.criteria).toBe(1);

    const stored = await withTenant(organisationId, async (tx) => {
      const modules = await tx
        .select({ id: curriculumModules.id, code: curriculumModules.code })
        .from(curriculumModules)
        .where(eq(curriculumModules.qualificationId, qualificationId));

      const criteria = await tx
        .select({ description: assessmentCriteria.description })
        .from(assessmentCriteria)
        .where(eq(assessmentCriteria.curriculumModuleId, modules[0].id));

      return { modules, criteria };
    });

    expect(stored.modules.map((one) => one.code)).toEqual(["KM01"]);
    expect(stored.criteria[0].description).toContain("must be achieved");
  });
});
