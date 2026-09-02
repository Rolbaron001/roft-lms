import { and, asc, desc, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  certificates,
  disposalDecisions,
  libraryDocuments,
  organisations,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { buildStorageKey, hashBytes, putObject } from "./storage";

/**
 * The general document library, retention and controlled disposal.
 *
 * The three things standing between the platform and being the client's system
 * of record rather than a working copy of one.
 *
 * The library is the gap. The platform already holds documents attached to a
 * learner, an enrolment or a qualification; the client's Records Management
 * procedure also covers policies, accreditation letters, contracts and the
 * PAIA manual, and there was nowhere for those. A record system missing the
 * accreditation letter is not the system of record.
 *
 * Retention is in their procedure and was nowhere in the platform: "archive
 * learner documentation within one month after certification". The platform
 * holds the certification date, so it can say what is due.
 *
 * Disposal is the one that needed care. Archiving happens on a schedule;
 * destruction never does. A record an external verifier may still ask for is
 * not something an unattended job should destroy, and a record that quietly
 * disappeared is worse than one kept too long. Every destruction is a row with
 * a person's name and a reason on it.
 */

export class RecordsError extends Error {
  constructor(
    message: string,
    readonly reason: "not_found" | "invalid" | "needs_reason" | "too_large",
  ) {
    super(message);
    this.name = "RecordsError";
  }
}

/** Beyond this a document belongs in object storage, not in a form post. */
export const MAX_LIBRARY_BYTES = 25 * 1024 * 1024;

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

const uploadInput = z.object({
  category: z.enum([
    "policy",
    "accreditation",
    "contract",
    "statutory",
    "operational",
    "other",
  ]),
  title: z.string().trim().min(3).max(300),
  description: z.string().trim().max(2000).optional(),
  reference: z.string().trim().max(100).optional(),
  version: z.string().trim().max(50).optional(),
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  supersedesId: z.string().uuid().optional(),
  visibleToAll: z.boolean().optional(),
});

/**
 * Files a business document.
 *
 * Superseding is one act: naming the document this replaces marks that one
 * superseded in the same transaction. The alternative is remembering to go and
 * change a flag afterwards, which is the step that gets missed and leaves two
 * documents both claiming to be current.
 *
 * The superseded one is kept. The policy that governed in March is what an
 * audit of March asks about, and a library holding only the current version
 * cannot answer it.
 */
export async function fileLibraryDocument(
  session: AuthenticatedSession,
  input: z.input<typeof uploadInput> & {
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
  },
) {
  assertSessionCan(session, "records:manage");
  const parsed = uploadInput.parse(input);

  if (input.bytes.byteLength === 0) {
    throw new RecordsError("That file is empty.", "invalid");
  }
  if (input.bytes.byteLength > MAX_LIBRARY_BYTES) {
    throw new RecordsError(
      `That file is larger than ${Math.round(MAX_LIBRARY_BYTES / 1024 / 1024)} MB.`,
      "too_large",
    );
  }

  const contentHash = hashBytes(input.bytes);
  const storageKey = buildStorageKey(
    session.organisationId,
    "library",
    input.filename,
  );

  await putObject(storageKey, input.bytes, input.mimeType);

  return withTenant(session.organisationId, async (tx) => {
    const [created] = await tx
      .insert(libraryDocuments)
      .values({
        organisationId: session.organisationId,
        category: parsed.category,
        title: parsed.title,
        description: parsed.description || null,
        reference: parsed.reference || null,
        version: parsed.version || null,
        filename: input.filename,
        storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.bytes.byteLength,
        contentHash,
        effectiveFrom: parsed.effectiveFrom ?? null,
        expiresOn: parsed.expiresOn ?? null,
        supersedesId: parsed.supersedesId ?? null,
        visibleToAll: parsed.visibleToAll ?? false,
        uploadedById: session.userId,
      })
      .returning();

    if (parsed.supersedesId) {
      await tx
        .update(libraryDocuments)
        .set({ status: "superseded", updatedAt: new Date() })
        .where(eq(libraryDocuments.id, parsed.supersedesId));
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "records.document_filed",
      entityType: "library_document",
      entityId: created.id,
      after: {
        title: created.title,
        category: created.category,
        supersedes: created.supersedesId,
        contentHash: created.contentHash,
      },
    });

    return created;
  });
}

/**
 * The library, filtered to what this reader may see.
 *
 * Somebody without `records:read` sees only the documents marked visible to
 * everybody - the code of conduct, the learner policies. A facilitator's
 * contract is in the same library and is not theirs to read.
 */
export async function library(
  session: AuthenticatedSession,
  options: { includeSuperseded?: boolean } = {},
) {
  const mayReadAll = session.permissions.includes("records:read");

  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({
        id: libraryDocuments.id,
        category: libraryDocuments.category,
        title: libraryDocuments.title,
        description: libraryDocuments.description,
        reference: libraryDocuments.reference,
        version: libraryDocuments.version,
        filename: libraryDocuments.filename,
        sizeBytes: libraryDocuments.sizeBytes,
        effectiveFrom: libraryDocuments.effectiveFrom,
        expiresOn: libraryDocuments.expiresOn,
        status: libraryDocuments.status,
        visibleToAll: libraryDocuments.visibleToAll,
        supersedesId: libraryDocuments.supersedesId,
        uploadedFirstName: users.firstName,
        uploadedLastName: users.lastName,
        createdAt: libraryDocuments.createdAt,
      })
      .from(libraryDocuments)
      .innerJoin(users, eq(users.id, libraryDocuments.uploadedById))
      .orderBy(libraryDocuments.category, libraryDocuments.title);

    return rows
      .filter((row) => mayReadAll || row.visibleToAll)
      .filter(
        (row) =>
          options.includeSuperseded ||
          row.status === "current" ||
          row.status === "archived",
      )
      .map(({ uploadedFirstName, uploadedLastName, ...row }) => ({
        ...row,
        uploadedByName: `${uploadedFirstName} ${uploadedLastName}`,
      }));
  });
}

/**
 * Documents whose expiry has passed, or is about to.
 *
 * An expired tax clearance or B-BBEE certificate is the kind of thing nobody
 * notices until somebody asks for it, which is always the week it is needed.
 */
export async function expiringDocuments(
  session: AuthenticatedSession,
  asAt: string,
  horizon: string,
) {
  assertSessionCan(session, "records:read");

  return withTenant(session.organisationId, async (tx) =>
    tx
      .select({
        id: libraryDocuments.id,
        title: libraryDocuments.title,
        category: libraryDocuments.category,
        expiresOn: libraryDocuments.expiresOn,
      })
      .from(libraryDocuments)
      .where(
        and(
          eq(libraryDocuments.status, "current"),
          lte(libraryDocuments.expiresOn, horizon),
        ),
      )
      .orderBy(asc(libraryDocuments.expiresOn)),
  );
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * The date a learner's records may be disposed of.
 *
 * Counted from certification rather than from enrolment, because that is what
 * the procedure says and because a learner who never certificated has no date
 * to count from - their records stay until somebody decides otherwise, which
 * is the right default.
 */
export function retentionDueOn(
  certifiedOn: string,
  retentionYears: number,
): string {
  const at = new Date(`${certifiedOn}T00:00:00Z`);
  at.setUTCFullYear(at.getUTCFullYear() + retentionYears);
  return at.toISOString().slice(0, 10);
}

/**
 * Learners whose records have passed the tenant's retention period.
 *
 * Derived from the certificate date the platform already holds, so it is a
 * question rather than a stored state and cannot go stale. Nothing is deleted
 * or archived by looking.
 */
export async function retentionDue(
  session: AuthenticatedSession,
  asAt: string,
) {
  assertSessionCan(session, "records:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [organisation] = await tx
      .select({ years: organisations.dataRetentionYears })
      .from(organisations)
      .where(eq(organisations.id, session.organisationId));

    const years = organisation?.years ?? 5;

    const issued = await tx
      .select({
        userId: certificates.userId,
        firstName: users.firstName,
        lastName: users.lastName,
        issuedAt: certificates.issuedAt,
      })
      .from(certificates)
      .innerJoin(users, eq(users.id, certificates.userId))
      .orderBy(certificates.issuedAt);

    const decided = await tx
      .select({ learnerId: disposalDecisions.learnerId })
      .from(disposalDecisions)
      .where(eq(disposalDecisions.subject, "learner_documents"));

    const already = new Set(
      decided.map((row) => row.learnerId).filter(Boolean) as string[],
    );

    return issued
      .filter((row) => !already.has(row.userId))
      .map((row) => ({
        userId: row.userId,
        name: `${row.firstName} ${row.lastName}`,
        certifiedOn: row.issuedAt.toISOString().slice(0, 10),
        dueOn: retentionDueOn(
          row.issuedAt.toISOString().slice(0, 10),
          years,
        ),
      }))
      .filter((row) => row.dueOn <= asAt)
      .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  });
}

const disposalInput = z.object({
  subject: z.enum([
    "learner_documents",
    "assessment_evidence",
    "library_document",
  ]),
  learnerId: z.string().uuid().optional(),
  libraryDocumentId: z.string().uuid().optional(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["archived", "destroyed", "retained"]),
  reason: z.string().trim().max(2000).optional(),
});

/**
 * Records what was decided about a record past its retention date.
 *
 * Destruction and deliberate retention both need a reason. Destruction because
 * it is irreversible and somebody will one day ask why a record an external
 * verifier wanted is not there; retention because "we kept everything" is a
 * position a provider under investigation takes deliberately, and the reason
 * for it belongs in the file rather than in somebody's memory.
 *
 * Archiving needs none. It moves a record out of the way and destroys nothing,
 * and demanding a paragraph for it would make people stop doing it.
 *
 * Nothing here deletes anything. The decision is the record; acting on it
 * against object storage is a separate, deliberate step, and is noted in the
 * queue as such.
 */
export async function recordDisposal(
  session: AuthenticatedSession,
  input: z.input<typeof disposalInput>,
) {
  assertSessionCan(session, "records:manage");
  const parsed = disposalInput.parse(input);

  if (parsed.status !== "archived" && !parsed.reason) {
    throw new RecordsError(
      parsed.status === "destroyed"
        ? "Destroying a record is irreversible, and somebody will one day ask why a record a verifier wanted is not there. Say why."
        : "Say why this is being kept beyond its retention period. It is a position rather than an oversight, and the reason belongs in the file.",
      "needs_reason",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [created] = await tx
      .insert(disposalDecisions)
      .values({
        organisationId: session.organisationId,
        subject: parsed.subject,
        learnerId: parsed.learnerId ?? null,
        libraryDocumentId: parsed.libraryDocumentId ?? null,
        dueOn: parsed.dueOn,
        status: parsed.status,
        reason: parsed.reason || null,
        decidedById: session.userId,
        decidedAt: new Date(),
      })
      .returning();

    if (parsed.libraryDocumentId && parsed.status === "archived") {
      await tx
        .update(libraryDocuments)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(libraryDocuments.id, parsed.libraryDocumentId));
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "records.disposal_decided",
      entityType: "disposal_decision",
      entityId: created.id,
      after: {
        subject: created.subject,
        status: created.status,
        reason: created.reason,
      },
    });

    return created;
  });
}

/** Every disposal decision, newest first. The destruction register. */
export async function disposalRegister(session: AuthenticatedSession) {
  assertSessionCan(session, "records:read");

  return withTenant(session.organisationId, async (tx) =>
    tx
      .select({
        id: disposalDecisions.id,
        subject: disposalDecisions.subject,
        status: disposalDecisions.status,
        reason: disposalDecisions.reason,
        dueOn: disposalDecisions.dueOn,
        decidedAt: disposalDecisions.decidedAt,
        learnerId: disposalDecisions.learnerId,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(disposalDecisions)
      .leftJoin(users, eq(users.id, disposalDecisions.decidedById))
      .orderBy(desc(disposalDecisions.decidedAt)),
  );
}
