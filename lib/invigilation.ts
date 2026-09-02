import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  assessments,
  cohortMembers,
  cohortSessions,
  invigilatedSittings,
  sittingCandidates,
  sittingIncidents,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import {
  DEFAULT_TIME_ZONE,
  clockInZone,
  zoneLabel,
  zonedTimeToUtc,
} from "./timezone";

/**
 * Running a supervised sitting.
 *
 * The client intends to end its external invigilation licence in March, which
 * is the only deadline in this work set from outside the project. What that
 * licence actually provides is not a room but a record: who was admitted and
 * who was turned away, what each candidate agreed to, that their script was
 * received, and what went wrong. Most of the procedure will always be the
 * invigilator's job; this is the part a platform can hold.
 *
 * A note on the word. In papers.ts a "sitting" is one learner's timed attempt.
 * Here it is the room. Both are needed and they are not the same thing.
 */

export class InvigilationError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "invalid_state" | "too_late",
  ) {
    super(message);
    this.name = "InvigilationError";
  }
}

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

/**
 * Whether somebody may still be admitted.
 *
 * Pure, so the rule can be tested against the clock rather than inferred from
 * behaviour. The cut-off is a provider's policy - the client's is five minutes
 * past the appointed hour, for their own summatives and for the external
 * assessment alike - so it is a number on the sitting rather than a constant
 * here.
 *
 * Refuses rather than warns. A late admission is not a note in a log: it is a
 * candidate who had longer with the paper than everybody else, and the whole
 * point of a supervised sitting is that they did not.
 */
export function admissionOpen(input: {
  startsAt: Date;
  closesAfterMinutes: number;
  now: Date;
}): { open: boolean; closedAt: Date; lateBySeconds: number } {
  const closesAt = new Date(
    input.startsAt.getTime() + input.closesAfterMinutes * 60_000,
  );
  const lateBy = Math.max(
    0,
    Math.round((input.now.getTime() - closesAt.getTime()) / 1000),
  );

  return {
    open: input.now.getTime() <= closesAt.getTime(),
    closedAt: closesAt,
    lateBySeconds: lateBy,
  };
}

/**
 * When a sitting actually begins, from the session it happens at.
 *
 * Date and clock time are held apart on the session, deliberately, so that a
 * lecture at 18:30 stays at 18:30 whatever the server thinks the time zone is.
 * Putting them back together needs a zone, and the only honest one is the
 * provider's own - so it is passed in rather than guessed.
 */
export function sittingStartsAt(
  scheduledDate: string,
  startTime: string | null,
  timeZone: string,
): Date {
  return zonedTimeToUtc(scheduledDate, startTime, timeZone);
}

// ---------------------------------------------------------------------------
// Setting one up
// ---------------------------------------------------------------------------

export const sittingInput = z.object({
  sessionId: z.string().uuid(),
  assessmentId: z.string().uuid(),
  invigilatorId: z.string().uuid().optional(),
  admissionClosesAfterMinutes: z.coerce.number().int().min(0).max(120).default(5),
  arriveBeforeMinutes: z.coerce.number().int().min(0).max(240).default(10),
  cameraRequired: z.boolean().default(true),
  permittedMaterials: z.string().trim().max(2000).optional(),
  declarationText: z.string().trim().max(4000).optional(),
});

export async function createSitting(
  session: AuthenticatedSession,
  input: z.input<typeof sittingInput>,
) {
  assertSessionCan(session, "session:manage");
  const parsed = sittingInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [event] = await tx
      .select({ id: cohortSessions.id, kind: cohortSessions.kind })
      .from(cohortSessions)
      .where(eq(cohortSessions.id, parsed.sessionId));

    if (!event) throw new InvigilationError("Session not found.", "not_found");

    // A supervised sitting belongs to an occasion meant to be supervised.
    // Attaching one to an ordinary lecture would produce a register nobody
    // intended and a set of rules nobody announced.
    if (event.kind !== "summative" && event.kind !== "mock_eisa") {
      throw new InvigilationError(
        "A sitting can only be run at a summative or mock EISA session. Change the session's kind first, so the schedule says what is happening.",
        "invalid_state",
      );
    }

    const [paper] = await tx
      .select({ id: assessments.id })
      .from(assessments)
      .where(eq(assessments.id, parsed.assessmentId));
    if (!paper) throw new InvigilationError("Assessment not found.", "not_found");

    const [created] = await tx
      .insert(invigilatedSittings)
      .values({
        organisationId: session.organisationId,
        sessionId: parsed.sessionId,
        assessmentId: parsed.assessmentId,
        invigilatorId: parsed.invigilatorId ?? null,
        admissionClosesAfterMinutes: parsed.admissionClosesAfterMinutes,
        arriveBeforeMinutes: parsed.arriveBeforeMinutes,
        cameraRequired: parsed.cameraRequired ? 1 : 0,
        permittedMaterials: parsed.permittedMaterials ?? null,
        declarationText: parsed.declarationText ?? null,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "sitting.created",
      entityType: "invigilated_sitting",
      entityId: created.id,
      after: { sessionId: parsed.sessionId, assessmentId: parsed.assessmentId },
    });

    return created;
  });
}

export async function setSittingStatus(
  session: AuthenticatedSession,
  sittingId: string,
  status: "scheduled" | "open" | "in_progress" | "closed" | "cancelled",
) {
  assertSessionCan(session, "attendance:record");

  return withTenant(session.organisationId, async (tx) => {
    const [sitting] = await tx
      .select({ id: invigilatedSittings.id, status: invigilatedSittings.status })
      .from(invigilatedSittings)
      .where(eq(invigilatedSittings.id, sittingId));

    if (!sitting) throw new InvigilationError("Sitting not found.", "not_found");

    await tx
      .update(invigilatedSittings)
      .set({
        status,
        openedAt: status === "open" ? new Date() : undefined,
        closedAt: status === "closed" ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(invigilatedSittings.id, sittingId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "sitting.status_changed",
      entityType: "invigilated_sitting",
      entityId: sittingId,
      before: { status: sitting.status },
      after: { status },
    });
  });
}

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

/**
 * Admits a candidate, or refuses them.
 *
 * The cut-off is enforced here rather than left to the invigilator's watch,
 * because the consequence of getting it wrong is not administrative: a
 * candidate admitted late has had longer with the paper than everybody else,
 * and an appeal turns on whether the room was run to its own rules.
 *
 * Refusing needs a reason. "Refused" alone tells an appeal nothing, and the
 * candidate has to be told what happened.
 */
export async function admitCandidate(
  session: AuthenticatedSession,
  input: {
    sittingId: string;
    userId: string;
    outcome: "admitted" | "refused";
    reason?: string;
    /** Passed by tests so the cut-off can be checked against a fixed clock. */
    now?: Date;
    /** The provider's own offset from UTC, for reading the session's time. */
    timeZone?: string;
  },
) {
  assertSessionCan(session, "attendance:record");

  if (input.outcome === "refused" && !input.reason?.trim()) {
    throw new InvigilationError(
      "Say why they were turned away. An appeal turns on the reason, and the candidate has to be told what happened.",
      "invalid_state",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [sitting] = await tx
      .select({
        id: invigilatedSittings.id,
        status: invigilatedSittings.status,
        closesAfter: invigilatedSittings.admissionClosesAfterMinutes,
        scheduledDate: cohortSessions.scheduledDate,
        startTime: cohortSessions.startTime,
        cohortId: cohortSessions.cohortId,
      })
      .from(invigilatedSittings)
      .innerJoin(
        cohortSessions,
        eq(cohortSessions.id, invigilatedSittings.sessionId),
      )
      .where(eq(invigilatedSittings.id, input.sittingId));

    if (!sitting) throw new InvigilationError("Sitting not found.", "not_found");

    if (sitting.status === "cancelled" || sitting.status === "closed") {
      throw new InvigilationError(
        "This sitting is over, so nobody can be admitted to it.",
        "invalid_state",
      );
    }

    const member = await tx
      .select({ userId: cohortMembers.userId })
      .from(cohortMembers)
      .where(
        and(
          eq(cohortMembers.cohortId, sitting.cohortId),
          eq(cohortMembers.userId, input.userId),
          isNull(cohortMembers.leftAt),
        ),
      );

    if (member.length === 0) {
      throw new InvigilationError(
        "That person is not on this cohort, so they cannot be admitted to its sitting.",
        "invalid_state",
      );
    }

    const [already] = await tx
      .select({ droppedOffAt: sittingCandidates.droppedOffAt })
      .from(sittingCandidates)
      .where(
        and(
          eq(sittingCandidates.sittingId, input.sittingId),
          eq(sittingCandidates.userId, input.userId),
        ),
      );

    // The rule for a virtual sitting: a candidate who drops out is not
    // readmitted. Enforced rather than noted, because putting somebody back in
    // the room after ten unsupervised minutes is exactly what the rule exists
    // to prevent, and by then nobody remembers who left when.
    if (input.outcome === "admitted" && already?.droppedOffAt) {
      throw new InvigilationError(
        "That candidate dropped out of this sitting and cannot be readmitted. Record what happened as an incident instead.",
        "invalid_state",
      );
    }

    if (input.outcome === "admitted") {
      const startsAt = sittingStartsAt(
        sitting.scheduledDate,
        sitting.startTime,
        input.timeZone ?? DEFAULT_TIME_ZONE,
      );
      const door = admissionOpen({
        startsAt,
        closesAfterMinutes: sitting.closesAfter,
        now: input.now ?? new Date(),
      });

      if (!door.open) {
        // Quoted in the provider's own time. The instant is UTC internally,
        // and an invigilator told "admission closed at 03:19" while their
        // clock says 07:19 will reasonably conclude the platform is broken.
        const zone = input.timeZone ?? DEFAULT_TIME_ZONE;
        const localClose = clockInZone(door.closedAt, zone);

        throw new InvigilationError(
          `Admission closed at ${localClose} ${zoneLabel(zone, door.closedAt)}, ${Math.round(door.lateBySeconds / 60)} minutes ago. Record them as refused with the reason instead: somebody admitted late has had longer with the paper than everybody else.`,
          "too_late",
        );
      }
    }

    const now = input.now ?? new Date();

    await tx
      .insert(sittingCandidates)
      .values({
        organisationId: session.organisationId,
        sittingId: input.sittingId,
        userId: input.userId,
        outcome: input.outcome,
        admittedAt: input.outcome === "admitted" ? now : null,
        refusedReason: input.outcome === "refused" ? input.reason!.trim() : null,
        admittedById: session.userId,
      })
      .onConflictDoUpdate({
        target: [sittingCandidates.sittingId, sittingCandidates.userId],
        set: {
          outcome: input.outcome,
          admittedAt: input.outcome === "admitted" ? now : null,
          refusedReason:
            input.outcome === "refused" ? input.reason!.trim() : null,
          admittedById: session.userId,
        },
      });

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "sitting.admission",
      entityType: "invigilated_sitting",
      entityId: input.sittingId,
      after: {
        userId: input.userId,
        outcome: input.outcome,
        reason: input.reason ?? null,
      },
    });
  });
}

/**
 * Records that a candidate accepted the rules.
 *
 * On paper this is a signature on the attendance register, and the client's
 * procedure is explicit that signing is both acceptance of the rules and a
 * declaration of no intention to cheat. The wording is copied onto the
 * candidate's row at the moment of acceptance, so that changing it later
 * cannot alter what somebody is recorded as having agreed to.
 */
export async function acceptSittingDeclaration(
  session: AuthenticatedSession,
  sittingId: string,
  userId: string,
) {
  assertSessionCan(session, "attendance:record");

  return withTenant(session.organisationId, async (tx) => {
    const [sitting] = await tx
      .select({
        id: invigilatedSittings.id,
        declarationText: invigilatedSittings.declarationText,
      })
      .from(invigilatedSittings)
      .where(eq(invigilatedSittings.id, sittingId));

    if (!sitting) throw new InvigilationError("Sitting not found.", "not_found");

    if (!sitting.declarationText?.trim()) {
      throw new InvigilationError(
        "This sitting has no declaration wording, so there is nothing for a candidate to accept. Set it on the sitting first.",
        "invalid_state",
      );
    }

    const [candidate] = await tx
      .select({ id: sittingCandidates.id, outcome: sittingCandidates.outcome })
      .from(sittingCandidates)
      .where(
        and(
          eq(sittingCandidates.sittingId, sittingId),
          eq(sittingCandidates.userId, userId),
        ),
      );

    if (!candidate || candidate.outcome !== "admitted") {
      throw new InvigilationError(
        "Admit the candidate first. A declaration from somebody who was never admitted records an agreement nobody witnessed.",
        "invalid_state",
      );
    }

    await tx
      .update(sittingCandidates)
      .set({
        declarationAcceptedAt: new Date(),
        declarationText: sitting.declarationText,
      })
      .where(eq(sittingCandidates.id, candidate.id));
  });
}

/**
 * Acknowledges receipt of a candidate's script.
 *
 * The client acknowledges every answer sheet on the day. A script written and
 * then lost between the room and the assessor is the failure this exists to
 * make impossible to hide: without a receipt, the only record that it ever
 * existed is the candidate's word.
 */
export async function acknowledgeScript(
  session: AuthenticatedSession,
  sittingId: string,
  userId: string,
  reference?: string,
) {
  assertSessionCan(session, "attendance:record");

  return withTenant(session.organisationId, async (tx) => {
    const [candidate] = await tx
      .select({ id: sittingCandidates.id, outcome: sittingCandidates.outcome })
      .from(sittingCandidates)
      .where(
        and(
          eq(sittingCandidates.sittingId, sittingId),
          eq(sittingCandidates.userId, userId),
        ),
      );

    if (!candidate) {
      throw new InvigilationError("That candidate is not on this sitting.", "not_found");
    }

    if (candidate.outcome !== "admitted") {
      throw new InvigilationError(
        "That candidate was not admitted, so there is no script of theirs to receive.",
        "invalid_state",
      );
    }

    await tx
      .update(sittingCandidates)
      .set({
        scriptReceivedAt: new Date(),
        scriptReference: reference?.trim() || null,
        scriptReceivedById: session.userId,
      })
      .where(eq(sittingCandidates.id, candidate.id));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "sitting.script_received",
      entityType: "invigilated_sitting",
      entityId: sittingId,
      after: { userId, reference: reference ?? null },
    });
  });
}

/**
 * Records that the invigilator saw the candidate on camera.
 *
 * Separate from admission because they are separate acts: a candidate can be
 * in the meeting and not on camera, which is precisely what the rule exists to
 * catch. The platform cannot see the camera - the meeting runs on whatever
 * platform the provider already uses, and only that meeting knows - so what is
 * recorded is the invigilator confirming it, which is what an appeal asks for.
 */
export async function confirmCamera(
  session: AuthenticatedSession,
  sittingId: string,
  userId: string,
) {
  assertSessionCan(session, "attendance:record");

  return withTenant(session.organisationId, async (tx) => {
    const [candidate] = await tx
      .select({ id: sittingCandidates.id, outcome: sittingCandidates.outcome })
      .from(sittingCandidates)
      .where(
        and(
          eq(sittingCandidates.sittingId, sittingId),
          eq(sittingCandidates.userId, userId),
        ),
      );

    if (!candidate || candidate.outcome !== "admitted") {
      throw new InvigilationError(
        "Admit the candidate first. Confirming a camera for somebody who was never admitted records a check nobody made.",
        "invalid_state",
      );
    }

    await tx
      .update(sittingCandidates)
      .set({ cameraConfirmedAt: new Date() })
      .where(eq(sittingCandidates.id, candidate.id));
  });
}

/**
 * Records that a candidate dropped out of the sitting.
 *
 * This closes the door on them: admitCandidate refuses a readmission
 * afterwards. Worth enforcing rather than noting, because somebody who has
 * been unsupervised cannot be put back in the room on the strength of nobody
 * remembering when they left.
 */
export async function recordDropOut(
  session: AuthenticatedSession,
  sittingId: string,
  userId: string,
  reason?: string,
) {
  assertSessionCan(session, "attendance:record");

  return withTenant(session.organisationId, async (tx) => {
    const [candidate] = await tx
      .select({ id: sittingCandidates.id })
      .from(sittingCandidates)
      .where(
        and(
          eq(sittingCandidates.sittingId, sittingId),
          eq(sittingCandidates.userId, userId),
        ),
      );

    if (!candidate) {
      throw new InvigilationError(
        "That candidate is not on this sitting.",
        "not_found",
      );
    }

    await tx
      .update(sittingCandidates)
      .set({
        droppedOffAt: new Date(),
        droppedOffReason: reason?.trim() || null,
      })
      .where(eq(sittingCandidates.id, candidate.id));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "sitting.dropped_out",
      entityType: "invigilated_sitting",
      entityId: sittingId,
      after: { userId, reason: reason ?? null },
    });
  });
}

/** Reports something that happened, on the day it happened. */
export async function recordIncident(
  session: AuthenticatedSession,
  input: {
    sittingId: string;
    userId?: string | null;
    description: string;
    actionTaken?: string;
    occurredAt?: Date;
  },
) {
  assertSessionCan(session, "attendance:record");

  const description = input.description.trim();
  if (description.length < 10) {
    throw new InvigilationError(
      "Describe what happened. An incident report that says nothing is worse than none, because the record shows one was made.",
      "invalid_state",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [sitting] = await tx
      .select({ id: invigilatedSittings.id })
      .from(invigilatedSittings)
      .where(eq(invigilatedSittings.id, input.sittingId));

    if (!sitting) throw new InvigilationError("Sitting not found.", "not_found");

    const [created] = await tx
      .insert(sittingIncidents)
      .values({
        organisationId: session.organisationId,
        sittingId: input.sittingId,
        userId: input.userId ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        description,
        actionTaken: input.actionTaken?.trim() || null,
        reportedById: session.userId,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "sitting.incident",
      entityType: "invigilated_sitting",
      entityId: input.sittingId,
      after: { userId: input.userId ?? null },
    });

    return created;
  });
}

// ---------------------------------------------------------------------------
// Reading it back
// ---------------------------------------------------------------------------

export type SittingRegisterLine = {
  userId: string;
  name: string;
  outcome: "admitted" | "refused" | null;
  admittedAt: string | null;
  refusedReason: string | null;
  declarationAcceptedAt: string | null;
  cameraConfirmedAt: string | null;
  droppedOffAt: string | null;
  droppedOffReason: string | null;
  scriptReceivedAt: string | null;
  scriptReference: string | null;
};

/** The room: everybody expected, and what has been recorded for each. */
export async function sittingRegister(
  session: AuthenticatedSession,
  sittingId: string,
) {
  return withTenant(session.organisationId, async (tx) => {
    const [sitting] = await tx
      .select({
        id: invigilatedSittings.id,
        status: invigilatedSittings.status,
        closesAfter: invigilatedSittings.admissionClosesAfterMinutes,
        permittedMaterials: invigilatedSittings.permittedMaterials,
        declarationText: invigilatedSittings.declarationText,
        assessmentTitle: assessments.title,
        scheduledDate: cohortSessions.scheduledDate,
        startTime: cohortSessions.startTime,
        cohortId: cohortSessions.cohortId,
        // The same link the cohort meets on for a lecture. The platform holds
        // the record of supervision; the meeting itself stays wherever the
        // provider already runs them.
        meetingUrl: cohortSessions.meetingUrl,
        venue: cohortSessions.venue,
        deliveryMode: cohortSessions.deliveryMode,
        cameraRequired: invigilatedSittings.cameraRequired,
        arriveBeforeMinutes: invigilatedSittings.arriveBeforeMinutes,
      })
      .from(invigilatedSittings)
      .innerJoin(
        cohortSessions,
        eq(cohortSessions.id, invigilatedSittings.sessionId),
      )
      .innerJoin(assessments, eq(assessments.id, invigilatedSittings.assessmentId))
      .where(eq(invigilatedSittings.id, sittingId));

    if (!sitting) throw new InvigilationError("Sitting not found.", "not_found");

    const expected = await tx
      .select({
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(cohortMembers)
      .innerJoin(users, eq(users.id, cohortMembers.userId))
      .where(
        and(
          eq(cohortMembers.cohortId, sitting.cohortId),
          isNull(cohortMembers.leftAt),
        ),
      )
      .orderBy(asc(users.lastName), asc(users.firstName));

    const recorded = await tx
      .select()
      .from(sittingCandidates)
      .where(eq(sittingCandidates.sittingId, sittingId));

    const incidents = await tx
      .select({
        id: sittingIncidents.id,
        userId: sittingIncidents.userId,
        occurredAt: sittingIncidents.occurredAt,
        description: sittingIncidents.description,
        actionTaken: sittingIncidents.actionTaken,
      })
      .from(sittingIncidents)
      .where(eq(sittingIncidents.sittingId, sittingId))
      .orderBy(asc(sittingIncidents.occurredAt));

    return {
      sitting,
      lines: expected.map((person) => {
        const row = recorded.find((r) => r.userId === person.userId);
        return {
          userId: person.userId,
          name: `${person.firstName} ${person.lastName}`,
          outcome: row?.outcome ?? null,
          admittedAt: row?.admittedAt ? row.admittedAt.toISOString() : null,
          refusedReason: row?.refusedReason ?? null,
          declarationAcceptedAt: row?.declarationAcceptedAt
            ? row.declarationAcceptedAt.toISOString()
            : null,
          cameraConfirmedAt: row?.cameraConfirmedAt
            ? row.cameraConfirmedAt.toISOString()
            : null,
          droppedOffAt: row?.droppedOffAt ? row.droppedOffAt.toISOString() : null,
          droppedOffReason: row?.droppedOffReason ?? null,
          scriptReceivedAt: row?.scriptReceivedAt
            ? row.scriptReceivedAt.toISOString()
            : null,
          scriptReference: row?.scriptReference ?? null,
        } satisfies SittingRegisterLine;
      }),
      incidents,
    };
  });
}
