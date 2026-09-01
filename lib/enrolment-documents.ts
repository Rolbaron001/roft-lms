import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { enrolmentDocuments, users } from "@/db/schema";
import { recordAudit } from "./audit";
import { buildStorageKey, putObject } from "./storage";
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
