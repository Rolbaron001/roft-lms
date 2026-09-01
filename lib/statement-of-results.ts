import { and, desc, eq, isNull } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  curriculumModules,
  organisations,
  qualifications,
  statementsOfResults,
  studyUnitModules,
  studyUnits,
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
 *
 * A statement may cover one study unit rather than the whole qualification.
 * Curiosa issues one after each study unit, which was raised against them at a
 * monitoring visit and written into their procedures afterwards. The two forms
 * differ only in scope: a study-unit statement confirms the criteria of the
 * modules that unit delivers, and the whole-qualification statement, which is
 * what the assessment centre wants, still confirms all of them. Both verify.
 */

export class StatementError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_eligible"
      | "not_found"
      | "already_issued"
      | "not_permitted"
      // A study unit that belongs elsewhere, or delivers nothing.
      | "invalid_state",
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
/**
 * The modules one study unit delivers, with the unit's own identity.
 *
 * A study unit is a teaching arrangement over the curriculum, not a division
 * of it: several units can draw on the same module, and a module can be split
 * across units. So the scope is read from the join rather than inferred, and a
 * unit that delivers nothing is refused rather than producing a statement that
 * confirms an empty set.
 */
async function studyUnitScope(
  session: AuthenticatedSession,
  qualificationId: string,
  studyUnitId: string,
): Promise<{ code: string; title: string; moduleCodes: Set<string> }> {
  return withTenant(session.organisationId, async (tx) => {
    const [unit] = await tx
      .select({
        code: studyUnits.code,
        title: studyUnits.title,
        qualificationId: studyUnits.qualificationId,
      })
      .from(studyUnits)
      .where(eq(studyUnits.id, studyUnitId));

    if (!unit) {
      throw new StatementError("Study unit not found.", "not_found");
    }

    if (unit.qualificationId !== qualificationId) {
      throw new StatementError(
        `${unit.code} belongs to a different qualification. A statement cannot cover a study unit the learner is not enrolled against.`,
        "invalid_state",
      );
    }

    const rows = await tx
      .select({ code: curriculumModules.code })
      .from(studyUnitModules)
      .innerJoin(
        curriculumModules,
        eq(curriculumModules.id, studyUnitModules.curriculumModuleId),
      )
      .where(eq(studyUnitModules.studyUnitId, studyUnitId));

    if (rows.length === 0) {
      throw new StatementError(
        `${unit.code} delivers no modules, so there is nothing for a statement to confirm. Link its modules first.`,
        "invalid_state",
      );
    }

    return {
      code: unit.code,
      title: unit.title,
      moduleCodes: new Set(rows.map((row) => row.code)),
    };
  });
}

export async function issueStatementOfResults(
  session: AuthenticatedSession,
  qualificationId: string,
  userId: string,
  /** One study unit, or null for the whole qualification. */
  studyUnitId: string | null = null,
): Promise<IssueOutcome> {
  assertSessionCan(session, "certificate:issue");

  const readiness = await qualificationReadiness(session, qualificationId, userId);

  // Which modules this statement speaks for. Null means all of them, and the
  // checks below then behave exactly as they did before study units existed.
  const scope = studyUnitId
    ? await studyUnitScope(session, qualificationId, studyUnitId)
    : null;

  // Every check below is narrowed to what this statement actually claims. For
  // a whole qualification that is the entire curriculum, exactly as before.
  // For a study unit it is the modules that unit delivers: without narrowing,
  // Study Unit 1's statement could not be issued until the whole qualification
  // was finished, which is the opposite of what issuing per unit is for.
  const inScope = (code: string) => !scope || scope.moduleCodes.has(code);

  const uncaptured = readiness.modulesWithoutCriteria.filter(inScope);

  if (uncaptured.length > 0) {
    return {
      ok: false,
      reasons: [
        `The curriculum is not fully captured: ${uncaptured.join(", ")} carry nothing to achieve. A statement issued now would confirm achievement of modules nobody has transcribed.`,
      ],
    };
  }

  const modulesInScope = readiness.components
    .flatMap((component) => component.modules)
    .filter((module) => inScope(module.code));

  if (modulesInScope.length === 0) {
    return {
      ok: false,
      reasons: [
        "There are no modules in scope for this statement, so there is nothing for it to confirm.",
      ],
    };
  }

  const outstandingInScope = readiness.outstanding.filter((item) =>
    inScope(item.moduleCode),
  );

  // Both conditions, not one. A module can be complete with nothing
  // outstanding against it and still not be finished, because completeness for
  // a work experience module is an accepted sign-off rather than a criterion,
  // and that absence is not always expressed as an outstanding line.
  if (outstandingInScope.length > 0 || !modulesInScope.every((m) => m.complete)) {
    const outstanding = outstandingInScope;
    const incomplete = modulesInScope
      .filter((m) => !m.complete)
      .map((m) => m.code);
    return {
      ok: false,
      reasons: [
        scope
          ? `${outstanding.length} requirement${outstanding.length === 1 ? "" : "s"} outstanding in ${scope.code}. A Statement of Results confirms that every internal assessment criterion in its scope has been achieved, so it cannot be issued until they are.`
          : `${outstanding.length} requirement${outstanding.length === 1 ? "" : "s"} outstanding. A Statement of Results confirms that every internal assessment criterion has been achieved, so it cannot be issued until they are.`,
        ...outstanding
          .slice(0, 10)
          .map(
            (item) =>
              `${item.moduleCode} ${item.criterionCode}: ${item.description}`,
          ),
        ...(outstanding.length > 10
          ? [`...and ${outstanding.length - 10} more.`]
          : []),
        ...(incomplete.length > 0 && outstanding.length === 0
          ? [
              `${incomplete.join(", ")} not yet complete. A work experience module is completed by an accepted sign-off rather than by criteria, so nothing is listed above.`,
            ]
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
          // Scoped, so a study-unit statement does not collide with the
          // whole-qualification one, nor with another unit's.
          studyUnitId
            ? eq(statementsOfResults.studyUnitId, studyUnitId)
            : isNull(statementsOfResults.studyUnitId),
          isNull(statementsOfResults.revokedAt),
        ),
      );

    if (existing) {
      throw new StatementError(
        scope
          ? `This learner already holds a Statement of Results for ${scope.code}. Withdraw it before issuing another, so two documents making the same claim are never in circulation.`
          : "This learner already holds a Statement of Results for this qualification. Withdraw it before issuing another, so two documents making the same claim are never in circulation.",
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
        curriculumCode: qualifications.curriculumCode,
        nqfLevel: qualifications.nqfLevel,
        totalCredits: qualifications.totalCredits,
        assessmentQualityPartner: qualifications.assessmentQualityPartner,
        accreditationNumber: qualifications.accreditationNumber,
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
      .filter((module) => !scope || scope.moduleCodes.has(module.code))
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
        studyUnitId,
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
            curriculumCode: qualification.curriculumCode,
            nqfLevel: qualification.nqfLevel,
            totalCredits: qualification.totalCredits,
            assessmentQualityPartner: qualification.assessmentQualityPartner,
            // The qualification's own number where it has one, falling back to
            // the provider's. An accreditation letter groups several
            // qualifications, so the specific one is the truthful answer.
            accreditationNumber:
              qualification.accreditationNumber ??
              provider?.accreditationNumber ??
              null,
          },
          studyUnit: scope ? { code: scope.code, title: scope.title } : null,
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
        studyUnitId,
        scope: scope ? scope.code : "whole qualification",
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
