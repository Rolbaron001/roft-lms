/**
 * Opening an enrolment document, against a live database.
 *
 * Job sheet A7, 26 September. A coordinator was asked to accept or refuse a
 * certified copy, including as illegible, with no way to look at it. These
 * guard both halves of the fix: the person checking can open it, and nobody
 * else can, since an identity document is the most sensitive file held.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { organisations, userRoles, users } from "@/db/schema";
import {
  DocumentError,
  readEnrolmentDocument,
  recordEnrolmentDocument,
} from "@/lib/enrolment-documents";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let otherOrganisationId: string;
const people: Record<string, string> = {};

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");

function sessionFor(roles: Role[], userId: string, organisation = organisationId): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId: organisation,
    email: "reader@example.test",
    firstName: "Test",
    lastName: "Reader",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

async function tenant(slug: string) {
  return withPlatformScope("enrolment document test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: slug, status: "active" })
      .returning({ id: organisations.id });
    return organisation.id;
  });
}

async function person(organisation: string, name: string, role: Role) {
  return withPlatformScope("enrolment document test fixture", async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        organisationId: organisation,
        email: `${name}-${Date.now()}@example.test`,
        firstName: name,
        lastName: "Tester",
        status: "active",
      })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({ organisationId: organisation, userId: user.id, role });
    return user.id;
  });
}

let documentId: string;

beforeAll(async () => {
  organisationId = await tenant(`docread-${Date.now()}`);
  otherOrganisationId = await tenant(`docread-other-${Date.now()}`);
  people.admin = await person(organisationId, "admin", "tenant_admin");
  people.learner = await person(organisationId, "learner", "learner");
  people.classmate = await person(organisationId, "classmate", "learner");
  people.assessor = await person(organisationId, "assessor", "assessor");
  people.outsider = await person(otherOrganisationId, "outsider", "tenant_admin");

  const created = await recordEnrolmentDocument(sessionFor(["tenant_admin"], people.admin), {
    userId: people.learner,
    kind: "cv",
    filename: "cv.pdf",
    bytes: PDF,
  });
  documentId = created.id;
});

afterAll(async () => {
  await withPlatformScope("enrolment document test teardown", async (tx) => {
    await tx.delete(organisations).where(eq(organisations.id, organisationId));
    await tx.delete(organisations).where(eq(organisations.id, otherOrganisationId));
  });
});

describe("opening an enrolment document", () => {
  it("opens for the coordinator who has to check it, byte for byte", async () => {
    const file = await readEnrolmentDocument(sessionFor(["tenant_admin"], people.admin), documentId);
    expect(Buffer.from(file.bytes).equals(Buffer.from(PDF))).toBe(true);
    expect(file.filename).toBe("cv.pdf");
    expect(file.mimeType).toBe("application/pdf");
  });

  it("opens for the learner it belongs to", async () => {
    const file = await readEnrolmentDocument(sessionFor(["learner"], people.learner), documentId);
    expect(file.bytes.length).toBe(PDF.length);
  });

  it("does not open for another learner", async () => {
    await expect(
      readEnrolmentDocument(sessionFor(["learner"], people.classmate), documentId),
    ).rejects.toThrow();
  });

  it("does not open for an assessor, who reads evidence but has no reason to read an ID", async () => {
    await expect(
      readEnrolmentDocument(sessionFor(["assessor"], people.assessor), documentId),
    ).rejects.toThrow();
  });

  it("does not exist at all for another provider", async () => {
    await expect(
      readEnrolmentDocument(sessionFor(["tenant_admin"], people.outsider, otherOrganisationId), documentId),
    ).rejects.toBeInstanceOf(DocumentError);
  });
});
