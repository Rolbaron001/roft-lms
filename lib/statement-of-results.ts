import { and, desc, eq, isNull } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  organisations,
  qualifications,
  statementsOfResults,
  users,
} from "@/db/schema";
import { qualificationReadiness } from "./eisa";
import { generateVerificationReference, referenceBody } from "./certificates";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * The Statement of Results.
 *
 * Under the OQSF a learner cannot sit the External Integrated Summative
 * Assessment on the provider's word. They arrive at the assessment centre with
 * this document and their identity document, and the centre checks it.
 *
 * The qualification document sets two conditions, and both are enforced here
 * rather than left to the person clicking the button:
 *
 *   1. It confirms "that all internal assessment criteria for all modules in
 *      the related curriculum document have been achieved". So it cannot be
 *      issued to a learner who is not eligible, and eligibility is the same
 *      calculation the readiness screen shows - not a second, kinder one.
 *
 *   2. It states "the final result and the date on which the competence in
 *      each module, of each component, was achieved". So it carries a date per
 *      module, which for a knowledge or practical module is the date its last
 *      criterion was achieved and for a work experience module is the date an
 *      assessor accepted the signed logbook.
 *
 * Everything is frozen at issue. A curriculum can be reimported, a module
 * renamed, a learner's name corrected; the statement in somebody's hand must
 * keep saying what it said when it was signed.
 */

export class StatementError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_eligible"
      | "not_found"
      | "already_issued"
      | "not_permitted",
  ) {
    super(message);
    this.name = "StatementError";
  }
}

export type IssueOutcome =
  | { ok: true; statementId: string; reference: string }
  | { ok: false; reasons: string[] };

/**
 * Issues a Statement of Results, or explains precisely why it cannot be.
 *
 * Refusing rather than warning, for the same reason course publishing refuses:
 * a warning gets clicked past, and the consequence here lands on a learner who
 * travels to an assessment centre and is turned away.
 */
export async function issueStatementOfResults(
  session: AuthenticatedSession,
  qualificationId: string,
  userId: string,
): Promise<IssueOutcome> {
  assertSessionCan(session, "certificate:issue");

  const readiness = await qualificationReadiness(session, qualificationId, userId);

  if (!readiness.curriculumComplete) {
    return {
      ok: false,
      reasons: [
        `The curriculum is not fully captured: ${readiness.modulesWithoutCriteria.join(", ")} carry nothing to achieve. A statement issued now would confirm achievement of modules nobody has transcribed.`,
      ],
    };
  }

  if (!readiness.eisaEligible) {
    const outstanding = readiness.outstanding;
    return {
      ok: false,
      reasons: [
        `${outstanding.length} requirement${outstanding.length === 1 ? "" : "s"} outstanding. A Statement of Results confirms that every internal assessment criterion has been achieved, so it cannot be issued until they are.`,
        ...outstanding
          .slice(0, 10)
          .map(
            (item) =>
              `${item.moduleCode} ${item.criterionCode}: ${item.description}`,
          ),
        ...(outstanding.length > 10
          ? [`...and ${outstanding.length - 10} more.`]
          : []),
      ],
    };
  }

  return withTenant(session.organisationId, async (tx) => {
    const [existing] = await tx
      .select({ id: statementsOfResults.id })
      .from(statementsOfResults)
      .where(
        and(
          eq(statementsOfResults.userId, userId),
          eq(statementsOfResults.qualificationId, qualificationId),
          isNull(statementsOfResults.revokedAt),
        ),
      );

    if (existing) {
      throw new StatementError(
        "This learner already holds a Statement of Results for this qualification. Withdraw it before issuing another, so two documents making the same claim are never in circulation.",
        "already_issued",
      );
    }

    const [learner] = await tx
      .select({
        firstName: users.firstName,
        lastName: users.lastName,
        nationalId: users.nationalId,
      })
      .from(users)
      .where(eq(users.id, userId));

    if (!learner) {
      throw new StatementError("Learner not found.", "not_found");
    }

    // Read from the qualification rather than from the readiness result: an
    // assessment centre checks the SAQA identifier, the curriculum code and the
    // NQF level against their own record of the qualification, so all of them
    // have to be on the document.
    const [qualification] = await tx
      .select({
        title: qualifications.title,
        saqaId: qualifications.saqaId,
        qctoCode: qualifications.qctoCode,
        nqfLevel: qualifications.nqfLevel,
        totalCredits: qualifications.totalCredits,
        assessmentQualityPartner: qualifications.assessmentQualityPartner,
      })
      .from(qualifications)
      .where(eq(qualifications.id, qualificationId));

    if (!qualification) {
      throw new StatementError("Qualification not found.", "not_found");
    }

    const [provider] = await tx
      .select({
        legalName: organisations.legalName,
        accreditationNumber: organisations.accreditationNumber,
      })
      .from(organisations)
      .where(eq(organisations.id, session.organisationId));

    const modules = readiness.components
      .flatMap((component) => component.modules)
      .map((module) => ({
        code: module.code,
        title: module.title,
        component: module.component,
        credits: module.credits,
        route: module.route,
        result: "Competent",
        achievedAt: module.competenceAchievedAt
          ? module.competenceAchievedAt.toISOString()
          : null,
      }));

    const reference = generateVerificationReference();

    const [created] = await tx
      .insert(statementsOfResults)
      .values({
        organisationId: session.organisationId,
        userId,
        qualificationId,
        verificationReference: reference,
        statement: {
          learner: {
            firstName: learner.firstName,
            lastName: learner.lastName,
            nationalId: learner.nationalId,
          },
          qualification: {
            title: qualification.title,
            saqaId: qualification.saqaId,
            qctoCode: qualification.qctoCode,
            nqfLevel: qualification.nqfLevel,
            totalCredits: qualification.totalCredits,
            assessmentQualityPartner: qualification.assessmentQualityPartner,
          },
          provider: {
            legalName: provider?.legalName ?? "",
            accreditationNumber: provider?.accreditationNumber ?? null,
          },
          modules,
        },
        issuedById: session.userId,
      })
      .returning({ id: statementsOfResults.id });

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "statement_of_results.issued",
      entityType: "statement_of_results",
      entityId: created.id,
      after: {
        userId,
        qualificationId,
        reference,
        modules: modules.length,
      },
    });

    return { ok: true as const, statementId: created.id, reference };
  });
}

export async function getStatementOfResults(
  session: AuthenticatedSession,
  statementId: string,
) {
  return withTenant(session.organisationId, async (tx) => {
    const [statement] = await tx
      .select()
      .from(statementsOfResults)
      .where(eq(statementsOfResults.id, statementId));

    if (!statement) {
      throw new StatementError("Statement not found.", "not_found");
    }

    // The learner it belongs to, or anybody entitled to see other people's
    // records. A statement is the learner's document above all.
    const mine = statement.userId === session.userId;
    if (!mine && !session.permissions.includes("enrolment:read_all")) {
      throw new StatementError("Statement not found.", "not_found");
    }

    return statement;
  });
}

export async function listStatementsFor(
  session: AuthenticatedSession,
  userId: string,
) {
  if (userId !== session.userId) {
    assertSessionCan(session, "enrolment:read_all");
  }

  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: statementsOfResults.id,
        verificationReference: statementsOfResults.verificationReference,
        issuedAt: statementsOfResults.issuedAt,
        revokedAt: statementsOfResults.revokedAt,
        qualificationId: statementsOfResults.qualificationId,
      })
      .from(statementsOfResults)
      .where(eq(statementsOfResults.userId, userId))
      .orderBy(desc(statementsOfResults.issuedAt)),
  );
}

/**
 * Withdraws a statement.
 *
 * Never deleted. An assessment centre may already hold a copy, and the honest
 * answer to "is this document still valid" is "no, withdrawn on this date for
 * this reason" rather than "no such reference".
 */
export async function revokeStatementOfResults(
  session: AuthenticatedSession,
  statementId: string,
  reason: string,
) {
  assertSessionCan(session, "certificate:issue");

  if (reason.trim().length < 8) {
    throw new StatementError(
      "Give a reason. It is shown to anybody who checks the reference.",
      "not_permitted",
    );
  }

  await withTenant(session.organisationId, async (tx) => {
    const [statement] = await tx
      .select({ id: statementsOfResults.id, revokedAt: statementsOfResults.revokedAt })
      .from(statementsOfResults)
      .where(eq(statementsOfResults.id, statementId));

    if (!statement) {
      throw new StatementError("Statement not found.", "not_found");
    }
    if (statement.revokedAt) {
      throw new StatementError("That statement is already withdrawn.", "not_permitted");
    }

    await tx
      .update(statementsOfResults)
      .set({ revokedAt: new Date(), revokedReason: reason.trim() })
      .where(eq(statementsOfResults.id, statementId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "statement_of_results.revoked",
      entityType: "statement_of_results",
      entityId: statementId,
      after: { reason: reason.trim() },
    });
  });
}

export type StatementVerification = {
  found: boolean;
  valid: boolean;
  learnerName?: string;
  qualificationTitle?: string;
  issuedBy?: string;
  issuedAt?: Date;
  moduleCount?: number;
  revokedAt?: Date | null;
  revokedReason?: string | null;
};

/**
 * Checks a reference without anyone signing in, so an assessment centre can
 * confirm a statement handed to them at the door.
 *
 * Cross-tenant of necessity: whoever is checking holds a reference and nothing
 * else, and does not know which provider issued it. It returns only what is
 * printed on the statement itself, and nothing at all for a reference that
 * does not exist, so it cannot be used to discover who holds records here.
 */
export async function verifyStatement(
  reference: string,
): Promise<StatementVerification> {
  const body = referenceBody(reference);
  if (!body) return { found: false, valid: false };

  const rows = await withPlatformScope(
    "verifying a Statement of Results reference presented at an assessment centre",
    (tx) =>
      tx
        .select({
          statement: statementsOfResults.statement,
          issuedAt: statementsOfResults.issuedAt,
          revokedAt: statementsOfResults.revokedAt,
          revokedReason: statementsOfResults.revokedReason,
        })
        .from(statementsOfResults)
        .where(eq(statementsOfResults.verificationBody, body)),
  );

  const found = rows[0];
  if (!found) return { found: false, valid: false };

  return {
    found: true,
    valid: found.revokedAt === null,
    learnerName: `${found.statement.learner.firstName} ${found.statement.learner.lastName}`,
    qualificationTitle: found.statement.qualification.title,
    issuedBy: found.statement.provider.legalName,
    issuedAt: found.issuedAt,
    moduleCount: found.statement.modules.length,
    revokedAt: found.revokedAt,
    revokedReason: found.revokedReason,
  };
}
