import { and, eq, inArray, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  assessmentSubmissions,
  certificates,
  cohorts,
  courses,
  curriculumModules,
  eisaSittings,
  enrolments,
  learningPaths,
  qualifications,
  rplApplications,
  statementsOfResults,
  studyUnits,
  workplaceAgreements,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Removing a qualification, and refusing to.
 *
 * Roland, 20 September: "There must be functionality to delete a
 * qualification. I understand that it shouldn't be possible if learners have
 * completed the qualification or if cohorts have been run against the
 * qualification, for record purposes. But, in cases where the qualification
 * has never been used, it should be possible to delete it."
 *
 * That is exactly the right rule, and it is the reason the product has refused
 * until now. A qualification is the thing a Statement of Results points at and
 * the thing an EISA sitting is registered against; removing one that anybody
 * has been assessed under would leave the provider unable to answer a QCTO
 * audit about learners it has already certificated. So the question is not
 * "may an administrator delete this" but "has anything happened yet".
 *
 * What counts as having happened is listed below, one table at a time, and
 * each is reported by name rather than as a single refusal. "This is in use"
 * tells somebody nothing; "two learners are enrolled and one Statement of
 * Results has been issued" tells them whether it is a mistake they can undo or
 * a record they must keep.
 *
 * `scripts/scrub-qualifications.ts` still exists and still bypasses all of
 * this. It is the break-glass path for clearing test data, it runs on the
 * server rather than in the product, and it is deliberately not reachable from
 * a browser.
 */

export class QualificationInUseError extends Error {
  constructor(
    message: string,
    /** What is holding it, so a screen can list them. */
    readonly holds: { what: string; count: number }[],
  ) {
    super(message);
    this.name = "QualificationInUseError";
  }
}

export type QualificationUsage = {
  /** Reasons this may not be removed. Empty means it may. */
  holds: { what: string; count: number }[];
  /** What would go with it, for somebody deciding. */
  removes: { what: string; count: number }[];
};

/**
 * What has happened against this qualification, and what merely hangs off it.
 *
 * The distinction is the whole feature. A curriculum, its study units and the
 * documents filed against it are the qualification itself and go with it; an
 * enrolment or a Statement of Results is a record of something a person did,
 * and is why the answer has to be no.
 */
export async function qualificationUsage(
  session: AuthenticatedSession,
  qualificationId: string,
): Promise<QualificationUsage> {
  assertSessionCan(session, "qualification:manage");

  return withTenant(session.organisationId, async (tx) => {
    const count = async (query: Promise<{ n: number }[]>) =>
      Number((await query)[0]?.n ?? 0);

    const moduleIds = (
      await tx
        .select({ id: curriculumModules.id })
        .from(curriculumModules)
        .where(eq(curriculumModules.qualificationId, qualificationId))
    ).map((row) => row.id);

    const unitIds = (
      await tx
        .select({ id: studyUnits.id })
        .from(studyUnits)
        .where(eq(studyUnits.qualificationId, qualificationId))
    ).map((row) => row.id);

    /*
     * Courses built against this qualification's curriculum, and the cohorts
     * that run them. A cohort is Roland's own example of something that must
     * block: it is a group of real people with a schedule and a register.
     */
    const courseIds =
      moduleIds.length === 0 && unitIds.length === 0
        ? []
        : (
            await tx
              .select({ id: courses.id })
              .from(courses)
              .where(
                sql`${
                  moduleIds.length > 0
                    ? inArray(courses.curriculumModuleId, moduleIds)
                    : sql`false`
                } or ${
                  unitIds.length > 0
                    ? inArray(courses.studyUnitId, unitIds)
                    : sql`false`
                }`,
              )
          ).map((row) => row.id);

    const holds: { what: string; count: number }[] = [];
    const add = (what: string, n: number) => {
      if (n > 0) holds.push({ what, count: n });
    };

    add(
      "learners enrolled",
      await count(
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(enrolments)
          .where(eq(enrolments.qualificationId, qualificationId)),
      ),
    );

    add(
      "Statements of Results issued",
      await count(
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(statementsOfResults)
          .where(eq(statementsOfResults.qualificationId, qualificationId)),
      ),
    );

    add(
      "EISA sittings registered",
      await count(
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(eisaSittings)
          .where(eq(eisaSittings.qualificationId, qualificationId)),
      ),
    );

    add(
      "recognition of prior learning applications",
      await count(
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(rplApplications)
          .where(eq(rplApplications.qualificationId, qualificationId)),
      ),
    );

    add(
      "workplace agreements",
      await count(
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(workplaceAgreements)
          .where(eq(workplaceAgreements.qualificationId, qualificationId)),
      ),
    );

    /*
     * A certificate points at an enrolment, not at a qualification, so it is
     * counted through one. Any certificate implies an enrolment and would be
     * caught above anyway - it is named separately because "one certificate
     * has been awarded" stops a conversation that "one learner is enrolled"
     * does not.
     */
    add(
      "certificates awarded",
      await count(
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(certificates)
          .innerJoin(enrolments, eq(enrolments.id, certificates.enrolmentId))
          .where(eq(enrolments.qualificationId, qualificationId)),
      ),
    );

    if (courseIds.length > 0) {
      add(
        "cohorts running its courses",
        await count(
          tx
            .select({ n: sql<number>`count(*)::int` })
            .from(cohorts)
            .where(inArray(cohorts.courseId, courseIds)),
        ),
      );

      add(
        "assessment submissions",
        await count(
          tx
            .select({ n: sql<number>`count(*)::int` })
            .from(assessmentSubmissions)
            .innerJoin(
              enrolments,
              eq(enrolments.id, assessmentSubmissions.enrolmentId),
            )
            .where(inArray(enrolments.courseId, courseIds)),
        ),
      );
    }

    return {
      holds,
      removes: [
        { what: "curriculum modules", count: moduleIds.length },
        { what: "study units", count: unitIds.length },
        { what: "courses built from it", count: courseIds.length },
      ].filter((row) => row.count > 0),
    };
  });
}

/**
 * Removes a qualification that nothing has happened against.
 *
 * Refuses, by name, where anything has. The check and the removal are in the
 * same transaction: checking in one and deleting in another leaves a window in
 * which somebody enrols between the two, and the enrolment would be taken with
 * the qualification it points at.
 */
export async function deleteQualification(
  session: AuthenticatedSession,
  qualificationId: string,
): Promise<{ title: string }> {
  assertSessionCan(session, "qualification:manage");

  const usage = await qualificationUsage(session, qualificationId);

  if (usage.holds.length > 0) {
    throw new QualificationInUseError(
      `This qualification cannot be removed: ${usage.holds
        .map((hold) => `${hold.count} ${hold.what}`)
        .join(", ")}. Those are records of what learners have done, and the platform keeps them.`,
      usage.holds,
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [held] = await tx
      .select({ title: qualifications.title })
      .from(qualifications)
      .where(eq(qualifications.id, qualificationId));

    if (!held) {
      throw new QualificationInUseError("That qualification was not found.", []);
    }

    /*
     * Programmes point at a qualification with ON DELETE SET NULL, so deleting
     * the row alone would leave a programme attached to nothing rather than
     * removing it. A programme built for this qualification and never used
     * goes with it; the scrub script takes the same view.
     */
    await tx
      .delete(learningPaths)
      .where(
        and(
          eq(learningPaths.organisationId, session.organisationId),
          eq(learningPaths.qualificationId, qualificationId),
        ),
      );

    // Everything else - modules, topics, elements, criteria, study units,
    // outcomes, documents - is ON DELETE CASCADE from the qualification.
    await tx
      .delete(qualifications)
      .where(eq(qualifications.id, qualificationId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "qualification.deleted",
      entityType: "qualification",
      entityId: qualificationId,
      before: held,
    });

    return { title: held.title };
  });
}
