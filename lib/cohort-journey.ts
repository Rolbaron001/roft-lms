import { and, count, countDistinct, eq, isNull, isNotNull, or, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { cohortArchives, cohortMembers, cohortSessions, cohorts, enrolmentDocuments, stepReleases } from "@/db/schema";
import { CohortError } from "./cohorts";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Where a cohort is in being set up and run, step by step (Roland, 8 October
 * 2026: building a cohort with Heidi, he "was unable to explain what comes
 * next or what was required at specific points"). Each step is read from what
 * the platform holds, never ticked by hand, so the guide cannot claim a step
 * is done when it is not. The screen is components/cohort-nav.tsx.
 */

export const COHORT_STEPS = ["setup", "payment", "learners", "plan", "sessions", "run", "archive"] as const;
export type CohortStepKey = (typeof COHORT_STEPS)[number];

export type CohortJourney = {
  cohort: { id: string; name: string; startDate: string; releaseMode: string };
  done: Record<CohortStepKey, boolean>;
  /** The first step not yet done, or null once it is all done. */
  next: CohortStepKey | null;
  started: boolean;
};

export async function cohortJourney(session: AuthenticatedSession, cohortId: string): Promise<CohortJourney> {
  assertSessionCan(session, "enrolment:read_all");
  return withTenant(session.organisationId, async (tx) => {
    const [cohort] = await tx.select().from(cohorts).where(eq(cohorts.id, cohortId));
    if (!cohort) throw new CohortError("No such cohort.", "not_found");

    const [members] = await tx
      .select({ n: count() })
      .from(cohortMembers)
      .where(and(eq(cohortMembers.cohortId, cohortId), isNull(cohortMembers.leftAt)));
    const [dated] = await tx
      .select({ n: count() })
      .from(stepReleases)
      .where(and(eq(stepReleases.cohortId, cohortId), or(isNotNull(stepReleases.opensAfterDays), isNotNull(stepReleases.releasedAt))));
    const [sessions] = await tx.select({ n: count() }).from(cohortSessions).where(eq(cohortSessions.cohortId, cohortId));
    const [archived] = await tx
      .select({ n: count() })
      .from(cohortArchives)
      .where(and(eq(cohortArchives.cohortId, cohortId), inArray(cohortArchives.status, ["verified", "removed"])));

    // Learners paying their own way: each supplies an accepted proof of
    // payment instead, and when every one has, the cohort is paid for too.
    const [selfPaid] = members.n
      ? await tx
          .select({ n: countDistinct(enrolmentDocuments.userId) })
          .from(enrolmentDocuments)
          .innerJoin(cohortMembers, and(eq(cohortMembers.userId, enrolmentDocuments.userId), eq(cohortMembers.cohortId, cohortId), isNull(cohortMembers.leftAt)))
          .where(and(eq(enrolmentDocuments.kind, "proof_of_payment"), eq(enrolmentDocuments.verification, "accepted")))
      : [{ n: 0 }];

    const today = new Date().toISOString().slice(0, 10);
    const started = cohort.startDate <= today;
    const done: Record<CohortStepKey, boolean> = {
      setup: true,
      payment: Boolean(cohort.paymentReceivedAt) || (members.n > 0 && selfPaid.n >= members.n),
      learners: members.n > 0,
      // A cohort with everything open has nothing to plan.
      plan: cohort.releaseMode === "open" || dated.n > 0,
      sessions: sessions.n > 0,
      // Running is under way once it has started; it is done when archived.
      run: archived.n > 0,
      archive: archived.n > 0,
    };
    // Running only becomes the next thing once everything before it is in place.
    const next = COHORT_STEPS.find((step) => !done[step]) ?? null;

    return {
      cohort: { id: cohort.id, name: cohort.name, startDate: cohort.startDate, releaseMode: cohort.releaseMode },
      done,
      next,
      started,
    };
  });
}
