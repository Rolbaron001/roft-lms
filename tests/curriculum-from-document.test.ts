/**
 * Starting a curriculum from the uploaded document, against a live database.
 *
 * The test that carries this is the last one: the real 121150 curriculum
 * document goes in as a PDF, and a module comes out the other side with its
 * topics, its lines to teach and its criteria in the database — without
 * anybody transcribing a word.
 *
 * The rest guard the two ways this does damage. It writes through the same
 * functions the hand editor uses, so a work experience module must not acquire
 * assessment criteria on the way in; and nothing at all may be written until
 * somebody has asked for it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  assessmentCriteria,
  curriculumModules,
  curriculumTopicElements,
  curriculumTopics,
  organisations,
  userRoles,
  users,
} from "@/db/schema";
import { createQualification } from "@/lib/authoring";
import { uploadProgrammeDocument } from "@/lib/programme-documents";
import {
  acceptProposedModule,
  CurriculumImportError,
  proposalForQualification,
} from "@/lib/curriculum-from-document";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let author: AuthenticatedSession;

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

beforeAll(async () => {
  const slug = `fromdoc-${Date.now()}`;

  organisationId = await withPlatformScope("from-document setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "From Document Test Co",
        status: "active",
      })
      .returning({ id: organisations.id });
    return organisation.id;
  });

  const userId = await withPlatformScope("from-document fixture", async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        organisationId,
        email: "author@fromdoc.test",
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
});

afterAll(async () => {
  await withPlatformScope("from-document teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

/** A qualification with the real curriculum document uploaded against it. */
async function qualificationWithDocument() {
  const qualification = await createQualification(author, {
    title: `HRM Administrator ${Math.random().toString(36).slice(2, 8)}`,
  });

  await uploadProgrammeDocument(
    author,
    {
      kind: "curriculum_document",
      title: "Curriculum Document",
      qualificationId: qualification.id,
    },
    {
      filename: "121150-curriculum.pdf",
      bytes: new Uint8Array(
        readFileSync(join(__dirname, "fixtures", "121150-curriculum.pdf")),
      ),
    },
  );

  return qualification;
}

describe("nothing is written until somebody asks", () => {
  it("says so when no curriculum document has been uploaded", async () => {
    const qualification = await createQualification(author, {
      title: `Bare ${Math.random().toString(36).slice(2, 8)}`,
    });

    const proposal = await proposalForQualification(author, qualification.id);

    expect(proposal.modules).toEqual([]);
    expect(proposal.blocked).toMatch(/No curriculum document/);
  });

  it("proposes without creating anything", async () => {
    const qualification = await qualificationWithDocument();

    const proposal = await proposalForQualification(author, qualification.id);
    expect(proposal.modules.length).toBe(13);

    const rows = await withTenant(organisationId, (tx) =>
      tx
        .select({ id: curriculumModules.id })
        .from(curriculumModules)
        .where(eq(curriculumModules.qualificationId, qualification.id)),
    );

    expect(rows).toEqual([]);
  });

  it("refuses a module that is not in the document", async () => {
    const qualification = await qualificationWithDocument();

    await expect(
      acceptProposedModule(author, qualification.id, "ZZ99"),
    ).rejects.toThrow(CurriculumImportError);
  });
});

describe("taking a module from the document", () => {
  it("writes its topics, its lines to teach and its criteria", async () => {
    const qualification = await qualificationWithDocument();

    const summary = await acceptProposedModule(author, qualification.id, "KM01");

    expect(summary.refused).toEqual([]);
    expect(summary.topics).toBe(4);
    expect(summary.elements).toBe(19);
    expect(summary.criteria).toBe(18);

    const stored = await withTenant(organisationId, async (tx) => {
      const [module] = await tx
        .select()
        .from(curriculumModules)
        .where(eq(curriculumModules.qualificationId, qualification.id));

      const topics = await tx
        .select()
        .from(curriculumTopics)
        .where(eq(curriculumTopics.curriculumModuleId, module.id));

      const criteria = await tx
        .select()
        .from(assessmentCriteria)
        .where(eq(assessmentCriteria.curriculumModuleId, module.id));

      return { module, topics, criteria };
    });

    expect(stored.module.component).toBe("knowledge");
    expect(stored.module.credits).toBe(12);
    expect(stored.topics.map((t) => t.code).sort()).toEqual([
      "KM0101",
      "KM0102",
      "KM0103",
      "KM0104",
    ]);

    // The percentages the document gives, carried through rather than assumed
    // equal: readiness weights a module's topics by them.
    expect(stored.topics.every((t) => t.weightPercent === 25)).toBe(true);

    // Every criterion is filed under the topic it belongs to, not loose on the
    // module — which is what lets a question be tagged to a topic later.
    expect(stored.criteria.length).toBe(18);
    expect(stored.criteria.every((c) => c.topicId !== null)).toBe(true);
  });

  it("keeps the document's wording", async () => {
    const qualification = await qualificationWithDocument();
    await acceptProposedModule(author, qualification.id, "KM01");

    const element = await withTenant(organisationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(curriculumTopicElements)
        .where(eq(curriculumTopicElements.code, "KT0101"));
      return row;
    });

    expect(element.description).toBe(
      "Definition of an organisation and the generic organisational value chain.",
    );
    expect(element.kind).toBe("knowledge_topic");
  });

  /**
   * A work experience module is evidenced by a signed logbook. If this route
   * could put criteria on one it would be a hole in the same wall the hand
   * editor refuses to breach — and a quieter one, because nobody typed them.
   */
  it("puts no criteria on a work experience module", async () => {
    const qualification = await qualificationWithDocument();

    const summary = await acceptProposedModule(author, qualification.id, "WM01");

    expect(summary.criteria).toBe(0);
    expect(summary.elements).toBeGreaterThan(0);
  });

  /**
   * WM01 numbers five different work activities WA0201. Four of them cannot be
   * stored, and the module must still come in with everything else: sending
   * somebody back to typing eighty lines by hand because the document has one
   * numbering fault would make this route worth avoiding.
   */
  it("takes the rest of a module when the document repeats a code", async () => {
    const qualification = await qualificationWithDocument();

    const summary = await acceptProposedModule(author, qualification.id, "WM01");

    // 49 rather than 48 since the reader stopped losing the last line of the
    // last topic. WM01's four work experiences each carry fourteen lines; the
    // reader used to return thirteen for WE0104, dropping "SE05 Signed Off
    // Logbook" — the signed logbook being, for a work experience module, the
    // whole of the evidence. The old number recorded that gap rather than the
    // document.
    expect(summary.elements).toBe(49);
    expect(summary.refused.length).toBe(4);
    for (const reason of summary.refused) {
      expect(reason).toMatch(/WA0201/);
    }
  });

  it("refuses to take the same module twice", async () => {
    const qualification = await qualificationWithDocument();
    await acceptProposedModule(author, qualification.id, "KM01");

    await expect(
      acceptProposedModule(author, qualification.id, "KM01"),
    ).rejects.toThrow(/already in this qualification/);
  });

  it("marks what is already in the curriculum as taken", async () => {
    const qualification = await qualificationWithDocument();
    await acceptProposedModule(author, qualification.id, "KM01");

    const proposal = await proposalForQualification(author, qualification.id);
    const km01 = proposal.modules.find((m) => m.code === "KM01");
    const km02 = proposal.modules.find((m) => m.code === "KM02");

    expect(km01?.present).toBe(true);
    expect(km02?.present).toBe(false);
  });
});
