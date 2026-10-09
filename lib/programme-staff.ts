import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantDatabase } from "@/db/client";
import { cohorts, courses, programmeStaff, studyUnits, userRoles, users } from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Who facilitates, assesses and moderates each programme (job sheet D27). See
 * db/schema/programme-staff.ts. For every kind of programme the platform
 * holds: a full or part qualification or skills programme, a study unit, a
 * course, a programme of courses.
 */

export const CAPACITIES = ["facilitator", "assessor", "moderator"] as const;
export type Capacity = (typeof CAPACITIES)[number];

/** The role a person must hold to be named in each capacity. */
const ROLE_FOR: Record<Capacity, "instructor" | "assessor" | "moderator"> = {
  facilitator: "instructor",
  assessor: "assessor",
  moderator: "moderator",
};

export class StaffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffError";
  }
}

export type StaffScope =
  | { qualificationId: string }
  | { studyUnitId: string }
  | { courseId: string }
  | { learningPathId: string };

export type StaffRow = {
  id: string;
  userId: string;
  name: string;
  capacity: Capacity;
  registrationNumber: string | null;
  registrationExpiresOn: string | null;
  /** Named on the qualification above, and holding here because nobody is named here. */
  inherited: boolean;
};

const scopeColumn = (scope: StaffScope) =>
  "qualificationId" in scope
    ? eq(programmeStaff.qualificationId, scope.qualificationId)
    : "studyUnitId" in scope
      ? eq(programmeStaff.studyUnitId, scope.studyUnitId)
      : "courseId" in scope
        ? eq(programmeStaff.courseId, scope.courseId)
        : eq(programmeStaff.learningPathId, scope.learningPathId);

async function rowsAt(tx: TenantDatabase, scope: StaffScope, inherited: boolean): Promise<StaffRow[]> {
  const rows = await tx
    .select({
      id: programmeStaff.id,
      userId: programmeStaff.userId,
      firstName: users.firstName,
      lastName: users.lastName,
      capacity: programmeStaff.capacity,
      registrationNumber: programmeStaff.registrationNumber,
      registrationExpiresOn: programmeStaff.registrationExpiresOn,
    })
    .from(programmeStaff)
    .innerJoin(users, eq(users.id, programmeStaff.userId))
    .where(scopeColumn(scope))
    .orderBy(asc(programmeStaff.capacity), asc(users.lastName));
  return rows.map(({ firstName, lastName, ...row }) => ({ ...row, name: `${firstName} ${lastName}`, inherited }));
}

/** What a scope inherits from: a course its study unit, a study unit its qualification. */
async function parentsOf(tx: TenantDatabase, scope: StaffScope): Promise<StaffScope[]> {
  if ("courseId" in scope) {
    const [course] = await tx
      .select({ studyUnitId: courses.studyUnitId, qualificationId: studyUnits.qualificationId })
      .from(courses)
      .leftJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
      .where(eq(courses.id, scope.courseId));
    return [
      ...(course?.studyUnitId ? [{ studyUnitId: course.studyUnitId }] : []),
      ...(course?.qualificationId ? [{ qualificationId: course.qualificationId }] : []),
    ];
  }
  if ("studyUnitId" in scope) {
    const [unit] = await tx.select({ qualificationId: studyUnits.qualificationId }).from(studyUnits).where(eq(studyUnits.id, scope.studyUnitId));
    return unit ? [{ qualificationId: unit.qualificationId }] : [];
  }
  return [];
}

/**
 * The people on a programme, capacity by capacity: its own where it names
 * any, else the nearest level above that does.
 */
async function effective(tx: TenantDatabase, scope: StaffScope): Promise<StaffRow[]> {
  const levels = [await rowsAt(tx, scope, false)];
  // A study unit's course is the study unit: its people are the course's own.
  // Only the qualification's are marked as coming from above.
  for (const parent of await parentsOf(tx, scope)) levels.push(await rowsAt(tx, parent, "qualificationId" in parent));
  const out: StaffRow[] = [];
  for (const capacity of CAPACITIES) {
    const level = levels.find((rows) => rows.some((row) => row.capacity === capacity));
    if (level) out.push(...level.filter((row) => row.capacity === capacity));
  }
  return out;
}

export async function programmeStaffFor(session: AuthenticatedSession, scope: StaffScope): Promise<StaffRow[]> {
  assertSessionCan(session, "course:read");
  return withTenant(session.organisationId, (tx) => effective(tx, scope));
}

/** The facilitators a cohort's programme names, for its forms. */
export async function facilitatorsForCohort(session: AuthenticatedSession, cohortId: string): Promise<StaffRow[]> {
  assertSessionCan(session, "enrolment:read_all");
  return withTenant(session.organisationId, async (tx) => {
    const [cohort] = await tx.select({ courseId: cohorts.courseId, qualificationId: cohorts.qualificationId }).from(cohorts).where(eq(cohorts.id, cohortId));
    if (!cohort) return [];
    const scope: StaffScope | null = cohort.courseId ? { courseId: cohort.courseId } : cohort.qualificationId ? { qualificationId: cohort.qualificationId } : null;
    return scope ? (await effective(tx, scope)).filter((row) => row.capacity === "facilitator") : [];
  });
}

/** People who may be named, by capacity: those holding the matching role. */
export async function eligibleStaff(session: AuthenticatedSession): Promise<Record<Capacity, { id: string; name: string }[]>> {
  assertSessionCan(session, "user:read");
  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: userRoles.role })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(isNull(userRoles.revokedAt), eq(users.status, "active"), inArray(userRoles.role, ["instructor", "assessor", "moderator"])))
      .orderBy(asc(users.lastName), asc(users.firstName));
    const of = (role: string) => rows.filter((row) => row.role === role).map((row) => ({ id: row.id, name: `${row.firstName} ${row.lastName}` }));
    return { facilitator: of("instructor"), assessor: of("assessor"), moderator: of("moderator") };
  });
}

const assignInput = z.object({
  userId: z.string().uuid(),
  capacity: z.enum(CAPACITIES),
  qualificationId: z.string().uuid().optional(),
  studyUnitId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  learningPathId: z.string().uuid().optional(),
  registrationNumber: z.string().trim().max(100).optional(),
  registrationExpiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function assignStaff(session: AuthenticatedSession, input: z.input<typeof assignInput>) {
  assertSessionCan(session, "user:manage_roles");
  const parsed = assignInput.parse(input);
  const scopes = [parsed.qualificationId, parsed.studyUnitId, parsed.courseId, parsed.learningPathId].filter(Boolean);
  if (scopes.length !== 1) throw new StaffError("Name one qualification, study unit, course or programme.");

  return withTenant(session.organisationId, async (tx) => {
    const [held] = await tx
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(and(eq(userRoles.userId, parsed.userId), eq(userRoles.role, ROLE_FOR[parsed.capacity]), isNull(userRoles.revokedAt)));
    if (!held) throw new StaffError(`That person does not hold the ${ROLE_FOR[parsed.capacity] === "instructor" ? "facilitator" : parsed.capacity} role. Give them the role under People first.`);

    const scopeWhere = parsed.qualificationId
      ? eq(programmeStaff.qualificationId, parsed.qualificationId)
      : parsed.studyUnitId
        ? eq(programmeStaff.studyUnitId, parsed.studyUnitId)
        : parsed.courseId
          ? eq(programmeStaff.courseId, parsed.courseId)
          : eq(programmeStaff.learningPathId, parsed.learningPathId!);
    const [already] = await tx
      .select({ id: programmeStaff.id })
      .from(programmeStaff)
      .where(and(scopeWhere, eq(programmeStaff.userId, parsed.userId), eq(programmeStaff.capacity, parsed.capacity)));
    if (already) throw new StaffError("That person is already named here in that capacity.");

    const [created] = await tx
      .insert(programmeStaff)
      .values({
        organisationId: session.organisationId,
        userId: parsed.userId,
        capacity: parsed.capacity,
        qualificationId: parsed.qualificationId ?? null,
        studyUnitId: parsed.studyUnitId ?? null,
        courseId: parsed.courseId ?? null,
        learningPathId: parsed.learningPathId ?? null,
        registrationNumber: parsed.registrationNumber || null,
        registrationExpiresOn: parsed.registrationExpiresOn ?? null,
        assignedById: session.userId,
      })
      .returning();
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "programme_staff.assigned",
      entityType: "programme_staff",
      entityId: created.id,
      after: { userId: parsed.userId, capacity: parsed.capacity, scope: scopes[0] },
    });
    return created;
  });
}

export async function removeStaff(session: AuthenticatedSession, id: string) {
  assertSessionCan(session, "user:manage_roles");
  await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx.select().from(programmeStaff).where(eq(programmeStaff.id, id));
    if (!row) throw new StaffError("No such assignment.");
    await tx.delete(programmeStaff).where(eq(programmeStaff.id, id));
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "programme_staff.removed",
      entityType: "programme_staff",
      entityId: id,
      before: { userId: row.userId, capacity: row.capacity },
    });
  });
}

/** The facilitator of one cohort, chosen or changed after it was set up. */
export async function setCohortFacilitator(session: AuthenticatedSession, cohortId: string, userId: string | null) {
  assertSessionCan(session, "enrolment:manage");
  await withTenant(session.organisationId, async (tx) => {
    const [cohort] = await tx.select({ id: cohorts.id, facilitatorId: cohorts.facilitatorId }).from(cohorts).where(eq(cohorts.id, cohortId));
    if (!cohort) throw new StaffError("No such cohort.");
    if (userId) {
      const [held] = await tx
        .select({ id: userRoles.id })
        .from(userRoles)
        .where(and(eq(userRoles.userId, userId), eq(userRoles.role, "instructor"), isNull(userRoles.revokedAt)));
      if (!held) throw new StaffError("That person does not hold the facilitator role.");
    }
    await tx.update(cohorts).set({ facilitatorId: userId, updatedAt: new Date() }).where(eq(cohorts.id, cohortId));
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "cohort.facilitator_set",
      entityType: "cohort",
      entityId: cohortId,
      before: { facilitatorId: cohort.facilitatorId },
      after: { facilitatorId: userId },
    });
  });
}

/**
 * The courses a person is named on in a capacity, directly or through the
 * study unit or qualification above: what "their own" work is.
 */
export async function coursesOf(session: AuthenticatedSession, userId: string, capacity: Capacity): Promise<Set<string>> {
  return withTenant(session.organisationId, async (tx) => {
    const named = await tx
      .select({ qualificationId: programmeStaff.qualificationId, studyUnitId: programmeStaff.studyUnitId, courseId: programmeStaff.courseId })
      .from(programmeStaff)
      .where(and(eq(programmeStaff.userId, userId), eq(programmeStaff.capacity, capacity)));
    const qualificationIds = named.map((row) => row.qualificationId).filter((id): id is string => Boolean(id));
    const unitIds = named.map((row) => row.studyUnitId).filter((id): id is string => Boolean(id));
    const ids = new Set(named.map((row) => row.courseId).filter((id): id is string => Boolean(id)));
    if (qualificationIds.length || unitIds.length) {
      const reached = await tx
        .select({ id: courses.id })
        .from(courses)
        .innerJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
        .where(
          or(
            qualificationIds.length ? inArray(studyUnits.qualificationId, qualificationIds) : undefined,
            unitIds.length ? inArray(studyUnits.id, unitIds) : undefined,
          ),
        );
      for (const row of reached) ids.add(row.id);
    }
    return ids;
  });
}
