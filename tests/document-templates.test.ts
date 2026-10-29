/**
 * A tenant's own version of the documents the platform issues.
 *
 * Roland, 10 September 2026: "Given that the LMS is built for various Tenants
 * the templates cannot be prescriptive of exactly how a document must look.
 * There must be functionality for a user to create and/or upload their own
 * which the LMS must use."
 *
 * The tests that matter are the two boundaries. A provider must be able to
 * change what is theirs, and must not be able to remove what is not: the
 * sentence saying a Statement of Results is not an Occupational Certificate
 * belongs to the QCTO, and the person it protects is a learner standing at an
 * assessment centre with the wrong document in their hand.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import { documentTemplates, organisations, userRoles, users } from "@/db/schema";
import {
  DOCUMENT_FIELDS,
  DOCUMENT_KINDS,
  STARTER_TEMPLATES,
  STATUTORY_BLOCKS,
  placeholdersIn,
  unknownPlaceholders,
} from "@/lib/document-fields";
import {
  activeTemplate,
  fillTemplate,
  listTemplates,
  revertToPlatformLayout,
  saveTemplate,
} from "@/lib/document-templates";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let learner: AuthenticatedSession;

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

/**
 * Deliberately built from the fields every kind of document has - the learner,
 * the provider and the document's own reference - so one body can be saved
 * against all three.
 *
 * It cannot mention the qualification: a certificate carries no SAQA
 * identifier, no curriculum code and no title of one, because it is the
 * provider's own award rather than a national qualification. An earlier version
 * of this fixture used `qualification.title` and was refused for a certificate,
 * which is the guard doing its job.
 */
const BODY = [
  "STATEMENT",
  "",
  "{{ provider.name }}",
  "Issued to {{ learner.fullName }}.",
  "Reference {{ document.reference }}.",
].join("\n");

beforeAll(async () => {
  const slug = `tpl-${Date.now()}`;

  organisationId = await withPlatformScope("template test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Template Test Co",
        status: "active",
      })
      .returning({ id: organisations.id });
    return organisation.id;
  });

  const made = await withPlatformScope("template test fixture", async (tx) => {
    const ids: string[] = [];
    for (const [email, role] of [
      ["admin@tpl.test", "tenant_admin"],
      ["learner@tpl.test", "learner"],
    ] as const) {
      const [user] = await tx
        .insert(users)
        .values({
          organisationId,
          email,
          firstName: "Template",
          lastName: "Tester",
          status: "active",
        })
        .returning({ id: users.id });
      await tx
        .insert(userRoles)
        .values({ organisationId, userId: user.id, role });
      ids.push(user.id);
    }
    return ids;
  });

  admin = sessionFor(["tenant_admin"], made[0]);
  learner = sessionFor(["learner"], made[1]);
});

afterAll(async () => {
  await withPlatformScope("template test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("what a provider may change", () => {
  it("uses their template once they put it in use", async () => {
    await saveTemplate(admin, {
      kind: "statement_of_results",
      name: "Ours, 2026",
      body: BODY,
      activate: true,
    });

    const active = await activeTemplate(admin, "statement_of_results");

    expect(active).not.toBeNull();
    expect(active!.name).toBe("Ours, 2026");
    expect(active!.body).toContain("STATEMENT");
  });

  /**
   * Null is the ordinary answer, not a failure. Every tenant had the platform's
   * layout before this existed and most will keep it.
   */
  it("returns nothing for a document they have not touched", async () => {
    expect(await activeTemplate(admin, "workplace_statement")).toBeNull();
  });

  it("keeps the old version rather than overwriting it", async () => {
    await saveTemplate(admin, {
      kind: "certificate",
      name: "First go",
      body: BODY,
      activate: true,
    });
    await saveTemplate(admin, {
      kind: "certificate",
      name: "Second go",
      body: BODY,
      activate: true,
    });

    const all = await listTemplates(admin);
    const certificates = all.filter((row) => row.kind === "certificate");

    expect(certificates).toHaveLength(2);
    expect(certificates.map((row) => row.version)).toEqual([2, 1]);
    // Exactly one is live. The partial unique index is what enforces it.
    expect(certificates.filter((row) => row.status === "active")).toHaveLength(1);
  });

  it("goes back to the platform's layout without losing their work", async () => {
    await revertToPlatformLayout(admin, "certificate");

    expect(await activeTemplate(admin, "certificate")).toBeNull();

    const kept = (await listTemplates(admin)).filter(
      (row) => row.kind === "certificate",
    );
    expect(kept).toHaveLength(2);
  });

  it("is not something a learner may change", async () => {
    await expect(
      saveTemplate(learner, {
        kind: "statement_of_results",
        name: "Mine now",
        body: BODY,
        activate: true,
      }),
    ).rejects.toThrow();
  });
});

describe("what a provider may not change", () => {
  /**
   * The whole point of the design. A template is rendered, and then the
   * statutory block is rendered after it from the platform's own list. There is
   * no route by which a tenant edits these, because they are never handed to
   * them to edit.
   */
  it("keeps the sentence saying a statement is not a certificate", () => {
    const blocks = STATUTORY_BLOCKS.statement_of_results.join(" ");

    expect(blocks).toContain("not an Occupational Certificate");
    expect(blocks).toContain("two years");
    expect(blocks).toContain(
      "Quality Council for Trades and Occupations will issue",
    );
  });

  it("says on every kind of document what it is not", () => {
    for (const kind of DOCUMENT_KINDS) {
      expect(STATUTORY_BLOCKS[kind].length).toBeGreaterThan(0);
    }
  });
});

describe("catching a mistake when it is made, not when it is printed", () => {
  /**
   * A placeholder the platform cannot fill renders as nothing. A blank space on
   * a learner's certificate is not a failure anybody notices until it is in
   * their hand, so it is refused on save instead.
   */
  it("refuses a field that does not exist", async () => {
    await expect(
      saveTemplate(admin, {
        kind: "statement_of_results",
        name: "Typo",
        body: "Issued to {{ learner.fulName }} on {{ document.issuedOn }}.",
        activate: false,
      }),
    ).rejects.toMatchObject({ reason: "unknown_field" });
  });

  it("names the field it could not fill, so the typo can be found", async () => {
    await expect(
      saveTemplate(admin, {
        kind: "statement_of_results",
        name: "Typo",
        body: "Issued to {{ learner.fulName }} on {{ document.issuedOn }}.",
        activate: false,
      }),
    ).rejects.toThrow(/learner\.fulName/);
  });

  it("refuses an empty template rather than producing a blank document", async () => {
    await expect(
      saveTemplate(admin, {
        kind: "statement_of_results",
        name: "Nothing",
        body: "   ",
        activate: true,
      }),
    ).rejects.toMatchObject({ reason: "invalid" });
  });
});

describe("filling one in", () => {
  it("replaces the fields with the learner's own details", () => {
    const filled = fillTemplate(BODY, {
      "provider.name": "Curiosa Academy",
      "learner.fullName": "Thandi Mokoena",
      "qualification.title": "Occupational Certificate: Commercial Cleaner",
      "document.reference": "ROFT-ABCDE-FGHJK-MNPQR-STVWX",
    });

    expect(filled).toContain("Thandi Mokoena");
    expect(filled).toContain("Curiosa Academy");
    expect(filled).not.toContain("{{");
  });

  /**
   * Spacing inside the braces is somebody's habit, not a meaning. A template
   * that failed over a space would be maddening to debug on a printed page.
   */
  it("does not care about spacing inside the braces", () => {
    const filled = fillTemplate(
      "{{learner.fullName}} and {{  learner.fullName  }}",
      { "learner.fullName": "Thandi" },
    );
    expect(filled).toBe("Thandi and Thandi");
  });

  /**
   * A learner with no identity number recorded should leave a gap, not the
   * words `{{ learner.nationalId }}`, which reads as a fault in the platform
   * rather than a gap in the record.
   */
  it("leaves a field with no value blank rather than showing the placeholder", () => {
    expect(fillTemplate("ID: {{ learner.nationalId }}.", {})).toBe("ID: .");
  });
});

describe("the two lists that have to stay in step", () => {
  /**
   * `DOCUMENT_KINDS` is duplicated: once in lib/document-fields.ts, which a
   * browser form imports, and once as a Postgres enum. They are separate
   * because a client component reaching into the schema would drag the
   * Postgres driver into the bundle. Separate lists drift, so this notices.
   */
  it("offers a field list for every kind of document", () => {
    for (const kind of DOCUMENT_KINDS) {
      expect(DOCUMENT_FIELDS[kind].length).toBeGreaterThan(0);
    }
  });

  it("stores a template under every kind it offers", async () => {
    for (const kind of DOCUMENT_KINDS) {
      const saved = await saveTemplate(admin, {
        kind,
        name: `Check ${kind}`,
        body: BODY,
        activate: false,
      });
      expect(saved.kind).toBe(kind);
    }

    const rows = await withTenant(organisationId, (tx) =>
      tx
        .select({ kind: documentTemplates.kind })
        .from(documentTemplates)
        .where(eq(documentTemplates.organisationId, organisationId)),
    );

    for (const kind of DOCUMENT_KINDS) {
      expect(rows.some((row) => row.kind === kind)).toBe(true);
    }
  });

  it("reads the placeholders out of a body in order", () => {
    expect(placeholdersIn("{{ a.b }} then {{c.d}}")).toEqual(["a.b", "c.d"]);
    expect(unknownPlaceholders("statement_of_results", "{{ learner.fullName }}"))
      .toEqual([]);
  });
});

describe("what a provider starts from", () => {
  /**
   * An empty textarea beside a list of forty field names is a worse invitation
   * than it looks. Each starter is the platform's own wording, already laid
   * out, for a provider to cut down into theirs.
   */
  it("offers a starting point for every document", () => {
    for (const kind of DOCUMENT_KINDS) {
      expect(STARTER_TEMPLATES[kind].length).toBeGreaterThan(100);
    }
  });

  /**
   * The starter is what a provider will save first, so if it used a field the
   * platform cannot fill, the very first save would be refused - and the
   * refusal would look like the platform's fault, because it would be.
   */
  it("uses only fields the platform can actually fill", () => {
    for (const kind of DOCUMENT_KINDS) {
      expect(unknownPlaceholders(kind, STARTER_TEMPLATES[kind])).toEqual([]);
    }
  });

  it("saves without complaint, which is the point of it", async () => {
    for (const kind of DOCUMENT_KINDS) {
      const saved = await saveTemplate(admin, {
        kind,
        name: `Starter ${kind}`,
        body: STARTER_TEMPLATES[kind],
        activate: false,
      });
      expect(saved.id).toBeTruthy();
    }
  });

  /**
   * A starter that repeated the statutory sentences would teach every provider
   * to duplicate them, and the finished document would say everything twice.
   */
  it("does not repeat what the platform adds anyway", () => {
    for (const kind of DOCUMENT_KINDS) {
      for (const block of STATUTORY_BLOCKS[kind]) {
        // Compared on the opening clause: the whole sentence is long enough
        // that an incidental match is not credible.
        expect(STARTER_TEMPLATES[kind]).not.toContain(block.slice(0, 45));
      }
    }
  });

  /**
   * The reference is what makes a document checkable, and it is the thing
   * somebody laying out their own version forgets. Every starter carries it.
   */
  it("carries the verification reference on every document", () => {
    for (const kind of DOCUMENT_KINDS) {
      expect(STARTER_TEMPLATES[kind]).toContain("{{ document.reference }}");
    }
  });
});
