import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  creditTransfers,
  curriculumModules,
  moduleExemptions,
  qualifications,
  rplApplications,
  rplJudgements,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Recognition of prior learning, and credit accumulation and transfer.
 *
 * Two routes to the same place - a module the learner does not have to do -
 * and they are kept apart because what is being judged differs. RPL asks
 * whether this person can do the work, on evidence they assemble. CAT asks
 * whether a qualification they already hold covers this module's outcomes, on
 * a certificate somebody else issued.
 *
 * RPL is the highest-risk route in the framework and the first thing an
 * external verifier looks at, because it is the only way to hold a
 * qualification without having been taught. What protects it is not the
 * judgement but the two things either side: an advisory session where somebody
 * tells the candidate what evidence is actually wanted, and moderation of every
 * judgement rather than a sample.
 *
 * Both are enforced. So is the limit on how much of a qualification may be
 * obtained this way, checked when an exemption is granted rather than at the
 * end - by the end the learner has already been told.
 */

export class RecognitionError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "not_found"
      | "invalid"
      | "needs_advice"
      | "needs_moderation"
      | "over_limit"
      | "already_exempt"
      | "closed",
  ) {
    super(message);
    this.name = "RecognitionError";
  }
}

// ---------------------------------------------------------------------------
// The transfer limit
// ---------------------------------------------------------------------------

/**
 * Whether one more exemption would take a learner past the limit.
 *
 * Pure, and by credits rather than by module count, because modules are not
 * the same size and a learner exempted from every small one has not been
 * exempted from half the qualification.
 *
 * A module with no credits recorded counts as one credit rather than zero. The
 * alternative is that an incompletely captured qualification silently has no
 * limit at all, which is the wrong way to fail.
 */
export function exemptionWouldExceed(input: {
  moduleCredits: { moduleId: string; credits: number | null }[];
  alreadyExempt: string[];
  proposed: string;
  maxPercent: number;
}): { exceeds: boolean; wouldBePercent: number; maxPercent: number } {
  const weight = (credits: number | null) =>
    credits === null || credits <= 0 ? 1 : credits;

  const total = input.moduleCredits.reduce(
    (sum, row) => sum + weight(row.credits),
    0,
  );

  if (total === 0) {
    return { exceeds: false, wouldBePercent: 0, maxPercent: input.maxPercent };
  }

  const exemptIds = new Set([...input.alreadyExempt, input.proposed]);
  const exempt = input.moduleCredits
    .filter((row) => exemptIds.has(row.moduleId))
    .reduce((sum, row) => sum + weight(row.credits), 0);

  const wouldBePercent = Math.round((exempt / total) * 100);

  return {
    exceeds: wouldBePercent > input.maxPercent,
    wouldBePercent,
    maxPercent: input.maxPercent,
  };
}

/**
 * Grants an exemption, having checked the limit.
 *
 * Shared by both routes because everything after the judgement is identical.
 * The limit is checked here, at the single point an exemption comes into
 * existence, so neither route can breach it and neither has to remember to
 * look.
 */
async function grantExemption(
  session: AuthenticatedSession,
  input: {
    learnerId: string;
    curriculumModuleId: string;
    source: "rpl" | "cat";
    rplJudgementId?: string;
    creditTransferId?: string;
    grantedOn: string;
  },
) {
  return withTenant(session.organisationId, async (tx) => {
    const [module] = await tx
      .select({
        id: curriculumModules.id,
        title: curriculumModules.title,
        qualificationId: curriculumModules.qualificationId,
      })
      .from(curriculumModules)
      .where(eq(curriculumModules.id, input.curriculumModuleId));

    if (!module) {
      throw new RecognitionError("That module was not found.", "not_found");
    }

    const [already] = await tx
      .select({ id: moduleExemptions.id })
      .from(moduleExemptions)
      .where(
        and(
          eq(moduleExemptions.learnerId, input.learnerId),
          eq(moduleExemptions.curriculumModuleId, input.curriculumModuleId),
        ),
      );

    if (already) {
      throw new RecognitionError(
        `${module.title} is already exempted for this learner.`,
        "already_exempt",
      );
    }

    const [qualification] = await tx
      .select({ maxExemptPercent: qualifications.maxExemptPercent })
      .from(qualifications)
      .where(eq(qualifications.id, module.qualificationId));

    const siblings = await tx
      .select({ moduleId: curriculumModules.id, credits: curriculumModules.credits })
      .from(curriculumModules)
      .where(eq(curriculumModules.qualificationId, module.qualificationId));

    const existing = await tx
      .select({ moduleId: moduleExemptions.curriculumModuleId })
      .from(moduleExemptions)
      .where(
        and(
          eq(moduleExemptions.learnerId, input.learnerId),
          inArray(
            moduleExemptions.curriculumModuleId,
            siblings.map((row) => row.moduleId),
          ),
        ),
      );

    const limit = exemptionWouldExceed({
      moduleCredits: siblings,
      alreadyExempt: existing.map((row) => row.moduleId),
      proposed: input.curriculumModuleId,
      maxPercent: qualification?.maxExemptPercent ?? 50,
    });

    if (limit.exceeds) {
      throw new RecognitionError(
        `Exempting ${module.title} would take this learner to ${limit.wouldBePercent} per cent of the qualification recognised without being taught, and the limit on this qualification is ${limit.maxPercent}. The rest has to be done as ordinary learning, or the limit changed on the qualification with a reason for it.`,
        "over_limit",
      );
    }

    const [created] = await tx
      .insert(moduleExemptions)
      .values({
        organisationId: session.organisationId,
        learnerId: input.learnerId,
        curriculumModuleId: input.curriculumModuleId,
        source: input.source,
        rplJudgementId: input.rplJudgementId ?? null,
        creditTransferId: input.creditTransferId ?? null,
        grantedOn: input.grantedOn,
        grantedById: session.userId,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "recognition.exemption_granted",
      entityType: "module_exemption",
      entityId: created.id,
      after: {
        learnerId: created.learnerId,
        curriculumModuleId: created.curriculumModuleId,
        source: created.source,
        percentAfter: limit.wouldBePercent,
      },
    });

    return created;
  });
}

// ---------------------------------------------------------------------------
// RPL
// ---------------------------------------------------------------------------

const applicationInput = z.object({
  learnerId: z.string().uuid(),
  qualificationId: z.string().uuid(),
  appliedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function openRplApplication(
  session: AuthenticatedSession,
  input: z.input<typeof applicationInput>,
) {
  assertSessionCan(session, "recognition:manage");
  const parsed = applicationInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [created] = await tx
      .insert(rplApplications)
      .values({
        organisationId: session.organisationId,
        learnerId: parsed.learnerId,
        qualificationId: parsed.qualificationId,
        appliedOn: parsed.appliedOn,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "rpl.application_opened",
      entityType: "rpl_application",
      entityId: created.id,
      after: { learnerId: created.learnerId, qualificationId: created.qualificationId },
    });

    return created;
  });
}

/**
 * Records the advisory session.
 *
 * The step candidates are failed by when it is skipped. Somebody assembles a
 * folder of certificates nobody told them were the wrong kind of evidence, is
 * judged not yet competent on the strength of it, and concludes the process
 * was a formality. What was actually advised is recorded, not just that a
 * meeting happened, because "we advised them" is the claim a refused candidate
 * disputes.
 */
export async function recordAdvisory(
  session: AuthenticatedSession,
  input: { applicationId: string; advisedOn: string; adviceGiven: string },
) {
  assertSessionCan(session, "recognition:manage");

  const advice = input.adviceGiven.trim();
  if (advice.length < 30) {
    throw new RecognitionError(
      "Record what the candidate was told to gather. A refused candidate disputes this paragraph, and 'advised on requirements' is not one.",
      "invalid",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [updated] = await tx
      .update(rplApplications)
      .set({
        advisorId: session.userId,
        advisedOn: input.advisedOn,
        adviceGiven: advice,
        status: "advised",
        updatedAt: new Date(),
      })
      .where(eq(rplApplications.id, input.applicationId))
      .returning();

    if (!updated) throw new RecognitionError("Application not found.", "not_found");
    return updated;
  });
}

const judgementInput = z.object({
  applicationId: z.string().uuid(),
  curriculumModuleId: z.string().uuid(),
  competent: z.boolean(),
  rationale: z
    .string()
    .trim()
    .min(
      30,
      "Say what the evidence was and why it satisfies the module. This paragraph is the whole of the judgement, and the first thing an external verifier reads.",
    ),
  judgedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * An assessor's judgement on one module.
 *
 * Refuses before the advisory session has happened. A candidate judged without
 * being told what was wanted has been set up to fail, and the platform is the
 * only thing in a position to notice the session never took place.
 *
 * Grants nothing on its own. The exemption follows moderation.
 */
export async function recordRplJudgement(
  session: AuthenticatedSession,
  input: z.input<typeof judgementInput>,
) {
  assertSessionCan(session, "assessment:assess");
  const parsed = judgementInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [application] = await tx
      .select()
      .from(rplApplications)
      .where(eq(rplApplications.id, parsed.applicationId));

    if (!application) {
      throw new RecognitionError("Application not found.", "not_found");
    }
    if (application.closedAt) {
      throw new RecognitionError("That application is closed.", "closed");
    }
    if (!application.advisedOn) {
      throw new RecognitionError(
        "This candidate has not had an advisory session. Judging prior learning against requirements nobody explained is how a candidate is failed for assembling the wrong evidence. Record the advice first.",
        "needs_advice",
      );
    }

    const [created] = await tx
      .insert(rplJudgements)
      .values({
        organisationId: session.organisationId,
        applicationId: parsed.applicationId,
        curriculumModuleId: parsed.curriculumModuleId,
        competent: parsed.competent,
        rationale: parsed.rationale,
        assessorId: session.userId,
        judgedOn: parsed.judgedOn,
      })
      .returning();

    await tx
      .update(rplApplications)
      .set({ status: "judged", updatedAt: new Date() })
      .where(eq(rplApplications.id, parsed.applicationId));

    return created;
  });
}

/**
 * A moderator's confirmation, and the exemption that follows it.
 *
 * Every RPL judgement is moderated, not a sample. The cohort-size sampling rule
 * that governs ordinary assessment exists because ordinary assessment has a
 * paper trail of taught sessions behind it; RPL has none, which is exactly why
 * all of it is looked at twice.
 *
 * The exemption is created here rather than at judgement, so that an
 * unmoderated judgement grants nothing and a moderator who disagrees leaves
 * nothing to unwind.
 */
export async function moderateRplJudgement(
  session: AuthenticatedSession,
  input: {
    judgementId: string;
    agreed: boolean;
    comment: string;
    grantedOn: string;
  },
) {
  assertSessionCan(session, "assessment:moderate");

  const comment = input.comment.trim();
  if (comment.length < 10) {
    throw new RecognitionError(
      "Say what you looked at and whether you agree. A moderation with no comment is a signature.",
      "invalid",
    );
  }

  const judgement = await withTenant(session.organisationId, async (tx) => {
    const [found] = await tx
      .select()
      .from(rplJudgements)
      .where(eq(rplJudgements.id, input.judgementId));

    if (!found) throw new RecognitionError("Judgement not found.", "not_found");

    if (found.assessorId === session.userId) {
      throw new RecognitionError(
        "You cannot moderate your own judgement.",
        "invalid",
      );
    }

    const [updated] = await tx
      .update(rplJudgements)
      .set({
        moderatorId: session.userId,
        moderatedAt: new Date(),
        moderatorAgreed: input.agreed,
        moderatorComment: comment,
      })
      .where(eq(rplJudgements.id, input.judgementId))
      .returning();

    await tx
      .update(rplApplications)
      .set({ status: "moderated", updatedAt: new Date() })
      .where(eq(rplApplications.id, found.applicationId));

    return updated;
  });

  // The exemption only exists where the assessor found competence and the
  // moderator agreed. Both, or nothing.
  if (input.agreed && judgement.competent) {
    const [application] = await withTenant(session.organisationId, (tx) =>
      tx
        .select({ learnerId: rplApplications.learnerId })
        .from(rplApplications)
        .where(eq(rplApplications.id, judgement.applicationId)),
    );

    await grantExemption(session, {
      learnerId: application.learnerId,
      curriculumModuleId: judgement.curriculumModuleId,
      source: "rpl",
      rplJudgementId: judgement.id,
      grantedOn: input.grantedOn,
    });
  }

  return judgement;
}

// ---------------------------------------------------------------------------
// Credit transfer
// ---------------------------------------------------------------------------

const transferInput = z.object({
  learnerId: z.string().uuid(),
  curriculumModuleId: z.string().uuid(),
  sourceQualification: z.string().trim().min(3).max(300),
  sourceProvider: z.string().trim().max(300).optional(),
  sourceSaqaId: z.string().trim().max(50).optional(),
  sourceCredits: z.coerce.number().int().min(0).max(1000).optional(),
  awardedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  mapping: z
    .string()
    .trim()
    .min(
      30,
      "Say how the outcomes of what they hold cover this module's. That paragraph is the whole of the decision, and a transfer without it is a claim nobody can check.",
    ),
  approvedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Records a credit transfer and grants the exemption in one act.
 *
 * Unlike RPL there is no separate moderation step, because the learning was
 * already assessed and certificated by somebody else and what is being judged
 * is a mapping rather than a competence. The mapping is required in writing,
 * and the limit is checked exactly as it is for RPL.
 */
export async function recordCreditTransfer(
  session: AuthenticatedSession,
  input: z.input<typeof transferInput>,
) {
  assertSessionCan(session, "recognition:manage");
  const parsed = transferInput.parse(input);

  const transfer = await withTenant(session.organisationId, async (tx) => {
    // Checked before the insert rather than left to the unique index. The
    // index would fire first and raise a database error, and "duplicate key
    // value violates constraint" is not something a coordinator can act on.
    const [already] = await tx
      .select({ title: curriculumModules.title })
      .from(moduleExemptions)
      .innerJoin(
        curriculumModules,
        eq(curriculumModules.id, moduleExemptions.curriculumModuleId),
      )
      .where(
        and(
          eq(moduleExemptions.learnerId, parsed.learnerId),
          eq(moduleExemptions.curriculumModuleId, parsed.curriculumModuleId),
        ),
      );

    if (already) {
      throw new RecognitionError(
        `${already.title} is already exempted for this learner.`,
        "already_exempt",
      );
    }

    const [created] = await tx
      .insert(creditTransfers)
      .values({
        organisationId: session.organisationId,
        learnerId: parsed.learnerId,
        curriculumModuleId: parsed.curriculumModuleId,
        sourceQualification: parsed.sourceQualification,
        sourceProvider: parsed.sourceProvider || null,
        sourceSaqaId: parsed.sourceSaqaId || null,
        sourceCredits: parsed.sourceCredits ?? null,
        awardedOn: parsed.awardedOn ?? null,
        mapping: parsed.mapping,
        approvedById: session.userId,
        approvedOn: parsed.approvedOn,
      })
      .returning();

    return created;
  });

  // Outside the insert, so a refusal on the limit leaves no orphan transfer
  // claiming an exemption that was never granted.
  try {
    await grantExemption(session, {
      learnerId: parsed.learnerId,
      curriculumModuleId: parsed.curriculumModuleId,
      source: "cat",
      creditTransferId: transfer.id,
      grantedOn: parsed.approvedOn,
    });
  } catch (error) {
    await withTenant(session.organisationId, (tx) =>
      tx.delete(creditTransfers).where(eq(creditTransfers.id, transfer.id)),
    );
    throw error;
  }

  return transfer;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * A learner's exemptions, with what granted each.
 *
 * The answer to item 8.3. An RPL candidate should not read as somebody who
 * skipped work, so wherever a module is met the platform can say it was
 * recognised rather than assessed, and on what basis.
 */
export async function learnerExemptions(
  session: AuthenticatedSession,
  learnerId: string,
) {
  if (learnerId !== session.userId) {
    assertSessionCan(session, "enrolment:read_all");
  }

  return withTenant(session.organisationId, async (tx) =>
    tx
      .select({
        id: moduleExemptions.id,
        curriculumModuleId: moduleExemptions.curriculumModuleId,
        moduleCode: curriculumModules.code,
        moduleTitle: curriculumModules.title,
        source: moduleExemptions.source,
        grantedOn: moduleExemptions.grantedOn,
        sourceQualification: creditTransfers.sourceQualification,
        mapping: creditTransfers.mapping,
        rationale: rplJudgements.rationale,
      })
      .from(moduleExemptions)
      .innerJoin(
        curriculumModules,
        eq(curriculumModules.id, moduleExemptions.curriculumModuleId),
      )
      .leftJoin(
        creditTransfers,
        eq(creditTransfers.id, moduleExemptions.creditTransferId),
      )
      .leftJoin(
        rplJudgements,
        eq(rplJudgements.id, moduleExemptions.rplJudgementId),
      )
      .where(eq(moduleExemptions.learnerId, learnerId))
      .orderBy(curriculumModules.code),
  );
}

/** The RPL applications a learner has, with their judgements. */
export async function learnerRplApplications(
  session: AuthenticatedSession,
  learnerId: string,
) {
  assertSessionCan(session, "recognition:manage");

  return withTenant(session.organisationId, async (tx) => {
    const applications = await tx
      .select({
        id: rplApplications.id,
        qualificationId: rplApplications.qualificationId,
        qualificationTitle: qualifications.title,
        appliedOn: rplApplications.appliedOn,
        advisedOn: rplApplications.advisedOn,
        adviceGiven: rplApplications.adviceGiven,
        status: rplApplications.status,
        outcome: rplApplications.outcome,
      })
      .from(rplApplications)
      .innerJoin(
        qualifications,
        eq(qualifications.id, rplApplications.qualificationId),
      )
      .where(eq(rplApplications.learnerId, learnerId))
      .orderBy(desc(rplApplications.appliedOn));

    if (applications.length === 0) return [];

    const judgements = await tx
      .select({
        id: rplJudgements.id,
        applicationId: rplJudgements.applicationId,
        moduleCode: curriculumModules.code,
        moduleTitle: curriculumModules.title,
        competent: rplJudgements.competent,
        rationale: rplJudgements.rationale,
        judgedOn: rplJudgements.judgedOn,
        moderatedAt: rplJudgements.moderatedAt,
        moderatorAgreed: rplJudgements.moderatorAgreed,
      })
      .from(rplJudgements)
      .innerJoin(
        curriculumModules,
        eq(curriculumModules.id, rplJudgements.curriculumModuleId),
      )
      .where(
        inArray(
          rplJudgements.applicationId,
          applications.map((row) => row.id),
        ),
      );

    return applications.map((row) => ({
      ...row,
      judgements: judgements.filter((j) => j.applicationId === row.id),
    }));
  });
}

/** RPL judgements waiting for a moderator. */
export async function rplModerationQueue(session: AuthenticatedSession) {
  assertSessionCan(session, "assessment:moderate");

  return withTenant(session.organisationId, async (tx) =>
    tx
      .select({
        id: rplJudgements.id,
        applicationId: rplJudgements.applicationId,
        learnerFirstName: users.firstName,
        learnerLastName: users.lastName,
        moduleCode: curriculumModules.code,
        moduleTitle: curriculumModules.title,
        competent: rplJudgements.competent,
        rationale: rplJudgements.rationale,
        judgedOn: rplJudgements.judgedOn,
      })
      .from(rplJudgements)
      .innerJoin(
        rplApplications,
        eq(rplApplications.id, rplJudgements.applicationId),
      )
      .innerJoin(users, eq(users.id, rplApplications.learnerId))
      .innerJoin(
        curriculumModules,
        eq(curriculumModules.id, rplJudgements.curriculumModuleId),
      )
      .where(isNull(rplJudgements.moderatedAt))
      .orderBy(rplJudgements.judgedOn),
  );
}
