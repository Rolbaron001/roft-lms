import { and, eq, inArray, or, sql, type SQL, type AnyColumn } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  assessments,
  assessmentSubmissions,
  cohortMembers,
  cohorts,
  cohortSessions,
  courses,
  curriculumModules,
  enrolments,
  learningPathCourses,
  programmeStaff,
  qualificationModules,
  studyUnits,
} from "@/db/schema";
import type { Role } from "./rbac";
import type { AuthenticatedSession } from "./session";
import type { Capacity } from "./programme-staff";

/**
 * What a facilitator, assessor or moderator may see: only what they have been
 * assigned to. Roland, 10 October 2026: "Staff should be assigned to something
 * specific and access be restricted to that which they have been assigned."
 *
 * Assigned means named on a programme (lib/programme-staff.ts: a
 * qualification, a study unit, a course or a programme of courses, each
 * reaching the courses beneath it), and for a facilitator also named as a
 * cohort's facilitator or on one of its sessions. What follows from that:
 * the courses, the cohorts of those programmes, their qualifications, and
 * the learners enrolled on them.
 *
 * Whom it applies to: a person whose staff roles are only facilitator,
 * assessor or moderator. Anybody who also holds a role that answers for the
 * whole provider (administrator, Administrator View, skills development
 * facilitator, external verifier) sees the whole provider, as before.
 *
 * Somebody assigned to nothing sees nothing of anybody else's, and the screens
 * say so rather than appearing broken. Their own learning is untouched.
 */

const ASSIGNED_ROLES: Role[] = ["instructor", "assessor", "moderator"];
const WHOLE_PROVIDER_ROLES: Role[] = [
  "platform_owner",
  "tenant_admin",
  "tenant_viewer",
  "skills_development_facilitator",
  "external_verifier",
];

const CAPACITY_OF: Partial<Record<Role, Capacity>> = {
  instructor: "facilitator",
  assessor: "assessor",
  moderator: "moderator",
};

export type Reach =
  | { whole: true }
  | {
      whole: false;
      courses: Set<string>;
      cohorts: Set<string>;
      qualifications: Set<string>;
      paths: Set<string>;
    };

const WHOLE: Reach = { whole: true };

/** Whether this person sees only what they are assigned to. */
export function isAssignedOnly(session: Pick<AuthenticatedSession, "roles">): boolean {
  return (
    session.roles.some((role) => ASSIGNED_ROLES.includes(role)) &&
    !session.roles.some((role) => WHOLE_PROVIDER_ROLES.includes(role))
  );
}

const ids = <T>(rows: T[], pick: (row: T) => string | null | undefined) =>
  rows.map(pick).filter((id): id is string => Boolean(id));

/**
 * The reach itself, worked out inside a transaction the caller already holds.
 * `capacity` narrows it to one kind of assignment: the queue to assess is the
 * assessor's programmes, not the ones the same person facilitates.
 */
export async function reachWithin(
  tx: TenantDatabase,
  session: Pick<AuthenticatedSession, "roles" | "userId">,
  capacity?: Capacity,
): Promise<Reach> {
  if (!isAssignedOnly(session)) return WHOLE;
  const held = session.roles.map((role) => CAPACITY_OF[role]).filter((one): one is Capacity => Boolean(one));
  const capacities = capacity ? held.filter((one) => one === capacity) : held;
  const empty: Reach = { whole: false, courses: new Set(), cohorts: new Set(), qualifications: new Set(), paths: new Set() };
  if (capacities.length === 0) return empty;

  const named = await tx
    .select({
      qualificationId: programmeStaff.qualificationId,
      studyUnitId: programmeStaff.studyUnitId,
      courseId: programmeStaff.courseId,
      learningPathId: programmeStaff.learningPathId,
    })
    .from(programmeStaff)
    .where(and(eq(programmeStaff.userId, session.userId), inArray(programmeStaff.capacity, capacities)));

  const qualificationIds = new Set(ids(named, (row) => row.qualificationId));
  const unitIds = new Set(ids(named, (row) => row.studyUnitId));
  const courseIds = new Set(ids(named, (row) => row.courseId));
  const pathIds = new Set(ids(named, (row) => row.learningPathId));
  const cohortIds = new Set<string>();

  // A facilitator also reaches the cohorts they take, and those cohorts'
  // programmes, whether or not anybody named them on the programme itself.
  if (capacities.includes("facilitator")) {
    const taken = await tx
      .select({ id: cohorts.id, courseId: cohorts.courseId, qualificationId: cohorts.qualificationId })
      .from(cohorts)
      .where(
        or(
          eq(cohorts.facilitatorId, session.userId),
          inArray(
            cohorts.id,
            tx.select({ id: cohortSessions.cohortId }).from(cohortSessions).where(eq(cohortSessions.facilitatorId, session.userId)),
          ),
        ),
      );
    for (const row of taken) {
      cohortIds.add(row.id);
      if (row.courseId) courseIds.add(row.courseId);
      if (row.qualificationId) qualificationIds.add(row.qualificationId);
    }
    // A course they made themselves is theirs until somebody assigns it.
    const owned = await tx.select({ id: courses.id }).from(courses).where(eq(courses.ownerId, session.userId));
    for (const row of owned) courseIds.add(row.id);
  }

  // Down from the programmes to their courses.
  if (pathIds.size) {
    const inPaths = await tx
      .select({ courseId: learningPathCourses.courseId })
      .from(learningPathCourses)
      .where(inArray(learningPathCourses.learningPathId, [...pathIds]));
    for (const row of inPaths) courseIds.add(row.courseId);
  }
  if (qualificationIds.size || unitIds.size) {
    const quals = [...qualificationIds];
    const viaUnits = await tx
      .select({ id: courses.id, unitId: studyUnits.id })
      .from(courses)
      .innerJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
      .where(
        or(
          quals.length ? inArray(studyUnits.qualificationId, quals) : undefined,
          unitIds.size ? inArray(studyUnits.id, [...unitIds]) : undefined,
        ),
      );
    for (const row of viaUnits) courseIds.add(row.id);
    if (quals.length) {
      // A course built on a module of the curriculum, without a study unit.
      const viaModules = await tx
        .select({ id: courses.id })
        .from(courses)
        .where(
          or(
            inArray(courses.curriculumModuleId, tx.select({ id: curriculumModules.id }).from(curriculumModules).where(inArray(curriculumModules.qualificationId, quals))),
            inArray(courses.curriculumModuleId, tx.select({ id: qualificationModules.curriculumModuleId }).from(qualificationModules).where(inArray(qualificationModules.qualificationId, quals))),
          ),
        );
      for (const row of viaModules) courseIds.add(row.id);
    }
  }

  // Up from the courses to their qualifications, so the programme's own page
  // opens for somebody named only on one of its study units.
  if (courseIds.size) {
    const up = await tx
      .select({ qualificationId: studyUnits.qualificationId })
      .from(courses)
      .innerJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
      .where(inArray(courses.id, [...courseIds]));
    for (const row of up) if (row.qualificationId) qualificationIds.add(row.qualificationId);
  }

  // The cohorts running those programmes.
  if (courseIds.size || qualificationIds.size) {
    const running = await tx
      .select({ id: cohorts.id })
      .from(cohorts)
      .where(
        or(
          courseIds.size ? inArray(cohorts.courseId, [...courseIds]) : undefined,
          qualificationIds.size ? inArray(cohorts.qualificationId, [...qualificationIds]) : undefined,
        ),
      );
    for (const row of running) cohortIds.add(row.id);
  }

  return { whole: false, courses: courseIds, cohorts: cohortIds, qualifications: qualificationIds, paths: pathIds };
}

/** The same, in a transaction of its own. */
export async function reachOf(session: AuthenticatedSession, capacity?: Capacity): Promise<Reach> {
  if (!isAssignedOnly(session)) return WHOLE;
  return withTenant(session.organisationId, (tx) => reachWithin(tx, session, capacity));
}

/**
 * A condition for a query's where clause: rows whose column is one of the
 * reach's courses (or cohorts, or qualifications). Nothing to add for somebody
 * who sees the whole provider; a condition that is never true for somebody
 * assigned to nothing.
 */
function within(set: Set<string> | null, column: AnyColumn | SQL): SQL | undefined {
  if (set === null) return undefined;
  return set.size ? inArray(column as AnyColumn, [...set]) : sql`false`;
}

export const coursesWithin = (reach: Reach, column: AnyColumn | SQL) => within(reach.whole ? null : reach.courses, column);
export const cohortsWithin = (reach: Reach, column: AnyColumn | SQL) => within(reach.whole ? null : reach.cohorts, column);
export const qualificationsWithin = (reach: Reach, column: AnyColumn | SQL) => within(reach.whole ? null : reach.qualifications, column);
export const pathsWithin = (reach: Reach, column: AnyColumn | SQL) => within(reach.whole ? null : reach.paths, column);

/**
 * Learners within reach: enrolled on one of its courses, or a member of one of
 * its cohorts. For a column holding a learner's user id.
 */
export function learnersWithin(tx: TenantDatabase, reach: Reach, column: AnyColumn | SQL): SQL | undefined {
  if (reach.whole) return undefined;
  if (!reach.courses.size && !reach.cohorts.size) return sql`false`;
  return or(
    reach.courses.size
      ? inArray(column as AnyColumn, tx.select({ id: enrolments.userId }).from(enrolments).where(inArray(enrolments.courseId, [...reach.courses])))
      : undefined,
    reach.cohorts.size
      ? inArray(column as AnyColumn, tx.select({ id: cohortMembers.userId }).from(cohortMembers).where(inArray(cohortMembers.cohortId, [...reach.cohorts])))
      : undefined,
  );
}

/**
 * The course a submission belongs to: its assessment's, or, for an assessment
 * that belongs to no one course, the course the learner was enrolled on. For
 * a query that joins submissions to assessments.
 */
export const submissionCourse = sql`coalesce(${assessments.courseId}, (select e.course_id from enrolments e where e.id = ${assessmentSubmissions.enrolmentId}))`;

/** Whether one submission is within reach, for its marking or moderating page. */
export async function submissionInReach(tx: TenantDatabase, reach: Reach, submissionId: string): Promise<boolean> {
  if (reach.whole) return true;
  const [row] = await tx
    .select({ courseId: submissionCourse })
    .from(assessmentSubmissions)
    .innerJoin(assessments, eq(assessments.id, assessmentSubmissions.assessmentId))
    .where(eq(assessmentSubmissions.id, submissionId));
  return Boolean(row?.courseId && reach.courses.has(row.courseId as string));
}

/** Whether one thing is within reach, for a page that shows one thing. */
export function inReach(
  reach: Reach,
  target: { courseId?: string | null; cohortId?: string | null; qualificationId?: string | null; learningPathId?: string | null },
): boolean {
  if (reach.whole) return true;
  if (target.courseId && reach.courses.has(target.courseId)) return true;
  if (target.cohortId && reach.cohorts.has(target.cohortId)) return true;
  if (target.qualificationId && reach.qualifications.has(target.qualificationId)) return true;
  if (target.learningPathId && reach.paths.has(target.learningPathId)) return true;
  return false;
}

/** Whether a learner is within reach, for a page about one learner. */
export async function learnerInReach(tx: TenantDatabase, reach: Reach, userId: string): Promise<boolean> {
  if (reach.whole) return true;
  const condition = learnersWithin(tx, reach, sql`${userId}::uuid`);
  if (!condition) return true;
  const [row] = await tx.execute(sql`select (${condition}) as yes`);
  return Boolean((row as { yes?: boolean } | undefined)?.yes);
}

export class OutOfReachError extends Error {
  constructor() {
    super("This is not one of the programmes you are assigned to.");
    this.name = "OutOfReachError";
  }
}
