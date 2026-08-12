import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { withPlatformScope, withTenant, type TenantDatabase } from "@/db/client";
import {
  assessmentDecisions,
  assessmentSubmissions,
  assessments,
  certificates,
  competencies,
  courseCompetencies,
  courses,
  enrolments,
  moderationRecords,
  organisations,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { can } from "./rbac";
import { raise } from "./notifications";

/**
 * Certificates.
 *
 * A certificate asserts that a named person demonstrated named competencies.
 * Everything else in the platform exists to make that assertion defensible, so
 * the rules for issuing one are deliberately strict:
 *
 *   - the learner completed the course;
 *   - every summative assessment on it was judged competent;
 *   - where a judgement required moderation, that moderation is finished.
 *
 * Nothing here is issued on a human's say-so alone. `issueCertificate` checks
 * eligibility itself and refuses if it is not met, so a certificate cannot be
 * produced by an administrator clicking the right button at the wrong time.
 */

export class CertificateError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "not_eligible"
      | "already_issued"
      | "not_permitted",
  ) {
    super(message);
    this.name = "CertificateError";
  }
}

/**
 * The public verification reference.
 *
 * Printed on the certificate and used by anyone checking it, so it must be
 * unguessable: a sequential number would let someone enumerate every
 * certificate the platform has ever issued. 20 random base32 characters is
 * about 100 bits, grouped for reading aloud over a telephone.
 *
 * Excludes I, L, O, U and 0/1 so a handwritten reference cannot be misread.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

export function generateVerificationReference(): string {
  const bytes = randomBytes(20);
  const characters = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]);
  const groups: string[] = [];
  for (let index = 0; index < characters.length; index += 5) {
    groups.push(characters.slice(index, index + 5).join(""));
  }
  return `ROFT-${groups.join("-")}`;
}

/** Accepts a reference however it was typed: spaced, lower case, unhyphenated. */
export function normaliseReference(input: string): string {
  const cleaned = input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^ROFT/, "");

  if (cleaned.length !== 20) return input.trim().toUpperCase();

  return `ROFT-${cleaned.match(/.{1,5}/g)!.join("-")}`;
}

export type EligibilityResult = {
  eligible: boolean;
  reasons: string[];
  competencies: { code: string; name: string; level?: string }[];
};

/**
 * Works out whether an enrolment has earned a certificate, and says precisely
 * why not when it has not.
 */
export async function checkEligibility(
  tx: TenantDatabase,
  enrolmentId: string,
): Promise<EligibilityResult & { enrolment: typeof enrolments.$inferSelect }> {
  const [enrolment] = await tx
    .select()
    .from(enrolments)
    .where(eq(enrolments.id, enrolmentId));

  if (!enrolment) {
    throw new CertificateError("Enrolment not found.", "not_found");
  }

  const reasons: string[] = [];

  if (enrolment.status !== "completed") {
    reasons.push("The learner has not completed every lesson.");
  }

  // Every published summative assessment on the course must have been judged
  // competent. A formative quiz is practice and does not gate a certificate.
  const summative = await tx
    .select({ id: assessments.id, title: assessments.title })
    .from(assessments)
    .where(
      and(
        eq(assessments.courseId, enrolment.courseId!),
        eq(assessments.purpose, "summative"),
        eq(assessments.status, "published"),
      ),
    );

  for (const assessment of summative) {
    const [latest] = await tx
      .select({
        submissionId: assessmentSubmissions.id,
        status: assessmentSubmissions.status,
        decisionOutcome: assessmentDecisions.outcome,
        moderationOutcome: moderationRecords.outcome,
        revisedOutcome: moderationRecords.revisedOutcome,
      })
      .from(assessmentSubmissions)
      .leftJoin(
        assessmentDecisions,
        eq(assessmentDecisions.submissionId, assessmentSubmissions.id),
      )
      .leftJoin(
        moderationRecords,
        eq(moderationRecords.decisionId, assessmentDecisions.id),
      )
      .where(
        and(
          eq(assessmentSubmissions.assessmentId, assessment.id),
          eq(assessmentSubmissions.userId, enrolment.userId),
        ),
      )
      .orderBy(desc(assessmentSubmissions.attemptNumber))
      .limit(1);

    if (!latest) {
      reasons.push(`"${assessment.title}" has not been attempted.`);
      continue;
    }

    if (!latest.decisionOutcome) {
      reasons.push(`"${assessment.title}" is waiting for an assessor.`);
      continue;
    }

    // A decision that was sent for moderation is not final until moderated.
    if (latest.status === "assessed") {
      reasons.push(`"${assessment.title}" is waiting for moderation.`);
      continue;
    }

    if (latest.status === "referred_back") {
      reasons.push(
        `"${assessment.title}" was referred back to the assessor by a moderator.`,
      );
      continue;
    }

    const outcome =
      latest.moderationOutcome === "overridden" && latest.revisedOutcome
        ? latest.revisedOutcome
        : latest.decisionOutcome;

    if (outcome !== "competent") {
      reasons.push(`"${assessment.title}" was judged not yet competent.`);
    }
  }

  // The competencies the certificate will attest to, frozen at issue so that
  // later edits to the course cannot change what an old certificate claims.
  const attested = await tx
    .select({
      code: competencies.code,
      name: competencies.name,
      level: courseCompetencies.proficiencyLevel,
    })
    .from(courseCompetencies)
    .innerJoin(
      competencies,
      eq(competencies.id, courseCompetencies.competencyId),
    )
    .where(eq(courseCompetencies.courseId, enrolment.courseId!))
    .orderBy(asc(competencies.code));

  return {
    eligible: reasons.length === 0,
    reasons,
    competencies: attested.map((row) => ({
      code: row.code,
      name: row.name,
      ...(row.level ? { level: row.level } : {}),
    })),
    enrolment,
  };
}

export async function certificateEligibility(
  session: AuthenticatedSession,
  enrolmentId: string,
): Promise<EligibilityResult> {
  return withTenant(session.organisationId, async (tx) => {
    const result = await checkEligibility(tx, enrolmentId);
    return {
      eligible: result.eligible,
      reasons: result.reasons,
      competencies: result.competencies,
    };
  });
}

export type IssueResult =
  | { ok: true; certificate: typeof certificates.$inferSelect; alreadyIssued: boolean }
  | { ok: false; reasons: string[] };

/**
 * Issues a certificate if the enrolment has earned one.
 *
 * Safe to call repeatedly: an enrolment that already has a live certificate
 * gets that one back rather than a second. Called automatically when a course
 * completes and when a moderation finishes, and available manually to a
 * tenant administrator.
 */
export async function issueCertificate(
  session: AuthenticatedSession,
  enrolmentId: string,
): Promise<IssueResult> {
  assertSessionCan(session, "certificate:issue");

  return withTenant(session.organisationId, (tx) =>
    issueWithin(tx, session.organisationId, enrolmentId, session.userId),
  );
}

/**
 * Issuance triggered by the system rather than by a person: a course being
 * completed, or a moderation finishing.
 *
 * Deliberately not permission-checked against an actor. The learner who
 * finishes the last lesson has no authority to issue certificates, and should
 * not need any — the platform issues it because the rules were met, which is
 * exactly what makes the certificate worth something.
 */
export async function issueCertificateAutomatically(
  organisationId: string,
  enrolmentId: string,
): Promise<IssueResult> {
  return withTenant(organisationId, (tx) =>
    issueWithin(tx, organisationId, enrolmentId, null),
  );
}

async function issueWithin(
  tx: TenantDatabase,
  organisationId: string,
  enrolmentId: string,
  actorId: string | null,
): Promise<IssueResult> {
  {
    const [existing] = await tx
      .select()
      .from(certificates)
      .where(
        and(
          eq(certificates.enrolmentId, enrolmentId),
          isNull(certificates.revokedAt),
        ),
      );

    if (existing) {
      return { ok: true as const, certificate: existing, alreadyIssued: true };
    }

    const eligibility = await checkEligibility(tx, enrolmentId);

    if (!eligibility.eligible) {
      return { ok: false as const, reasons: eligibility.reasons };
    }

    const [course] = await tx
      .select({ title: courses.title, version: courses.version })
      .from(courses)
      .where(eq(courses.id, eligibility.enrolment.courseId!));

    const [created] = await tx
      .insert(certificates)
      .values({
        organisationId,
        userId: eligibility.enrolment.userId,
        enrolmentId,
        verificationReference: generateVerificationReference(),
        title: course.title,
        competenciesAttested: eligibility.competencies,
      })
      .returning();

    await recordAudit(tx, {
      organisationId,
      actorId,
      action: actorId ? "certificate.issued" : "certificate.issued_automatically",
      entityType: "certificate",
      entityId: created.id,
      after: {
        enrolmentId,
        userId: eligibility.enrolment.userId,
        reference: created.verificationReference,
        competencies: eligibility.competencies.map((row) => row.code),
        courseVersion: course.version,
      },
    });

    await raise(tx, {
      organisationId,
      userId: eligibility.enrolment.userId,
      kind: "certificate.issued",
      subject: `Your certificate for "${course.title}"`,
      body: `Reference ${created.verificationReference}. Anyone can confirm it with that reference, without needing an account.`,
      linkPath: `/certificates/${created.id}`,
      entityType: "certificate",
      entityId: created.id,
      dedupeKey: `certificate:${created.id}`,
      channels: ["in_app", "email"],
    });

    return { ok: true as const, certificate: created, alreadyIssued: false };
  }
}

/**
 * Withdraws a certificate. The record is kept and marked revoked rather than
 * deleted, because anyone holding the reference must be told it is no longer
 * valid — a certificate that simply vanishes looks like a system fault.
 */
export async function revokeCertificate(
  session: AuthenticatedSession,
  certificateId: string,
  reason: string,
) {
  assertSessionCan(session, "certificate:issue");

  if (reason.trim().length < 5) {
    throw new CertificateError(
      "Give a reason for withdrawing the certificate; it is shown to anyone who verifies it.",
      "not_permitted",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [revoked] = await tx
      .update(certificates)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(certificates.id, certificateId),
          isNull(certificates.revokedAt),
        ),
      )
      .returning();

    if (!revoked) {
      throw new CertificateError(
        "That certificate does not exist, or has already been withdrawn.",
        "not_found",
      );
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "certificate.revoked",
      entityType: "certificate",
      entityId: certificateId,
      after: { reason },
    });

    return revoked;
  });
}

export async function listMyCertificates(session: AuthenticatedSession) {
  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: certificates.id,
        title: certificates.title,
        reference: certificates.verificationReference,
        issuedAt: certificates.issuedAt,
        revokedAt: certificates.revokedAt,
        competenciesAttested: certificates.competenciesAttested,
      })
      .from(certificates)
      .where(eq(certificates.userId, session.userId))
      .orderBy(desc(certificates.issuedAt)),
  );
}

export async function getCertificate(
  session: AuthenticatedSession,
  certificateId: string,
) {
  return withTenant(session.organisationId, async (tx) => {
    const [certificate] = await tx
      .select()
      .from(certificates)
      .where(eq(certificates.id, certificateId));

    if (!certificate) {
      throw new CertificateError("Certificate not found.", "not_found");
    }

    if (
      certificate.userId !== session.userId &&
      !can(session, "certificate:read_all")
    ) {
      throw new CertificateError(
        "That certificate belongs to someone else.",
        "not_permitted",
      );
    }

    const [holder] = await tx
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, certificate.userId));

    return { certificate, holder };
  });
}

export type PublicVerification = {
  found: boolean;
  valid: boolean;
  holderName?: string;
  title?: string;
  issuedBy?: string;
  issuedAt?: Date;
  competencies?: { code: string; name: string; level?: string }[];
  revokedAt?: Date | null;
  revokedReason?: string | null;
};

/**
 * Checks a reference without anyone signing in.
 *
 * This necessarily reads across tenants — whoever is verifying has a reference
 * and nothing else, and does not know which client issued it. It returns only
 * what is printed on the certificate itself, and nothing at all for a
 * reference that does not exist, so it cannot be used to discover who holds
 * accounts on the platform.
 */
export async function verifyByReference(
  reference: string,
): Promise<PublicVerification> {
  const normalised = normaliseReference(reference);

  if (!/^ROFT-[A-Z0-9-]{20,30}$/.test(normalised)) {
    return { found: false, valid: false };
  }

  return withPlatformScope(
    "public verification of a certificate by its printed reference",
    async (tx) => {
      const [row] = await tx
        .select({
          title: certificates.title,
          issuedAt: certificates.issuedAt,
          revokedAt: certificates.revokedAt,
          revokedReason: certificates.revokedReason,
          competenciesAttested: certificates.competenciesAttested,
          firstName: users.firstName,
          lastName: users.lastName,
          issuer: organisations.displayName,
        })
        .from(certificates)
        .innerJoin(users, eq(users.id, certificates.userId))
        .innerJoin(
          organisations,
          eq(organisations.id, certificates.organisationId),
        )
        .where(eq(certificates.verificationReference, normalised))
        .limit(1);

      if (!row) {
        return { found: false, valid: false };
      }

      return {
        found: true,
        valid: row.revokedAt === null,
        holderName: `${row.firstName} ${row.lastName}`,
        title: row.title,
        issuedBy: row.issuer,
        issuedAt: row.issuedAt,
        competencies: row.competenciesAttested,
        revokedAt: row.revokedAt,
        revokedReason: row.revokedReason,
      };
    },
  );
}
