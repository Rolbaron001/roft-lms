/**
 * Observations of a learner's behaviour and progress.
 *
 * Heidi's role specifications (job sheet D52 (2), 17 November 2026): a
 * facilitator or assessor will "log observations in relation to learner
 * behaviour and progress". Dated notes, each marked behaviour, progress,
 * attendance or other, optionally against the cohort it happened in. Kept
 * apart from the disciplinary process (lib/conduct), which has stages,
 * hearings and warnings a learner acknowledges; these are the everyday record
 * a facilitator keeps.
 *
 * Written by those who teach, assess or manage enrolments, for learners within
 * their reach (lib/staff-scope.ts). Read by them and by anyone who may read
 * every record (a Quality Assurer). Not shown to the learner: staff notes, as
 * the screen says. A learner who asks may be given them as any record is.
 */
import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { cohorts, learnerObservations, users } from "@/db/schema";
import { recordAudit } from "./audit";
import { learnerInReach, reachWithin } from "./staff-scope";
import { type AuthenticatedSession } from "./session";

export const OBSERVATION_KINDS = ["behaviour", "progress", "attendance", "other"] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];

export class ObservationError extends Error {
  constructor(
    message: string,
    readonly code: "not_permitted" | "invalid",
  ) {
    super(message);
    this.name = "ObservationError";
  }
}

const WRITERS = ["attendance:record", "assessment:assess", "enrolment:manage"] as const;
const READERS = [...WRITERS, "records:read"] as const;

export const mayWriteObservations = (session: Pick<AuthenticatedSession, "permissions">) =>
  WRITERS.some((permission) => session.permissions.includes(permission));
export const mayReadObservations = (session: Pick<AuthenticatedSession, "permissions">) =>
  READERS.some((permission) => session.permissions.includes(permission));

export type Observation = {
  id: string;
  kind: ObservationKind;
  observedOn: string;
  note: string;
  cohort: string | null;
  author: string | null;
};

export async function logObservation(
  session: AuthenticatedSession,
  input: { learnerId: string; kind: string; observedOn: string; note: string; cohortId?: string | null },
): Promise<string> {
  if (!mayWriteObservations(session)) throw new ObservationError("Your role does not allow that.", "not_permitted");
  const kind = OBSERVATION_KINDS.find((one) => one === input.kind);
  if (!kind) throw new ObservationError("Choose what the observation is about.", "invalid");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.observedOn)) throw new ObservationError("Give the date it was observed.", "invalid");
  const note = input.note.trim();
  if (note.length < 3 || note.length > 4000) throw new ObservationError("Write the observation, in 3 to 4,000 characters.", "invalid");

  return withTenant(session.organisationId, async (tx) => {
    if (!(await learnerInReach(tx, await reachWithin(tx, session), input.learnerId))) {
      throw new ObservationError("This learner is not on a programme you are assigned to.", "not_permitted");
    }
    const [made] = await tx
      .insert(learnerObservations)
      .values({
        organisationId: session.organisationId,
        learnerId: input.learnerId,
        cohortId: input.cohortId || null,
        authorId: session.userId,
        kind,
        observedOn: input.observedOn,
        note,
      })
      .returning({ id: learnerObservations.id });
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "learner.observation_logged",
      entityType: "user",
      entityId: input.learnerId,
      after: { observationId: made.id, kind, observedOn: input.observedOn },
    });
    return made.id;
  });
}

export async function observationsOf(session: AuthenticatedSession, learnerId: string): Promise<Observation[]> {
  if (!mayReadObservations(session)) return [];
  return withTenant(session.organisationId, async (tx) => {
    if (!(await learnerInReach(tx, await reachWithin(tx, session), learnerId))) return [];
    const rows = await tx
      .select({
        id: learnerObservations.id,
        kind: learnerObservations.kind,
        observedOn: learnerObservations.observedOn,
        note: learnerObservations.note,
        cohort: cohorts.name,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(learnerObservations)
      .leftJoin(cohorts, eq(cohorts.id, learnerObservations.cohortId))
      .leftJoin(users, eq(users.id, learnerObservations.authorId))
      .where(and(eq(learnerObservations.learnerId, learnerId)))
      .orderBy(desc(learnerObservations.observedOn), desc(learnerObservations.createdAt));
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      observedOn: String(row.observedOn),
      note: row.note,
      cohort: row.cohort,
      author: row.firstName ? `${row.firstName} ${row.lastName ?? ""}`.trim() : null,
    }));
  });
}
