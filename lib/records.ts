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
import { buildStorageKey, getObject, hashBytes, putObject } from "./storage";

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
// Who a document is for
// ---------------------------------------------------------------------------

export const LIBRARY_CATEGORIES = [
  "policy",
  "accreditation",
  "contract",
  "statutory",
  "operational",
  "learner_guide",
  "other",
] as const;

export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number];

/**
 * The categories a learner may ever be shown.
 *
 * Heidi, 21 September: "a learner must not see internal policies. Learners get
 * a learner quality management guide instead." The library had one switch,
 * `visibleToAll`, and nothing stopping it being ticked on a facilitator's
 * contract or the assessment policy. A rule that depends on whoever uploads
 * remembering is not a rule.
 *
 * So the audience follows the category:
 *
 *   learner_guide  written for them, so always shown to them
 *   statutory      the PAIA manual and POPIA notices, which are meant to be
 *                  available rather than internal, so the switch is a real
 *                  choice here and only here
 *   everything else  internal, and never shown, whatever the switch says
 *
 * "other" is internal deliberately. It is the catch-all, and the safe
 * direction for a document nobody has classified is not visible.
 */
export const LEARNER_FACING = new Set<LibraryCategory>([
  "learner_guide",
  "statutory",
]);

/** Whether this category can carry a learner-visible document at all. */
export function mayBeLearnerVisible(category: string): boolean {
  return LEARNER_FACING.has(category as LibraryCategory);
}

/**
 * Whether a learner may read this document.
 *
 * Applied on the way in and on the way out. Enforcing it only on upload would
 * leave every row filed before this rule existed exactly as visible as it was,
 * which is the case the rule is for: the fix has to close the documents
 * already there, not only the next one.
 */
export function isLearnerVisible(row: {
  category: string;
  visibleToAll: boolean;
}): boolean {
  if (row.category === "learner_guide") return true;
  return row.visibleToAll && mayBeLearnerVisible(row.category);
}

/**
 * What `visibleToAll` should be stored as, given the category.
 *
 * A learner guide is for learners by definition, so it is not left to a
 * checkbox somebody may forget. An internal category is forced off, so the
 * stored row says what is true rather than carrying a tick that the read path
 * quietly overrules.
 */
export function visibilityFor(category: string, asked: boolean): boolean {
  if (category === "learner_guide") return true;
  return asked && mayBeLearnerVisible(category);
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

const uploadInput = z.object({
  category: z.enum(LIBRARY_CATEGORIES),
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
 * What filing a document did, so the caller can say so.
 *
 * Roland, 22 September: every QMS policy was in the library four times over.
 * "There's not supposed to be duplicates. The QMS policy shouldn't file 4
 * times without overwriting with a warning and decision."
 */
export type LibraryFiling =
  /** New to the library. */
  | "filed"
  /** The same bytes are already here. Nothing was written. */
  | "already_held"
  /** A new version of something held, which it now supersedes. */
  | "superseded";

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
 *
 * Two things the caller no longer has to get right, both taken from
 * lib/programme-documents.ts, which solved this for programme material and
 * left the library behind:
 *
 *   The same bytes again are not a new version. Re-importing a folder filed
 *   its nine QMS policies again every time, and four imports produced
 *   thirty-six documents where nine were distinct, none of them marked as a
 *   copy of any other. Matched on the digest rather than the name, because
 *   the same file under two names is still the same file, and a different
 *   file under the same name is not.
 *
 *   The same title again *is* a new version, so it supersedes rather than
 *   sitting beside its predecessor. Inferred where the caller did not name
 *   one, which is what stops two documents both claiming to be current: the
 *   outcome this function's own comment above warns about was reachable by
 *   simply not filling in the supersedes field.
 */
export async function fileLibraryDocument(
  session: AuthenticatedSession,
  input: z.input<typeof uploadInput> & {
    filename: string;
    mimeType: string;
    bytes: Uint8Array;
  },
): Promise<{ id: string; title: string; outcome: LibraryFiling }> {
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

  /*
   * Asked before the bytes are written, not after.
   *
   * Storing first and then discovering the row is redundant leaves an orphan
   * object behind on every repeated import, which is the same waste one level
   * down.
   */
  const [same] = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ id: libraryDocuments.id, title: libraryDocuments.title })
      .from(libraryDocuments)
      .where(eq(libraryDocuments.contentHash, contentHash))
      .limit(1),
  );

  if (same) return { ...same, outcome: "already_held" as const };

  const storageKey = buildStorageKey(
    session.organisationId,
    "library",
    input.filename,
  );

  await putObject(storageKey, input.bytes, input.mimeType);

  return withTenant(session.organisationId, async (tx) => {
    // The current document of the same name and kind, which this replaces
    // unless the caller named a different one.
    const [previous] = parsed.supersedesId
      ? []
      : await tx
          .select({ id: libraryDocuments.id })
          .from(libraryDocuments)
          .where(
            and(
              eq(libraryDocuments.title, parsed.title),
              eq(libraryDocuments.category, parsed.category),
              eq(libraryDocuments.status, "current"),
            ),
          )
          .orderBy(desc(libraryDocuments.createdAt))
          .limit(1);

    const supersedesId = parsed.supersedesId ?? previous?.id ?? null;

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
        supersedesId,
        visibleToAll: visibilityFor(parsed.category, parsed.visibleToAll ?? false),
        uploadedById: session.userId,
      })
      .returning();

    if (supersedesId) {
      await tx
        .update(libraryDocuments)
        .set({ status: "superseded", updatedAt: new Date() })
        .where(eq(libraryDocuments.id, supersedesId));
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

    return {
      id: created.id,
      title: created.title,
      outcome: supersedesId ? ("superseded" as const) : ("filed" as const),
    };
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
      .filter((row) => mayReadAll || isLearnerVisible(row))
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
 * What filing these documents would do, before any of them are filed.
 *
 * Roland, 22 September: a repeated import must not file the same policy again
 * "without overwriting with a warning and decision." The decision belongs
 * before the commit, on the screen that already shows a proposal and waits, so
 * this answers the same two questions fileLibraryDocument will ask and answers
 * them early enough to be read.
 *
 * Nothing is written and nothing is locked. A document filed between this and
 * the commit is caught by the commit itself, which asks again.
 */
export async function libraryFilingPreview(
  session: AuthenticatedSession,
  incoming: { title: string; category: string; contentHash: string }[],
): Promise<{ alreadyHeld: string[]; willReplace: string[] }> {
  if (incoming.length === 0) return { alreadyHeld: [], willReplace: [] };

  const held = await withTenant(session.organisationId, (tx) =>
    tx
      .select({
        title: libraryDocuments.title,
        category: libraryDocuments.category,
        contentHash: libraryDocuments.contentHash,
        status: libraryDocuments.status,
      })
      .from(libraryDocuments),
  );

  const hashes = new Set(held.map((row) => row.contentHash));
  const current = new Set(
    held
      .filter((row) => row.status === "current")
      .map((row) => `${row.category}::${row.title}`),
  );

  const alreadyHeld: string[] = [];
  const willReplace: string[] = [];

  for (const one of incoming) {
    // The digest first: the same bytes are not a new version, whatever the
    // document is called.
    if (hashes.has(one.contentHash)) {
      alreadyHeld.push(one.title);
      continue;
    }
    if (current.has(`${one.category}::${one.title}`)) willReplace.push(one.title);
  }

  return { alreadyHeld, willReplace };
}

/**
 * Reads one library document's bytes, for the download route.
 *
 * The library listed titles and had no way to open any of them, so a learner
 * guide filed for learners was a line of text they could read the name of. The
 * same rule as the listing decides this, in one place rather than two: a
 * filter on a list that a URL walks straight past is not a restriction.
 */
export async function readLibraryDocument(
  session: AuthenticatedSession,
  id: string,
) {
  const mayReadAll = session.permissions.includes("records:read");

  const [row] = await withTenant(session.organisationId, (tx) =>
    tx
      .select({
        category: libraryDocuments.category,
        visibleToAll: libraryDocuments.visibleToAll,
        filename: libraryDocuments.filename,
        mimeType: libraryDocuments.mimeType,
        storageKey: libraryDocuments.storageKey,
      })
      .from(libraryDocuments)
      .where(eq(libraryDocuments.id, id)),
  );

  // Not found and not permitted answer the same way on purpose. Telling
  // somebody that a document exists but is not theirs is itself a disclosure.
  if (!row || !(mayReadAll || isLearnerVisible(row))) {
    throw new RecordsError("No such document.", "not_found");
  }

  return {
    filename: row.filename,
    mimeType: row.mimeType,
    bytes: await getObject(row.storageKey),
  };
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
