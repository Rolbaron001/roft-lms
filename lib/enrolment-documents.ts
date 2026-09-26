import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  cohortMembers,
  cohorts,
  enrolmentDocuments,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { buildStorageKey, getObject, putObject } from "./storage";
import { detectMedia } from "./media";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import {
  CERTIFICATION_VALID_DAYS,
  CERTIFIED_KINDS,
  certificationExpired,
  DOCUMENT_LABEL,
  requiredDocuments,
  type EnrolmentReadiness,
  type EnrolmentRoute,
} from "./enrolment-document-shape";

// Re-exported so callers that already reach for the library keep working, and
// so there is one obvious import for the common case.
export {
  CERTIFICATION_VALID_DAYS,
  certificationExpired,
  DOCUMENT_LABEL,
  ENROLMENT_ROUTES,
  requiredDocuments,
  ROUTE_LABEL,
  type DocumentKind,
  type DocumentStatus,
  type EnrolmentReadiness,
  type EnrolmentRoute,
} from "./enrolment-document-shape";

/**
 * The documents a learner has to produce before they are registered.
 *
 * The client's enrolment procedure begins after an invoice and proof of
 * payment, and then collects a certified identity document, a certified copy
 * of the highest qualification, and a current CV, each checked before the
 * learner is entered anywhere.
 *
 * The platform held none of this, so the first moment anybody discovered a
 * missing certified copy was while assembling a statutory return - months
 * after the learner started, when the copy is far harder to get and the
 * deadline is days away. Collecting and checking at the point of enrolment is
 * the whole of the improvement.
 *
 * Documents are held against the person rather than one enrolment. A certified
 * identity document is a fact about the learner, not about the programme, and
 * asking for it again on their second qualification would be theatre.
 */

export class DocumentError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "invalid_state" | "rejected",
  ) {
    super(message);
    this.name = "DocumentError";
  }
}

/**
 * What a learner still owes on a given route.
 *
 * Only the most recent document of each kind counts. A learner who supplies a
 * fresh certified copy after the first expired should not still be failing on
 * the old one, and the earlier version is kept rather than deleted so the
 * record of what was held and when survives.
 */
export async function enrolmentReadiness(
  session: AuthenticatedSession,
  userId: string,
  route: EnrolmentRoute,
  asAt: Date = new Date(),
): Promise<EnrolmentReadiness> {
  return withTenant(session.organisationId, async (tx) => {
    const held = await tx
      .select({
        id: enrolmentDocuments.id,
        kind: enrolmentDocuments.kind,
        verification: enrolmentDocuments.verification,
        refusedReason: enrolmentDocuments.refusedReason,
        certifiedOn: enrolmentDocuments.certifiedOn,
      })
      .from(enrolmentDocuments)
      .where(eq(enrolmentDocuments.userId, userId))
      .orderBy(desc(enrolmentDocuments.createdAt));

    const documents = requiredDocuments(route).map((kind) => {
      const latest = held.find((row) => row.kind === kind);

      if (!latest) {
        return {
          kind,
          label: DOCUMENT_LABEL[kind],
          documentId: null,
          verification: "missing" as const,
          refusedReason: null,
          certifiedOn: null,
          expired: false,
          satisfied: false,
        };
      }

      const expired = certificationExpired(kind, latest.certifiedOn, asAt);

      return {
        kind,
        label: DOCUMENT_LABEL[kind],
        documentId: latest.id,
        verification: latest.verification,
        refusedReason: latest.refusedReason,
        certifiedOn: latest.certifiedOn,
        expired,
        // Accepted and current. A copy somebody accepted three months ago is
        // no longer evidence of anything, so the passage of time can take a
        // requirement back out of satisfaction without anybody touching it.
        satisfied: latest.verification === "accepted" && !expired,
      };
    });

    const outstanding = documents
      .filter((document) => !document.satisfied)
      .map((document) => {
        if (document.verification === "missing") {
          return `${document.label}: not supplied.`;
        }
        if (document.verification === "pending") {
          return `${document.label}: supplied, not yet checked.`;
        }
        if (document.verification === "refused") {
          return `${document.label}: refused${document.refusedReason ? ` (${document.refusedReason})` : ""}.`;
        }
        return `${document.label}: the certification has expired.`;
      });

    return {
      route,
      documents,
      outstanding,
      ready: outstanding.length === 0,
    };
  });
}

export const documentInput = z.object({
  userId: z.string().uuid(),
  kind: z.enum([
    "certified_id",
    "highest_qualification",
    "cv",
    "proof_of_payment",
    "learnership_agreement",
    "rpl_portfolio",
    "employment_equity_form",
    "other",
  ]),
  filename: z.string().trim().min(1).max(300),
  certifiedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
    .optional(),
});

/**
 * Files a document against a learner.
 *
 * The file's type is read from its own leading bytes rather than from what the
 * browser claimed, the same way assessment evidence is, and it is hashed on the
 * way in so any later alteration is detectable.
 *
 * A certified copy supplied with a certification date already in the past by
 * more than the validity window is refused at the point of upload rather than
 * accepted and flagged. The alternative is a coordinator accepting it, the
 * platform quietly marking the requirement unsatisfied, and nobody noticing
 * until the return.
 */
export async function recordEnrolmentDocument(
  session: AuthenticatedSession,
  input: z.infer<typeof documentInput> & { bytes: Uint8Array },
) {
  assertSessionCan(session, "enrolment:manage");
  const parsed = documentInput.parse(input);

  const detected = detectMedia(input.bytes, parsed.filename);
  if (!detected.ok) {
    throw new DocumentError(
      `That file was not accepted: ${detected.reason}`,
      "rejected",
    );
  }

  if (
    CERTIFIED_KINDS.includes(parsed.kind) &&
    certificationExpired(parsed.kind, parsed.certifiedOn ?? null)
  ) {
    throw new DocumentError(
      parsed.certifiedOn
        ? `That copy was certified on ${parsed.certifiedOn}, which is more than ${CERTIFICATION_VALID_DAYS} days ago. A certified copy has to be current when it is supplied.`
        : "Give the date this copy was certified. A copy whose certification date is unknown cannot be shown to be current.",
      "invalid_state",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [learner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, parsed.userId));

    if (!learner) throw new DocumentError("Learner not found.", "not_found");

    const key = buildStorageKey(
      session.organisationId,
      "enrolment-documents",
      parsed.filename,
    );

    const put = await putObject(key, input.bytes, detected.mimeType);

    const [created] = await tx
      .insert(enrolmentDocuments)
      .values({
        organisationId: session.organisationId,
        userId: parsed.userId,
        kind: parsed.kind,
        storageKey: key,
        filename: parsed.filename,
        mimeType: detected.mimeType,
        sizeBytes: input.bytes.byteLength,
        sha256: put.sha256,
        certifiedOn: parsed.certifiedOn ?? null,
        uploadedById: session.userId,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "enrolment_document.recorded",
      entityType: "enrolment_document",
      entityId: created.id,
      after: { userId: parsed.userId, kind: parsed.kind },
    });

    return created;
  });
}

/**
 * Accepts or refuses a document.
 *
 * This is the quality assurance step the client's procedure calls for, done at
 * collection rather than at reporting. Refusing requires a reason, because the
 * learner has to be told what to fix, and "rejected" on its own sends them
 * back with nothing to act on.
 */
export async function verifyEnrolmentDocument(
  session: AuthenticatedSession,
  documentId: string,
  outcome: "accepted" | "refused",
  reason?: string,
) {
  assertSessionCan(session, "enrolment:manage");

  if (outcome === "refused" && !reason?.trim()) {
    throw new DocumentError(
      "Say why it was refused. The learner has to be told what to correct, and a refusal with no reason sends them back with nothing to act on.",
      "invalid_state",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [document] = await tx
      .select({
        id: enrolmentDocuments.id,
        uploadedById: enrolmentDocuments.uploadedById,
        verification: enrolmentDocuments.verification,
      })
      .from(enrolmentDocuments)
      .where(eq(enrolmentDocuments.id, documentId));

    if (!document) throw new DocumentError("Document not found.", "not_found");

    await tx
      .update(enrolmentDocuments)
      .set({
        verification: outcome,
        refusedReason: outcome === "refused" ? reason!.trim() : null,
        verifiedById: session.userId,
        verifiedAt: new Date(),
      })
      .where(eq(enrolmentDocuments.id, documentId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "enrolment_document.verified",
      entityType: "enrolment_document",
      entityId: documentId,
      before: { verification: document.verification },
      after: { verification: outcome, reason: reason ?? null },
    });
  });
}

/**
 * One held document's file, for somebody entitled to see it.
 *
 * Until 26 September nothing served these back. A coordinator was asked to
 * accept or refuse a certified copy, including as illegible, without any way
 * to look at it.
 *
 * Entitled means the learner it belongs to, or somebody who manages
 * enrolments, which is who does the checking. Reading every learner's
 * evidence is not enough: an identity document is the most sensitive file the
 * platform holds, and an assessor has no reason to open one. The check is made
 * here against the record, so a document id is worth nothing on its own.
 */
export async function readEnrolmentDocument(
  session: AuthenticatedSession,
  documentId: string,
): Promise<{ bytes: Uint8Array; mimeType: string; filename: string; safeToEmbed: boolean }> {
  const document = await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({
        userId: enrolmentDocuments.userId,
        storageKey: enrolmentDocuments.storageKey,
        filename: enrolmentDocuments.filename,
      })
      .from(enrolmentDocuments)
      .where(eq(enrolmentDocuments.id, documentId));
    return row;
  });

  if (!document) throw new DocumentError("Document not found.", "not_found");

  if (document.userId !== session.userId) {
    assertSessionCan(session, "enrolment:manage");
  }

  const bytes = await getObject(document.storageKey);
  const detected = detectMedia(bytes, document.filename);

  return {
    bytes,
    mimeType: detected.ok ? detected.mimeType : "application/octet-stream",
    filename: document.filename,
    safeToEmbed: detected.ok ? detected.safeToEmbed : false,
  };
}

/** Everything held for a learner, newest of each kind first. */
export async function learnerDocuments(
  session: AuthenticatedSession,
  userId: string,
) {
  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: enrolmentDocuments.id,
        kind: enrolmentDocuments.kind,
        filename: enrolmentDocuments.filename,
        certifiedOn: enrolmentDocuments.certifiedOn,
        verification: enrolmentDocuments.verification,
        refusedReason: enrolmentDocuments.refusedReason,
        createdAt: enrolmentDocuments.createdAt,
      })
      .from(enrolmentDocuments)
      .where(eq(enrolmentDocuments.userId, userId))
      .orderBy(desc(enrolmentDocuments.createdAt)),
  );
}

// ---------------------------------------------------------------------------
// Proof of payment
// ---------------------------------------------------------------------------

export type PaymentStanding = {
  settled: boolean;
  /** Where it was settled, so a coordinator knows which record to look at. */
  by: "cohort" | "learner" | null;
  /** The cohort that covers them, where one does. */
  cohortName: string | null;
  reference: string | null;
  receivedAt: Date | null;
  /** Said as a person would say it, for the screen. */
  says: string;
};

/**
 * Whether this learner's place has been paid for.
 *
 * Curiosa's enrolment procedure opens with it - the process begins "once the
 * client has been invoiced and proof of payment has been received" - and
 * Roland confirmed on 15 September that it can be either: a client buys places
 * for a cohort, or a learner pays their own way.
 *
 * So both are asked, and either satisfies. Insisting on one shape would tell a
 * provider how to run its commercial relationships, which is not the
 * platform's business.
 *
 * The cohort is checked first because it is the commoner case and the cheaper
 * question: one payment covering ten learners is one row, and a per-learner
 * document only has to be looked for when no cohort covers them.
 */
export async function paymentStanding(
  session: AuthenticatedSession,
  userId: string,
): Promise<PaymentStanding> {
  return withTenant(session.organisationId, async (tx) => {
    const covering = await tx
      .select({
        name: cohorts.name,
        receivedAt: cohorts.paymentReceivedAt,
        reference: cohorts.paymentReference,
        invoicedAt: cohorts.invoicedAt,
      })
      .from(cohortMembers)
      .innerJoin(cohorts, eq(cohorts.id, cohortMembers.cohortId))
      .where(
        and(eq(cohortMembers.userId, userId), isNull(cohortMembers.leftAt)),
      );

    const paidCohort = covering.find((row) => row.receivedAt);

    if (paidCohort) {
      return {
        settled: true,
        by: "cohort" as const,
        cohortName: paidCohort.name,
        reference: paidCohort.reference,
        receivedAt: paidCohort.receivedAt,
        says: `Paid for by the client, against ${paidCohort.name}.`,
      };
    }

    // Nobody's cohort covers them, so look for their own.
    const [own] = await tx
      .select({
        verification: enrolmentDocuments.verification,
        createdAt: enrolmentDocuments.createdAt,
      })
      .from(enrolmentDocuments)
      .where(
        and(
          eq(enrolmentDocuments.userId, userId),
          eq(enrolmentDocuments.kind, "proof_of_payment"),
        ),
      )
      .orderBy(desc(enrolmentDocuments.createdAt));

    if (own?.verification === "accepted") {
      return {
        settled: true,
        by: "learner" as const,
        cohortName: null,
        reference: null,
        receivedAt: own.createdAt,
        says: "The learner supplied their own proof of payment.",
      };
    }

    if (own) {
      return {
        settled: false,
        by: null,
        cohortName: null,
        reference: null,
        receivedAt: null,
        says:
          own.verification === "refused"
            ? "The learner's proof of payment was refused."
            : "The learner has supplied a proof of payment, not yet checked.",
      };
    }

    const invoiced = covering.find((row) => row.invoicedAt);

    return {
      settled: false,
      by: null,
      cohortName: invoiced?.name ?? null,
      reference: null,
      receivedAt: null,
      says: invoiced
        ? `${invoiced.name} has been invoiced, but no payment is recorded against it yet.`
        : "Nothing recorded: neither the cohort nor the learner has a payment against them.",
    };
  });
}

/**
 * Records that a client has been invoiced for a cohort, and then that they
 * have paid.
 *
 * Two dates rather than a flag, because the gap between them is the thing a
 * coordinator chases, and a single "paid" tick would throw it away.
 */
export async function recordCohortPayment(
  session: AuthenticatedSession,
  cohortId: string,
  input: { invoicedOn?: string; receivedOn?: string; reference?: string },
) {
  assertSessionCan(session, "enrolment:manage");

  return withTenant(session.organisationId, async (tx) => {
    const fields: Record<string, unknown> = { updatedAt: new Date() };

    if (input.invoicedOn) {
      fields.invoicedAt = new Date(`${input.invoicedOn}T00:00:00Z`);
    }
    if (input.receivedOn) {
      fields.paymentReceivedAt = new Date(`${input.receivedOn}T00:00:00Z`);
      fields.paymentRecordedById = session.userId;
    }
    if (input.reference !== undefined) {
      fields.paymentReference = input.reference.trim() || null;
    }

    const [updated] = await tx
      .update(cohorts)
      .set(fields)
      .where(eq(cohorts.id, cohortId))
      .returning();

    if (!updated) {
      throw new DocumentError("No such cohort.", "not_found");
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "cohort.payment_recorded",
      entityType: "cohort",
      entityId: cohortId,
      after: {
        invoicedAt: updated.invoicedAt,
        paymentReceivedAt: updated.paymentReceivedAt,
        reference: updated.paymentReference,
      },
    });

    return updated;
  });
}
