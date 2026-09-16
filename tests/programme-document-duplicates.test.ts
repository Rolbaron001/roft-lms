/**
 * The same file, filed twice.
 *
 * Curiosa's 121151 folder carries their three base documents inside it as well
 * as beside it. So the ordinary sequence — build the qualification from its
 * documents, then import the folder of material — filed each of them twice:
 * two curriculum documents, two qualification documents, each a copy of the
 * other with nothing to say which was which.
 *
 * Superseding, which the platform already did, is for a *new* version of a
 * document. The same bytes again are not a new version, and treating them as
 * one turns a document list into a list of indistinguishable pairs.
 *
 * Matched on the digest rather than the name: the same file under two names is
 * still the same file, and a different file under the same name is not.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  organisations,
  programmeDocuments,
  qualifications,
  userRoles,
  users,
} from "@/db/schema";
import { uploadProgrammeDocument } from "@/lib/programme-documents";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let qualificationId: string;
let otherQualificationId: string;

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "admin@example.test",
    firstName: "Doc",
    lastName: "Filer",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

/** A small, valid PDF, so the media check accepts it. */
function pdf(marker: string): Uint8Array {
  return new TextEncoder().encode(
    `%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% ${marker}\n%%EOF\n`,
  );
}

beforeAll(async () => {
  const slug = `docs-${Date.now()}`;

  const made = await withPlatformScope("document fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Document Provider",
        status: "active",
      })
      .returning({ id: organisations.id });

    const [person] = await tx
      .insert(users)
      .values({
        organisationId: organisation.id,
        email: "admin@docs.test",
        firstName: "Doc",
        lastName: "Admin",
        status: "active",
      })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({
      organisationId: organisation.id,
      userId: person.id,
      role: "tenant_admin",
    });

    const [one] = await tx
      .insert(qualifications)
      .values({
        organisationId: organisation.id,
        title: "A qualification",
        kind: "full",
        saqaId: "880001",
      })
      .returning({ id: qualifications.id });

    const [two] = await tx
      .insert(qualifications)
      .values({
        organisationId: organisation.id,
        title: "A different qualification",
        kind: "full",
        saqaId: "880002",
      })
      .returning({ id: qualifications.id });

    return { orgId: organisation.id, userId: person.id, one: one.id, two: two.id };
  });

  organisationId = made.orgId;
  admin = sessionFor(["tenant_admin"], made.userId);
  qualificationId = made.one;
  otherQualificationId = made.two;
});

afterAll(async () => {
  await withPlatformScope("document teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

async function held(forQualification: string) {
  return withTenant(organisationId, (tx) =>
    tx
      .select({ id: programmeDocuments.id })
      .from(programmeDocuments)
      .where(eq(programmeDocuments.qualificationId, forQualification)),
  );
}

describe("the same file arriving twice", () => {
  it("is filed once", async () => {
    const bytes = pdf("the curriculum");

    const first = await uploadProgrammeDocument(
      admin,
      {
        kind: "curriculum_document",
        title: "121151 Curriculum Document",
        qualificationId,
      },
      { filename: "121151 Curriculum Document.pdf", bytes },
    );

    const second = await uploadProgrammeDocument(
      admin,
      {
        kind: "curriculum_document",
        title: "121151 Curriculum Document",
        qualificationId,
      },
      { filename: "121151 Curriculum Document.pdf", bytes },
    );

    expect(second.id).toBe(first.id);
    expect(await held(qualificationId)).toHaveLength(1);
  });

  /**
   * The same file under a different name is still the same file. Curiosa's
   * folder does exactly this: the base documents inside it are named slightly
   * differently from the ones handed over beside it.
   */
  it("is still one file under a different name", async () => {
    const bytes = pdf("the qualification");

    await uploadProgrammeDocument(
      admin,
      {
        kind: "qualification_document",
        title: "Qualification Document",
        qualificationId,
      },
      { filename: "121151 Qualification Document.pdf", bytes },
    );

    await uploadProgrammeDocument(
      admin,
      {
        kind: "qualification_document",
        title: "SAQA extract",
        qualificationId,
      },
      { filename: "saqa-121151.pdf", bytes },
    );

    expect(await held(qualificationId)).toHaveLength(2);
  });
});

describe("what is not a duplicate", () => {
  /**
   * A genuinely new version supersedes rather than being swallowed. Losing
   * that would be worse than the duplication this change removes: a provider
   * revises a workbook and the revision has to land.
   */
  it("keeps a different file of the same kind and title", async () => {
    const before = (await held(qualificationId)).length;

    await uploadProgrammeDocument(
      admin,
      {
        kind: "curriculum_document",
        title: "121151 Curriculum Document",
        qualificationId,
      },
      {
        filename: "121151 Curriculum Document.pdf",
        bytes: pdf("the curriculum, revised"),
      },
    );

    expect(await held(qualificationId)).toHaveLength(before + 1);
  });

  /**
   * Two qualifications may legitimately hold the same document — a part and
   * its parent share a curriculum document, which is the whole premise of a
   * part qualification.
   */
  it("keeps the same file filed against a different qualification", async () => {
    const bytes = pdf("shared between two");

    await uploadProgrammeDocument(
      admin,
      { kind: "curriculum_document", title: "Shared", qualificationId },
      { filename: "shared.pdf", bytes },
    );

    await uploadProgrammeDocument(
      admin,
      {
        kind: "curriculum_document",
        title: "Shared",
        qualificationId: otherQualificationId,
      },
      { filename: "shared.pdf", bytes },
    );

    expect(await held(otherQualificationId)).toHaveLength(1);
  });
});
