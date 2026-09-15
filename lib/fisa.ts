import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  exitLevelOutcomes,
  fisaAppointments,
  fisaChecklistResponses,
  fisaInstruments,
  fisaOutcomeCoverage,
  qualifications,
} from "@/db/schema";
import {
  isKnownItem,
  readyToSignOff,
  unanswered,
  type ChecklistAnswer,
} from "./fisa-checklist";
import { recordAudit } from "./audit";
import { raise, usersWithRole } from "./notifications";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { canAny, PermissionDeniedError } from "./rbac";

/**
 * FISA: the final integrated summative assessment a provider sets itself.
 *
 * Task 3's remainder, and the last large piece of the assessment chain.
 *
 * **Why it is not EISA.** An EISA is set and administered by the Assessment
 * Quality Partner; the provider registers learners for a sitting and has no
 * hand in the paper. A FISA, for a skills programme, is written by the
 * provider's own examiner and moderated by the provider's own moderator. The
 * provider owns the whole chain - which is precisely why the chain has to be
 * evidenced at every link, because there is no external body whose involvement
 * does the evidencing for them.
 *
 * Four rules come out of the templates in `Design/Templates/` and are enforced
 * here rather than left to a coordinator to remember.
 *
 * **Nobody touches the paper without a signed confidentiality agreement.** Both
 * templates are confidentiality agreements before they are anything else. So
 * the agreement is not an attachment to an appointment - it is the appointment,
 * and an unsigned one confers nothing.
 *
 * **The examiner cannot be the moderator.** The whole worth of a pre-moderation
 * is that a second person looked. The same rule, for the same reason, as the
 * trigger that stops a learner being their own workplace coach.
 *
 * **Moderation happens before anybody sits it.** "Pre-moderator" is not a job
 * title, it is a sequence. Every other moderation in this platform samples
 * learner work afterwards; this one approves the instrument beforehand, and a
 * candidate may not sit a paper that has not been signed off as fit for
 * purpose.
 *
 * **A paper that has been sat cannot be edited.** A second version supersedes
 * rather than replaces, because the candidates who sat version 1 sat version 1.
 */

export class FisaError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "not_found"
      | "invalid"
      | "not_permitted"
      | "not_appointed"
      | "unsigned"
      | "same_person"
      | "wrong_state",
  ) {
    super(message);
    this.name = "FisaError";
  }
}

/**
 * Who may read a FISA at all.
 *
 * Not `course:read`, which every learner holds. A FISA's moderation record says
 * which questions assess which outcome and how heavily each is weighted - so a
 * learner reading it before sitting the paper would learn exactly what the
 * confidentiality agreements exist to keep from them. Caught by a test that
 * expected a learner to be refused and found they were not.
 *
 * The three roles below are the ones with a reason to see an unsat exam paper:
 * whoever writes them, whoever moderates them, and whoever administers them.
 */
function assertMayRead(session: AuthenticatedSession) {
  if (
    !canAny(session, ["assessment:author", "assessment:moderate", "assessment:assess"])
  ) {
    // Named as the permission a reader is most likely to be missing.
    throw new PermissionDeniedError("assessment:author");
  }
}

export const instrumentInput = z.object({
  qualificationId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  durationMinutes: z.number().int().positive().max(1440).optional(),
  totalMarks: z.number().int().positive().max(1000).optional(),
  passMarkPercent: z.number().int().min(1).max(100).optional(),
  hasPracticalComponent: z.boolean().optional(),
  practicalNote: z.string().trim().max(500).optional(),
});

export type InstrumentInput = z.infer<typeof instrumentInput>;

/**
 * Opens a new FISA for a skills programme.
 *
 * Refused for a full or part qualification, and the refusal says why rather
 * than only that it cannot: those are externally assessed, and a provider
 * setting its own final assessment for one would be assessing against a
 * standard it does not own.
 */
export async function createInstrument(
  session: AuthenticatedSession,
  input: InstrumentInput,
) {
  assertSessionCan(session, "assessment:author");

  const parsed = instrumentInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [programme] = await tx
      .select({ kind: qualifications.kind, title: qualifications.title })
      .from(qualifications)
      .where(eq(qualifications.id, parsed.qualificationId));

    if (!programme) {
      throw new FisaError("No such programme.", "not_found");
    }

    if (programme.kind !== "skills_programme") {
      throw new FisaError(
        "A FISA is set by the provider for its own skills programme. A full or part qualification is assessed externally by the Assessment Quality Partner, so the provider does not set that paper.",
        "invalid",
      );
    }

    const [instrument] = await tx
      .insert(fisaInstruments)
      .values({
        organisationId: session.organisationId,
        qualificationId: parsed.qualificationId,
        title: parsed.title,
        durationMinutes: parsed.durationMinutes ?? null,
        totalMarks: parsed.totalMarks ?? null,
        passMarkPercent: parsed.passMarkPercent ?? null,
        hasPracticalComponent: parsed.hasPracticalComponent ?? false,
        practicalNote: parsed.practicalNote || null,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "fisa.instrument_created",
      entityType: "fisa_instrument",
      entityId: instrument.id,
      after: { title: instrument.title, programme: programme.title },
    });

    return instrument;
  });
}

export const appointmentInput = z.object({
  instrumentId: z.string().uuid(),
  role: z.enum(["examiner", "moderator"]),
  userId: z.string().uuid().nullable().optional(),
  fullName: z.string().trim().min(1).max(200),
  idNumber: z.string().trim().max(50).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  mobile: z.string().trim().max(40).optional(),
});

export type AppointmentInput = z.infer<typeof appointmentInput>;

/**
 * Appoints an examiner or a moderator.
 *
 * Refuses to make one person both. Checked against the account where they have
 * one and against the identity number where they do not, because an external
 * examiner with no account is exactly the case where the same name could
 * quietly appear twice.
 */
export async function appoint(
  session: AuthenticatedSession,
  input: AppointmentInput,
) {
  assertSessionCan(session, "assessment:author");

  const parsed = appointmentInput.parse(input);
  const other = parsed.role === "examiner" ? "moderator" : "examiner";

  return withTenant(session.organisationId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(fisaAppointments)
      .where(
        and(
          eq(fisaAppointments.instrumentId, parsed.instrumentId),
          eq(fisaAppointments.role, other),
        ),
      );

    if (existing) {
      const sameAccount =
        parsed.userId && existing.userId && parsed.userId === existing.userId;
      const sameIdNumber =
        parsed.idNumber &&
        existing.idNumber &&
        parsed.idNumber.trim() === existing.idNumber.trim();

      if (sameAccount || sameIdNumber) {
        throw new FisaError(
          `That is the same person as the ${other}. A pre-moderation is worth having because a second person looked at it.`,
          "same_person",
        );
      }
    }

    const fields = {
      organisationId: session.organisationId,
      instrumentId: parsed.instrumentId,
      role: parsed.role,
      userId: parsed.userId ?? null,
      fullName: parsed.fullName,
      idNumber: parsed.idNumber || null,
      email: parsed.email || null,
      mobile: parsed.mobile || null,
    };

    const [appointment] = await tx
      .insert(fisaAppointments)
      .values(fields)
      // Replacing an appointment clears the signature with it: a new person has
      // not signed the old person's agreement.
      .onConflictDoUpdate({
        target: [fisaAppointments.instrumentId, fisaAppointments.role],
        set: { ...fields, confidentialitySignedAt: null },
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "fisa.appointed",
      entityType: "fisa_appointment",
      entityId: appointment.id,
      after: { role: parsed.role, name: parsed.fullName },
    });

    return appointment;
  });
}

/**
 * Records that somebody signed their confidentiality agreement.
 *
 * The moment an appointment becomes real. Until this is set, `assertMayWork`
 * below refuses everything.
 */
export async function signConfidentiality(
  session: AuthenticatedSession,
  appointmentId: string,
) {
  return withTenant(session.organisationId, async (tx) => {
    const [appointment] = await tx
      .select()
      .from(fisaAppointments)
      .where(eq(fisaAppointments.id, appointmentId));

    if (!appointment) throw new FisaError("No such appointment.", "not_found");

    /**
     * Signed by the person themselves where they hold an account. A
     * confidentiality undertaking somebody else ticked on your behalf is not an
     * undertaking. Where there is no account - an external examiner - a
     * coordinator records the signed paper, which is the only thing they can do.
     */
    if (appointment.userId && appointment.userId !== session.userId) {
      assertSessionCan(session, "assessment:author");
    }

    const [signed] = await tx
      .update(fisaAppointments)
      .set({ confidentialitySignedAt: new Date() })
      .where(eq(fisaAppointments.id, appointmentId))
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "fisa.confidentiality_signed",
      entityType: "fisa_appointment",
      entityId: appointmentId,
      after: { role: appointment.role, name: appointment.fullName },
    });

    return signed;
  });
}

/**
 * Refuses anybody who is not appointed to this instrument in this role, or who
 * is appointed but has not signed.
 *
 * The single gate every write goes through, so the rule cannot be true in one
 * place and forgotten in another.
 */
async function assertMayWork(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  instrumentId: string,
  role: "examiner" | "moderator",
  userId: string,
) {
  const [appointment] = await tx
    .select()
    .from(fisaAppointments)
    .where(
      and(
        eq(fisaAppointments.instrumentId, instrumentId),
        eq(fisaAppointments.role, role),
      ),
    );

  if (!appointment || appointment.userId !== userId) {
    throw new FisaError(
      `Only the appointed ${role} may fill in the ${role}'s report.`,
      "not_appointed",
    );
  }

  if (!appointment.confidentialitySignedAt) {
    throw new FisaError(
      "The confidentiality agreement has not been signed yet. Nobody may see or judge the contents of a FISA before signing it.",
      "unsigned",
    );
  }

  return appointment;
}

/** One answer on one report. */
export async function answerItem(
  session: AuthenticatedSession,
  input: {
    instrumentId: string;
    role: "examiner" | "moderator";
    itemCode: string;
    answer: ChecklistAnswer;
    recommendation?: string;
  },
) {
  if (!isKnownItem(input.role, input.itemCode)) {
    throw new FisaError(
      `${input.itemCode} is not an item on the ${input.role}'s report.`,
      "invalid",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    await assertMayWork(tx, input.instrumentId, input.role, session.userId);

    const [instrument] = await tx
      .select({ status: fisaInstruments.status })
      .from(fisaInstruments)
      .where(eq(fisaInstruments.id, input.instrumentId));

    if (instrument?.status === "approved" || instrument?.status === "retired") {
      throw new FisaError(
        "This FISA has been signed off. Open a new version rather than changing a paper that may already have been sat.",
        "wrong_state",
      );
    }

    const fields = {
      organisationId: session.organisationId,
      instrumentId: input.instrumentId,
      role: input.role,
      itemCode: input.itemCode,
      answer: input.answer,
      recommendation: input.recommendation?.trim() || null,
      updatedAt: new Date(),
    };

    const [saved] = await tx
      .insert(fisaChecklistResponses)
      .values(fields)
      .onConflictDoUpdate({
        target: [
          fisaChecklistResponses.instrumentId,
          fisaChecklistResponses.role,
          fisaChecklistResponses.itemCode,
        ],
        set: fields,
      })
      .returning();

    return saved;
  });
}

/** One exit level outcome, and where the paper assesses it. */
export async function recordCoverage(
  session: AuthenticatedSession,
  input: {
    instrumentId: string;
    role: "examiner" | "moderator";
    exitLevelOutcomeId: string;
    requiredStandard?: string;
    competenceLevel?: string;
    questionReference?: string;
    comment?: string;
    standardAchieved?: boolean;
  },
) {
  return withTenant(session.organisationId, async (tx) => {
    await assertMayWork(tx, input.instrumentId, input.role, session.userId);

    const fields = {
      organisationId: session.organisationId,
      instrumentId: input.instrumentId,
      role: input.role,
      exitLevelOutcomeId: input.exitLevelOutcomeId,
      requiredStandard: input.requiredStandard?.trim() || null,
      competenceLevel: input.competenceLevel?.trim() || null,
      questionReference: input.questionReference?.trim() || null,
      comment: input.comment?.trim() || null,
      standardAchieved: input.standardAchieved ?? null,
      updatedAt: new Date(),
    };

    const [saved] = await tx
      .insert(fisaOutcomeCoverage)
      .values(fields)
      .onConflictDoUpdate({
        target: [
          fisaOutcomeCoverage.instrumentId,
          fisaOutcomeCoverage.role,
          fisaOutcomeCoverage.exitLevelOutcomeId,
        ],
        set: fields,
      })
      .returning();

    return saved;
  });
}

/**
 * The examiner hands the paper to the moderator.
 *
 * Refused while the examiner's own report is short, because handing over an
 * incomplete report wastes the moderator's time and is the commonest way this
 * goes slowly.
 */
export async function sendToModeration(
  session: AuthenticatedSession,
  instrumentId: string,
) {
  return withTenant(session.organisationId, async (tx) => {
    await assertMayWork(tx, instrumentId, "examiner", session.userId);

    const answers = await answersFor(tx, instrumentId, "examiner");
    const missing = unanswered("examiner", answers);

    if (missing.length > 0) {
      throw new FisaError(
        `Your own report still has ${missing.length} unanswered ${missing.length === 1 ? "item" : "items"}: ${missing.map((m) => m.code).join(", ")}.`,
        "invalid",
      );
    }

    const [moderator] = await tx
      .select()
      .from(fisaAppointments)
      .where(
        and(
          eq(fisaAppointments.instrumentId, instrumentId),
          eq(fisaAppointments.role, "moderator"),
        ),
      );

    if (!moderator) {
      throw new FisaError(
        "No moderator has been appointed yet, so there is nobody to send it to.",
        "invalid",
      );
    }

    const [updated] = await tx
      .update(fisaInstruments)
      .set({ status: "in_moderation", updatedAt: new Date() })
      .where(eq(fisaInstruments.id, instrumentId))
      .returning();

    // The moderator is the next person, so the moderator is told.
    if (moderator.userId) {
      await raise(tx, {
        organisationId: session.organisationId,
        userId: moderator.userId,
        kind: "moderation.waiting",
        subject: "A FISA is waiting for pre-moderation",
        body: `${updated.title} is ready for you to moderate. No candidate can sit it until you sign it off as fit for purpose.`,
        linkPath: `/fisa/${instrumentId}`,
        entityType: "fisa_instrument",
        entityId: instrumentId,
        dedupeKey: `fisa.moderation:${instrumentId}`,
        channels: ["in_app", "email"],
      });
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "fisa.sent_to_moderation",
      entityType: "fisa_instrument",
      entityId: instrumentId,
    });

    return updated;
  });
}

/**
 * The moderator signs the paper off as fit for purpose.
 *
 * The gate. Until this returns, no candidate may sit this FISA, and
 * `mayBeSat` below is the thing everything else asks.
 */
export async function signOff(
  session: AuthenticatedSession,
  instrumentId: string,
  input: { qualityRating: string; qualityMotivation?: string; comments?: string },
) {
  return withTenant(session.organisationId, async (tx) => {
    await assertMayWork(tx, instrumentId, "moderator", session.userId);

    const answers = await answersFor(tx, instrumentId, "moderator");
    const verdict = readyToSignOff(answers);

    if (!verdict.ready) {
      throw new FisaError(verdict.why ?? "Not ready to sign off.", "invalid");
    }

    const [updated] = await tx
      .update(fisaInstruments)
      .set({
        status: "approved",
        approvedAt: new Date(),
        approvedById: session.userId,
        qualityRating: input.qualityRating,
        qualityMotivation: input.qualityMotivation?.trim() || null,
        moderatorComments: input.comments?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(fisaInstruments.id, instrumentId))
      .returning();

    // Everybody who runs assessments needs to know a paper is now usable.
    for (const staffId of await usersWithRole(tx, "assessor")) {
      await raise(tx, {
        organisationId: session.organisationId,
        userId: staffId,
        kind: "assessment.decided",
        subject: "A FISA has been signed off as fit for purpose",
        body: `${updated.title} has been pre-moderated and may now be sat.`,
        linkPath: `/fisa/${instrumentId}`,
        entityType: "fisa_instrument",
        entityId: instrumentId,
        dedupeKey: `fisa.approved:${instrumentId}:${staffId}`,
      });
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "fisa.signed_off",
      entityType: "fisa_instrument",
      entityId: instrumentId,
      after: { qualityRating: input.qualityRating },
    });

    return updated;
  });
}

/**
 * Whether a candidate may sit this paper.
 *
 * One function, asked by everything that would administer a FISA, so the rule
 * lives in one place. The reason is returned rather than a bare false, because
 * "not yet moderated" and "withdrawn" call for different actions.
 */
export async function mayBeSat(
  session: AuthenticatedSession,
  instrumentId: string,
): Promise<{ allowed: true } | { allowed: false; why: string }> {
  return withTenant(session.organisationId, async (tx) => {
    const [instrument] = await tx
      .select({
        status: fisaInstruments.status,
        approvedAt: fisaInstruments.approvedAt,
      })
      .from(fisaInstruments)
      .where(eq(fisaInstruments.id, instrumentId));

    if (!instrument) return { allowed: false as const, why: "No such FISA." };

    if (instrument.status === "retired") {
      return {
        allowed: false as const,
        why: "This FISA has been withdrawn. A later version may be available.",
      };
    }

    if (instrument.status !== "approved" || !instrument.approvedAt) {
      return {
        allowed: false as const,
        why: "This FISA has not been signed off by a moderator yet. A paper that has not been pre-moderated cannot be sat - that is what the moderation is for.",
      };
    }

    return { allowed: true as const };
  });
}

async function answersFor(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  instrumentId: string,
  role: "examiner" | "moderator",
): Promise<Record<string, ChecklistAnswer | undefined>> {
  const rows = await tx
    .select({
      itemCode: fisaChecklistResponses.itemCode,
      answer: fisaChecklistResponses.answer,
    })
    .from(fisaChecklistResponses)
    .where(
      and(
        eq(fisaChecklistResponses.instrumentId, instrumentId),
        eq(fisaChecklistResponses.role, role),
      ),
    );

  return Object.fromEntries(
    rows.map((row) => [row.itemCode, row.answer as ChecklistAnswer]),
  );
}

/** Everything about one FISA, for the screen. */
export async function getInstrument(
  session: AuthenticatedSession,
  instrumentId: string,
) {
  assertMayRead(session);

  return withTenant(session.organisationId, async (tx) => {
    const [instrument] = await tx
      .select({
        id: fisaInstruments.id,
        title: fisaInstruments.title,
        version: fisaInstruments.version,
        status: fisaInstruments.status,
        durationMinutes: fisaInstruments.durationMinutes,
        totalMarks: fisaInstruments.totalMarks,
        passMarkPercent: fisaInstruments.passMarkPercent,
        hasPracticalComponent: fisaInstruments.hasPracticalComponent,
        practicalNote: fisaInstruments.practicalNote,
        qualityRating: fisaInstruments.qualityRating,
        qualityMotivation: fisaInstruments.qualityMotivation,
        moderatorComments: fisaInstruments.moderatorComments,
        approvedAt: fisaInstruments.approvedAt,
        qualificationId: fisaInstruments.qualificationId,
        programme: qualifications.title,
        saqaId: qualifications.saqaId,
        nqfLevel: qualifications.nqfLevel,
        credits: qualifications.totalCredits,
      })
      .from(fisaInstruments)
      .innerJoin(
        qualifications,
        eq(qualifications.id, fisaInstruments.qualificationId),
      )
      .where(eq(fisaInstruments.id, instrumentId));

    if (!instrument) throw new FisaError("No such FISA.", "not_found");

    const appointments = await tx
      .select()
      .from(fisaAppointments)
      .where(eq(fisaAppointments.instrumentId, instrumentId));

    const responses = await tx
      .select()
      .from(fisaChecklistResponses)
      .where(eq(fisaChecklistResponses.instrumentId, instrumentId));

    const outcomes = await tx
      .select({
        id: exitLevelOutcomes.id,
        number: exitLevelOutcomes.number,
        description: exitLevelOutcomes.description,
      })
      .from(exitLevelOutcomes)
      .where(eq(exitLevelOutcomes.qualificationId, instrument.qualificationId))
      .orderBy(asc(exitLevelOutcomes.sortOrder));

    const coverage = await tx
      .select()
      .from(fisaOutcomeCoverage)
      .where(eq(fisaOutcomeCoverage.instrumentId, instrumentId));

    const examinerAnswers = Object.fromEntries(
      responses
        .filter((r) => r.role === "examiner")
        .map((r) => [r.itemCode, r.answer as ChecklistAnswer]),
    );
    const moderatorAnswers = Object.fromEntries(
      responses
        .filter((r) => r.role === "moderator")
        .map((r) => [r.itemCode, r.answer as ChecklistAnswer]),
    );

    return {
      instrument,
      appointments,
      responses,
      outcomes,
      coverage,
      outstanding: {
        examiner: unanswered("examiner", examinerAnswers),
        moderator: unanswered("moderator", moderatorAnswers),
      },
      signOff: readyToSignOff(moderatorAnswers),
    };
  });
}

/** Every FISA this provider has, newest first. */
export async function listInstruments(session: AuthenticatedSession) {
  assertMayRead(session);

  return withTenant(session.organisationId, async (tx) =>
    tx
      .select({
        id: fisaInstruments.id,
        title: fisaInstruments.title,
        version: fisaInstruments.version,
        status: fisaInstruments.status,
        approvedAt: fisaInstruments.approvedAt,
        programme: qualifications.title,
        saqaId: qualifications.saqaId,
      })
      .from(fisaInstruments)
      .innerJoin(
        qualifications,
        eq(qualifications.id, fisaInstruments.qualificationId),
      )
      .orderBy(asc(fisaInstruments.title)),
  );
}

/**
 * Opens the next version of a paper that has been signed off.
 *
 * The approved one is left exactly as it is, because candidates may have sat
 * it. Appointments and answers are not carried across: a new paper needs its
 * own moderation, and copying last version's "yes" answers forward would be
 * copying forward a judgement nobody made about this paper.
 */
export async function newVersion(
  session: AuthenticatedSession,
  instrumentId: string,
) {
  assertSessionCan(session, "assessment:author");

  return withTenant(session.organisationId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(fisaInstruments)
      .where(eq(fisaInstruments.id, instrumentId));

    if (!existing) throw new FisaError("No such FISA.", "not_found");

    if (existing.status !== "approved") {
      throw new FisaError(
        "Only a signed-off FISA needs a new version; this one can still be edited.",
        "wrong_state",
      );
    }

    const [draft] = await tx
      .insert(fisaInstruments)
      .values({
        organisationId: session.organisationId,
        qualificationId: existing.qualificationId,
        title: existing.title,
        version: existing.version + 1,
        supersedesId: existing.id,
        durationMinutes: existing.durationMinutes,
        totalMarks: existing.totalMarks,
        passMarkPercent: existing.passMarkPercent,
        hasPracticalComponent: existing.hasPracticalComponent,
        practicalNote: existing.practicalNote,
        status: "draft",
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "fisa.version_created",
      entityType: "fisa_instrument",
      entityId: draft.id,
      after: { version: draft.version, supersedes: instrumentId },
    });

    return draft;
  });
}

/**
 * Who is named on the confidentiality agreements, for the document itself.
 *
 * Returns what the two templates ask for and nothing else, so the agreement can
 * be produced without the caller reaching into the appointment table and
 * picking fields by hand.
 */
export async function confidentialityDetails(
  session: AuthenticatedSession,
  instrumentId: string,
  role: "examiner" | "moderator",
) {
  assertMayRead(session);

  return withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({
        fullName: fisaAppointments.fullName,
        idNumber: fisaAppointments.idNumber,
        email: fisaAppointments.email,
        mobile: fisaAppointments.mobile,
        signedAt: fisaAppointments.confidentialitySignedAt,
        programme: qualifications.title,
        saqaId: qualifications.saqaId,
        nqfLevel: qualifications.nqfLevel,
        credits: qualifications.totalCredits,
      })
      .from(fisaAppointments)
      .innerJoin(
        fisaInstruments,
        eq(fisaInstruments.id, fisaAppointments.instrumentId),
      )
      .innerJoin(
        qualifications,
        eq(qualifications.id, fisaInstruments.qualificationId),
      )
      .where(
        and(
          eq(fisaAppointments.instrumentId, instrumentId),
          eq(fisaAppointments.role, role),
        ),
      );

    if (!row) throw new FisaError(`No ${role} has been appointed.`, "not_found");

    return row;
  });
}

/**
 * How many instruments the QCTO expects for a skills programme.
 *
 * Curiosa's enrolment procedure: "Submit two FISA instruments and related
 * documentation to the QCTO for approval." Two, because a candidate who has to
 * be reassessed cannot sit the same paper again - so a programme with one
 * approved instrument has no second sitting to offer.
 */
export const INSTRUMENTS_EXPECTED = 2;

export type QctoReadiness = {
  signedOff: number;
  submitted: number;
  approved: number;
  expected: number;
  /** Said plainly, because it is the thing a coordinator has to act on. */
  outstanding: string[];
};

/**
 * Where a programme stands against the QCTO's expectation of two instruments.
 *
 * Reported rather than enforced. Whether a candidate may sit a paper the QCTO
 * has not returned is a regulatory question the platform should not invent an
 * answer to - so this says where things stand and leaves the judgement to
 * somebody who knows.
 */
export async function qctoReadiness(
  session: AuthenticatedSession,
  qualificationId: string,
): Promise<QctoReadiness> {
  assertMayRead(session);

  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({
        status: fisaInstruments.status,
        approvedAt: fisaInstruments.approvedAt,
        qctoSubmittedAt: fisaInstruments.qctoSubmittedAt,
        qctoApprovedAt: fisaInstruments.qctoApprovedAt,
      })
      .from(fisaInstruments)
      .where(eq(fisaInstruments.qualificationId, qualificationId));

    const live = rows.filter((row) => row.status !== "retired");
    const signedOff = live.filter((row) => row.approvedAt).length;
    const submitted = live.filter((row) => row.qctoSubmittedAt).length;
    const approved = live.filter((row) => row.qctoApprovedAt).length;

    const outstanding: string[] = [];

    if (signedOff < INSTRUMENTS_EXPECTED) {
      const short = INSTRUMENTS_EXPECTED - signedOff;
      outstanding.push(
        `${short} more ${short === 1 ? "instrument needs" : "instruments need"} to be written and pre-moderated. The QCTO expects ${INSTRUMENTS_EXPECTED}, so that a candidate being reassessed is not sat the same paper twice.`,
      );
    }

    if (signedOff > submitted) {
      const waiting = signedOff - submitted;
      outstanding.push(
        `${waiting} pre-moderated ${waiting === 1 ? "instrument has" : "instruments have"} not been sent to the QCTO yet.`,
      );
    }

    if (submitted > approved) {
      const waiting = submitted - approved;
      outstanding.push(
        `${waiting} ${waiting === 1 ? "instrument is" : "instruments are"} with the QCTO and have not come back approved.`,
      );
    }

    return {
      signedOff,
      submitted,
      approved,
      expected: INSTRUMENTS_EXPECTED,
      outstanding,
    };
  });
}

/** Records that a signed-off instrument went to the QCTO. */
export async function recordQctoSubmission(
  session: AuthenticatedSession,
  instrumentId: string,
) {
  assertSessionCan(session, "report:statutory");

  return withTenant(session.organisationId, async (tx) => {
    const [instrument] = await tx
      .select({ approvedAt: fisaInstruments.approvedAt })
      .from(fisaInstruments)
      .where(eq(fisaInstruments.id, instrumentId));

    if (!instrument) throw new FisaError("No such FISA.", "not_found");

    if (!instrument.approvedAt) {
      throw new FisaError(
        "Pre-moderate it first. Sending the QCTO a paper your own moderator has not signed off is the wrong way round.",
        "wrong_state",
      );
    }

    const [updated] = await tx
      .update(fisaInstruments)
      .set({
        qctoSubmittedAt: new Date(),
        qctoSubmittedById: session.userId,
        updatedAt: new Date(),
      })
      .where(eq(fisaInstruments.id, instrumentId))
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "fisa.sent_to_qcto",
      entityType: "fisa_instrument",
      entityId: instrumentId,
    });

    return updated;
  });
}

/** Records what the QCTO sent back. */
export async function recordQctoApproval(
  session: AuthenticatedSession,
  instrumentId: string,
  reference: string,
) {
  assertSessionCan(session, "report:statutory");

  if (!reference.trim()) {
    throw new FisaError(
      "An approval needs the reference the QCTO issued. Without it there is nothing to show a monitor.",
      "invalid",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [updated] = await tx
      .update(fisaInstruments)
      .set({
        qctoApprovedAt: new Date(),
        qctoReference: reference.trim(),
        updatedAt: new Date(),
      })
      .where(eq(fisaInstruments.id, instrumentId))
      .returning();

    if (!updated) throw new FisaError("No such FISA.", "not_found");

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "fisa.qcto_approved",
      entityType: "fisa_instrument",
      entityId: instrumentId,
      after: { reference: reference.trim() },
    });

    return updated;
  });
}
