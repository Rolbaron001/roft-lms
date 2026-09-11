import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  offlineSubmissions,
  organisations,
  qualifications,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Offline work, for the tenants that need it.
 *
 * The ranger programme is the reason this exists: learners in the field, a
 * fortnight between connections, on Android. Heidi's answers on 10 September
 * settled the shape - Android means an installable web app rather than a native
 * one, and "not accredited yet, but cater for both" means the scope is a
 * property of the programme rather than of the build.
 *
 * Roland's constraint governs everything here: "the platform works as it is and
 * must not change. Offline is additional functionality for tenants that need
 * it - off by default, invisible to every tenant that does not turn it on."
 * So every function in this file is inert unless a tenant has asked for it, and
 * no existing path calls into it.
 *
 * Three rules are worth stating plainly, because each one is a decision that
 * could have gone the other way and would have been wrong.
 *
 * **The strict shape is the default.** A programme is treated as accredited
 * unless somebody deliberately says otherwise. The permissive setting has to be
 * switched on by a person and is recorded when it is, because a setting that
 * arrives by accident is exactly how an indefensible summative gets taken.
 *
 * **Two dates, never one.** A device says when it captured something; the
 * server knows when it heard. A phone's clock can be wrong by accident or set
 * wrong on purpose, so both are kept and both are shown. Neither ever stands in
 * for the other.
 *
 * **A conflict is held, not merged.** Last-write-wins discards somebody's work
 * without telling anyone, which assessment evidence cannot tolerate. Where
 * something changed while the learner was away, a person decides.
 */

export class OfflineError extends Error {
  constructor(
    message: string,
    readonly reason: "not_enabled" | "not_allowed" | "invalid" | "not_found",
  ) {
    super(message);
    this.name = "OfflineError";
  }
}

/** What may be captured offline, whatever the programme's own setting. */
export const ALWAYS_OFFLINE = [
  "study_material",
  "rollout_schedule",
  "formative_answer",
  "workplace_evidence",
  "workplace_entry",
] as const;

/** What is never offline, on any programme. */
export const NEVER_OFFLINE = ["marking", "moderation", "verification"] as const;

/** What depends on the programme: only the summative. */
export const CONDITIONALLY_OFFLINE = ["summative_answer"] as const;

export type OfflineKind =
  | (typeof ALWAYS_OFFLINE)[number]
  | (typeof NEVER_OFFLINE)[number]
  | (typeof CONDITIONALLY_OFFLINE)[number];

export type OfflineVerdict =
  | { allowed: true; underRelaxedRule: boolean }
  | { allowed: false; why: string };

/**
 * Whether a kind of work may be done offline on a given programme.
 *
 * Pure, so the same rule can be applied on the device before capture and on the
 * server before acceptance - and so the two cannot drift apart. A device that
 * allows a capture the server will refuse has wasted somebody's fortnight.
 */
export function offlineAllows(
  kind: OfflineKind,
  programme: { offlineSummativesAllowed: boolean },
): OfflineVerdict {
  if ((NEVER_OFFLINE as readonly string[]).includes(kind)) {
    return {
      allowed: false,
      why: "This needs a second person, so it cannot be done on a device with no signal.",
    };
  }

  if ((ALWAYS_OFFLINE as readonly string[]).includes(kind)) {
    return { allowed: true, underRelaxedRule: false };
  }

  // The summative, and only the summative.
  if (programme.offlineSummativesAllowed) {
    return { allowed: true, underRelaxedRule: true };
  }

  return {
    allowed: false,
    why: "Summative assessments are invigilated on this programme. One taken unsupervised on a phone is not defensible at a monitoring visit.",
  };
}

/** Whether this tenant has offline switched on at all. */
export async function offlineEnabledFor(
  organisationId: string,
): Promise<boolean> {
  return withTenant(organisationId, async (tx) => {
    const [row] = await tx
      .select({ offlineEnabled: organisations.offlineEnabled })
      .from(organisations)
      .where(eq(organisations.id, organisationId));
    return row?.offlineEnabled ?? false;
  });
}

export const submissionInput = z.object({
  kind: z.string().min(1).max(50),
  targetType: z.string().min(1).max(50),
  targetId: z.string().uuid(),
  qualificationId: z.string().uuid().optional(),
  payload: z.record(z.string(), z.unknown()),
  deviceKey: z.string().min(8).max(200),
  /** What the device's own clock said. Recorded, not believed. */
  capturedAt: z.string(),
});

export type SubmissionInput = z.infer<typeof submissionInput>;

/**
 * Takes work from a device.
 *
 * Idempotent on the device's own key: a phone that uploads, loses signal before
 * hearing the reply and retries must not create the work twice. The same key
 * arriving again returns what is already held rather than a second copy.
 */
export async function receiveSubmission(
  session: AuthenticatedSession,
  input: SubmissionInput,
) {
  if (!(await offlineEnabledFor(session.organisationId))) {
    throw new OfflineError(
      "Offline work is not switched on for this provider.",
      "not_enabled",
    );
  }

  const parsed = submissionInput.parse(input);
  const capturedAt = new Date(parsed.capturedAt);

  if (Number.isNaN(capturedAt.getTime())) {
    throw new OfflineError("The capture time is not a date.", "invalid");
  }

  return withTenant(session.organisationId, async (tx) => {
    // The programme's own rule, where the work belongs to one.
    let programme = { offlineSummativesAllowed: false };
    if (parsed.qualificationId) {
      const [row] = await tx
        .select({
          offlineSummativesAllowed: qualifications.offlineSummativesAllowed,
        })
        .from(qualifications)
        .where(eq(qualifications.id, parsed.qualificationId));
      if (row) programme = row;
    }

    const verdict = offlineAllows(parsed.kind as OfflineKind, programme);
    if (!verdict.allowed) {
      throw new OfflineError(verdict.why, "not_allowed");
    }

    const [saved] = await tx
      .insert(offlineSubmissions)
      .values({
        organisationId: session.organisationId,
        userId: session.userId,
        kind: parsed.kind,
        targetType: parsed.targetType,
        targetId: parsed.targetId,
        payload: parsed.payload,
        deviceKey: parsed.deviceKey,
        capturedAt,
        underRelaxedRule: verdict.underRelaxedRule,
      })
      // The idempotency guarantee. A retry finds its own row and changes
      // nothing about it - in particular it does not move `receivedAt`, which
      // would rewrite when the server first heard.
      .onConflictDoUpdate({
        target: [
          offlineSubmissions.organisationId,
          offlineSubmissions.deviceKey,
        ],
        set: { deviceKey: sql`excluded.device_key` },
      })
      .returning();

    return saved;
  });
}

/**
 * Marks a submission as needing a person.
 *
 * Called when something changed while the learner was away. The work is kept
 * exactly as it arrived; nothing is merged and nothing is overwritten.
 */
export async function holdForResolution(
  session: AuthenticatedSession,
  submissionId: string,
  why: string,
) {
  return withTenant(session.organisationId, async (tx) => {
    const [held] = await tx
      .update(offlineSubmissions)
      .set({ state: "held", heldReason: why })
      .where(eq(offlineSubmissions.id, submissionId))
      .returning();

    if (!held) throw new OfflineError("No such submission.", "not_found");
    return held;
  });
}

/** Everything waiting on a person, oldest first. */
export async function awaitingResolution(session: AuthenticatedSession) {
  assertSessionCan(session, "enrolment:read_all");

  return withTenant(session.organisationId, async (tx) =>
    tx
      .select({
        id: offlineSubmissions.id,
        kind: offlineSubmissions.kind,
        heldReason: offlineSubmissions.heldReason,
        capturedAt: offlineSubmissions.capturedAt,
        receivedAt: offlineSubmissions.receivedAt,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(offlineSubmissions)
      .innerJoin(users, eq(users.id, offlineSubmissions.userId))
      .where(eq(offlineSubmissions.state, "held"))
      .orderBy(offlineSubmissions.receivedAt),
  );
}

/**
 * Turns offline summatives on or off for a programme, and records that it was
 * done.
 *
 * A deliberate act with an audit trail, because it is the kind of decision
 * somebody will be asked to justify later.
 */
export async function setOfflineSummatives(
  session: AuthenticatedSession,
  qualificationId: string,
  allowed: boolean,
) {
  assertSessionCan(session, "qualification:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [updated] = await tx
      .update(qualifications)
      .set({
        offlineSummativesAllowed: allowed,
        offlineSummativesAllowedAt: allowed ? new Date() : null,
      })
      .where(eq(qualifications.id, qualificationId))
      .returning();

    if (!updated) throw new OfflineError("No such programme.", "not_found");

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: allowed
        ? "offline.summatives_allowed"
        : "offline.summatives_disallowed",
      entityType: "qualification",
      entityId: qualificationId,
      after: { offlineSummativesAllowed: allowed },
    });

    return updated;
  });
}

/**
 * What was captured while the looser rule was in force.
 *
 * The third thing from the 10 September notes, and the one flagged as the one
 * that would bite: accreditation arrives partway through. A programme that
 * allowed offline summatives last year does not make last year's work
 * defensible once it is accredited.
 *
 * Whether any of it needs re-assessing is Heidi's call and not the platform's.
 * What the platform owes her is the list, so that it is a decision rather than
 * a discovery at a monitoring visit.
 */
export async function capturedUnderRelaxedRule(
  session: AuthenticatedSession,
  qualificationId?: string,
) {
  assertSessionCan(session, "enrolment:read_all");

  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({
        id: offlineSubmissions.id,
        kind: offlineSubmissions.kind,
        targetType: offlineSubmissions.targetType,
        targetId: offlineSubmissions.targetId,
        capturedAt: offlineSubmissions.capturedAt,
        receivedAt: offlineSubmissions.receivedAt,
        state: offlineSubmissions.state,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(offlineSubmissions)
      .innerJoin(users, eq(users.id, offlineSubmissions.userId))
      .where(
        and(
          eq(offlineSubmissions.underRelaxedRule, true),
          qualificationId
            ? eq(offlineSubmissions.targetId, qualificationId)
            : undefined,
        ),
      )
      .orderBy(offlineSubmissions.capturedAt);

    return rows;
  });
}

/**
 * How far apart the device and the server were.
 *
 * Surfaced wherever a date matters, so a reader can judge for themselves rather
 * than being handed one number that quietly might be either. A fortnight is
 * expected on this programme; a negative gap means the device clock is ahead of
 * the server's, which is worth someone's attention.
 */
export function clockGapHours(submission: {
  capturedAt: Date;
  receivedAt: Date;
}): number {
  return Math.round(
    (submission.receivedAt.getTime() - submission.capturedAt.getTime()) / 36e5,
  );
}
