/**
 * The Quality Assurer's work (Heidi, 13 November 2026; job sheet D51):
 * compliance holds, the register of staff credentials, and the audit trail.
 *
 * Heidi: "Full read-only audit access across all courses, learner
 * portfolios, assessment instruments, and moderation reports. Verify the
 * credentials, registration numbers, and expiry dates of Facilitators,
 * Assessors, and Moderators on the platform. Run compliance audits on
 * assessment tools. Place compliance holds on courses or cohorts if quality
 * irregularities are detected. Generate audit trail logs."
 */
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, type SQL } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  auditLog,
  cohortMembers,
  cohorts,
  complianceHolds,
  courses,
  programmeStaff,
  qualifications,
  studyUnits,
  userRoles,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

export class QualityError extends Error {}

// ---------------------------------------------------------------------------
// Compliance holds
// ---------------------------------------------------------------------------

/**
 * The hold that stops a result for this learner, if any: on the qualification
 * the work belongs to, or on a cohort the learner is in. Read inside the
 * writer's own transaction, so a hold placed a moment before is honoured.
 */
export async function holdBlocking(
  tx: TenantDatabase,
  subject: { learnerId: string; qualificationId?: string | null; courseId?: string | null },
): Promise<{ reason: string; on: "qualification" | "cohort"; name: string } | null> {
  let qualificationId = subject.qualificationId ?? null;
  if (!qualificationId && subject.courseId) {
    const [course] = await tx
      .select({ qualificationId: studyUnits.qualificationId })
      .from(courses)
      .innerJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
      .where(eq(courses.id, subject.courseId));
    qualificationId = course?.qualificationId ?? null;
  }
  const memberOf = await tx
    .select({ cohortId: cohortMembers.cohortId })
    .from(cohortMembers)
    .where(and(eq(cohortMembers.userId, subject.learnerId), isNull(cohortMembers.leftAt)));
  const conditions: SQL[] = [];
  if (qualificationId) conditions.push(eq(complianceHolds.qualificationId, qualificationId));
  if (memberOf.length) conditions.push(inArray(complianceHolds.cohortId, memberOf.map((row) => row.cohortId)));
  if (conditions.length === 0) return null;

  const [hold] = await tx
    .select({
      reason: complianceHolds.reason,
      qualificationId: complianceHolds.qualificationId,
      qualificationTitle: qualifications.title,
      cohortName: cohorts.name,
    })
    .from(complianceHolds)
    .leftJoin(qualifications, eq(qualifications.id, complianceHolds.qualificationId))
    .leftJoin(cohorts, eq(cohorts.id, complianceHolds.cohortId))
    .where(and(isNull(complianceHolds.liftedAt), or(...conditions)))
    .limit(1);
  if (!hold) return null;
  return {
    reason: hold.reason,
    on: hold.qualificationId ? "qualification" : "cohort",
    name: hold.qualificationTitle ?? hold.cohortName ?? "",
  };
}

/** The sentence said when a hold stops something. */
export function holdMessage(hold: { reason: string; on: "qualification" | "cohort"; name: string }, what: string): string {
  return `${hold.on === "qualification" ? "The qualification" : "The cohort"} ${hold.name} is under a compliance hold (${hold.reason}). ${what} until a Quality Assurer lifts it.`;
}

export type HoldView = {
  id: string;
  on: "qualification" | "cohort";
  targetId: string;
  name: string;
  reason: string;
  placedBy: string | null;
  placedAt: Date;
  liftedBy: string | null;
  liftedAt: Date | null;
  liftNote: string | null;
};

/** Every hold, standing ones first. */
export async function listHolds(session: AuthenticatedSession): Promise<HoldView[]> {
  assertSessionCan(session, "audit:read");
  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({
        id: complianceHolds.id,
        qualificationId: complianceHolds.qualificationId,
        cohortId: complianceHolds.cohortId,
        qualificationTitle: qualifications.title,
        cohortName: cohorts.name,
        reason: complianceHolds.reason,
        placedById: complianceHolds.placedById,
        placedAt: complianceHolds.placedAt,
        liftedById: complianceHolds.liftedById,
        liftedAt: complianceHolds.liftedAt,
        liftNote: complianceHolds.liftNote,
      })
      .from(complianceHolds)
      .leftJoin(qualifications, eq(qualifications.id, complianceHolds.qualificationId))
      .leftJoin(cohorts, eq(cohorts.id, complianceHolds.cohortId))
      .orderBy(desc(complianceHolds.placedAt));
    const ids = [...new Set(rows.flatMap((row) => [row.placedById, row.liftedById]).filter((id): id is string => Boolean(id)))];
    const people = ids.length
      ? await tx.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users).where(inArray(users.id, ids))
      : [];
    const name = (id: string | null) => {
      const person = people.find((one) => one.id === id);
      return person ? `${person.firstName} ${person.lastName}` : null;
    };
    return rows
      .map((row) => ({
        id: row.id,
        on: (row.qualificationId ? "qualification" : "cohort") as "qualification" | "cohort",
        targetId: (row.qualificationId ?? row.cohortId)!,
        name: row.qualificationTitle ?? row.cohortName ?? "",
        reason: row.reason,
        placedBy: name(row.placedById),
        placedAt: row.placedAt,
        liftedBy: name(row.liftedById),
        liftedAt: row.liftedAt,
        liftNote: row.liftNote,
      }))
      .sort((a, b) => Number(a.liftedAt !== null) - Number(b.liftedAt !== null));
  });
}

/** What a hold can be placed on: the provider's qualifications and cohorts. */
export async function holdTargets(session: AuthenticatedSession) {
  assertSessionCan(session, "quality:hold");
  return withTenant(session.organisationId, async (tx) => ({
    qualifications: await tx.select({ id: qualifications.id, name: qualifications.title }).from(qualifications).orderBy(asc(qualifications.title)),
    cohorts: await tx
      .select({ id: cohorts.id, name: cohorts.name })
      .from(cohorts)
      .where(inArray(cohorts.status, ["planned", "running"]))
      .orderBy(asc(cohorts.name)),
  }));
}

/** Places a hold on a qualification or a cohort. */
export async function placeHold(
  session: AuthenticatedSession,
  input: { qualificationId?: string; cohortId?: string; reason: string },
): Promise<void> {
  assertSessionCan(session, "quality:hold");
  const reason = input.reason.trim();
  if (Boolean(input.qualificationId) === Boolean(input.cohortId)) throw new QualityError("Choose one qualification or one cohort.");
  if (reason.length < 5) throw new QualityError("Give the reason for the hold.");
  await withTenant(session.organisationId, async (tx) => {
    const [hold] = await tx
      .insert(complianceHolds)
      .values({
        organisationId: session.organisationId,
        qualificationId: input.qualificationId ?? null,
        cohortId: input.cohortId ?? null,
        reason,
        placedById: session.userId,
      })
      .returning({ id: complianceHolds.id });
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "compliance_hold.placed",
      entityType: input.qualificationId ? "qualification" : "cohort",
      entityId: (input.qualificationId ?? input.cohortId)!,
      after: { holdId: hold.id, reason },
    });
  });
}

/** Lifts a standing hold, with a note of what was resolved. */
export async function liftHold(session: AuthenticatedSession, holdId: string, note: string): Promise<void> {
  assertSessionCan(session, "quality:hold");
  const trimmed = note.trim();
  if (trimmed.length < 5) throw new QualityError("Say what was resolved before lifting the hold.");
  await withTenant(session.organisationId, async (tx) => {
    const [hold] = await tx
      .update(complianceHolds)
      .set({ liftedAt: new Date(), liftedById: session.userId, liftNote: trimmed })
      .where(and(eq(complianceHolds.id, holdId), isNull(complianceHolds.liftedAt)))
      .returning({ qualificationId: complianceHolds.qualificationId, cohortId: complianceHolds.cohortId });
    if (!hold) throw new QualityError("That hold is not standing.");
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "compliance_hold.lifted",
      entityType: hold.qualificationId ? "qualification" : "cohort",
      entityId: (hold.qualificationId ?? hold.cohortId)!,
      after: { holdId, note: trimmed },
    });
  });
}

// ---------------------------------------------------------------------------
// The credentials register
// ---------------------------------------------------------------------------

export type CredentialRow = {
  userId: string;
  name: string;
  capacity: string;
  programme: string;
  registrationNumber: string | null;
  expiresOn: string | null;
  state: "valid" | "expiring" | "expired" | "missing" | "not_needed";
};

const EXPIRING_DAYS = 60;

/**
 * Every facilitator, assessor and moderator named on a programme, with their
 * registration for it. Assessors and moderators must have a number; one that
 * has expired, or expires within EXPIRING_DAYS, is flagged. A facilitator's
 * number is recorded where the provider keeps one, and not required.
 */
export async function credentialsRegister(session: AuthenticatedSession, today: string): Promise<CredentialRow[]> {
  assertSessionCan(session, "audit:read");
  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({
        userId: programmeStaff.userId,
        firstName: users.firstName,
        lastName: users.lastName,
        capacity: programmeStaff.capacity,
        registrationNumber: programmeStaff.registrationNumber,
        expiresOn: programmeStaff.registrationExpiresOn,
        qualification: qualifications.title,
        unitTitle: studyUnits.title,
        courseTitle: courses.title,
      })
      .from(programmeStaff)
      .innerJoin(users, eq(users.id, programmeStaff.userId))
      .leftJoin(qualifications, eq(qualifications.id, programmeStaff.qualificationId))
      .leftJoin(studyUnits, eq(studyUnits.id, programmeStaff.studyUnitId))
      .leftJoin(courses, eq(courses.id, programmeStaff.courseId))
      .orderBy(asc(users.lastName), asc(users.firstName));
    // The role's own number, where none is recorded for the programme.
    const roleNumbers = await tx
      .select({ userId: userRoles.userId, role: userRoles.role, number: userRoles.registrationNumber })
      .from(userRoles)
      .where(isNull(userRoles.revokedAt));
    const soon = new Date(Date.parse(today) + EXPIRING_DAYS * 86_400_000).toISOString().slice(0, 10);
    // Named on several units of one programme is one line, not several.
    const seen = new Set<string>();
    const unique = rows.filter((row) => {
      const key = [row.userId, row.capacity, row.qualification ?? row.unitTitle ?? row.courseTitle, row.registrationNumber, row.expiresOn].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return unique.map((row) => {
      const needed = row.capacity === "assessor" || row.capacity === "moderator";
      const number =
        row.registrationNumber ??
        roleNumbers.find((one) => one.userId === row.userId && one.role === row.capacity && one.number)?.number ??
        null;
      const state: CredentialRow["state"] = !number
        ? needed
          ? "missing"
          : "not_needed"
        : row.expiresOn && row.expiresOn < today
          ? "expired"
          : row.expiresOn && row.expiresOn <= soon
            ? "expiring"
            : "valid";
      return {
        userId: row.userId,
        name: `${row.firstName} ${row.lastName}`,
        capacity: row.capacity,
        programme: row.qualification ?? row.unitTitle ?? row.courseTitle ?? "",
        registrationNumber: number,
        expiresOn: row.expiresOn,
        state,
      };
    });
  });
}

// ---------------------------------------------------------------------------
// The audit trail
// ---------------------------------------------------------------------------

export type AuditFilter = { action?: string; actorId?: string; from?: string; to?: string };

export type AuditRow = {
  occurredAt: Date;
  actor: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
};

/** The audit trail, newest first, filtered; at most `limit` rows. */
export async function auditTrail(session: AuthenticatedSession, filter: AuditFilter, limit = 200): Promise<AuditRow[]> {
  assertSessionCan(session, "audit:read");
  const conditions: SQL[] = [];
  // The searched words taken literally: % and _ are wildcards in ILIKE, and
  // action names are full of underscores.
  if (filter.action?.trim()) conditions.push(ilike(auditLog.action, `%${filter.action.trim().replace(/[\\%_]/g, (character) => `\\${character}`)}%`));
  if (filter.actorId) conditions.push(eq(auditLog.actorId, filter.actorId));
  if (filter.from && /^\d{4}-\d{2}-\d{2}$/.test(filter.from)) conditions.push(gte(auditLog.occurredAt, new Date(`${filter.from}T00:00:00Z`)));
  if (filter.to && /^\d{4}-\d{2}-\d{2}$/.test(filter.to)) conditions.push(lte(auditLog.occurredAt, new Date(`${filter.to}T23:59:59Z`)));
  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({
        occurredAt: auditLog.occurredAt,
        firstName: users.firstName,
        lastName: users.lastName,
        actorRole: auditLog.actorRole,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        before: auditLog.before,
        after: auditLog.after,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.occurredAt))
      .limit(limit);
    return rows.map((row) => ({
      occurredAt: row.occurredAt,
      actor: row.firstName ? `${row.firstName} ${row.lastName}` : null,
      actorRole: row.actorRole,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      before: row.before,
      after: row.after,
    }));
  });
}

/** The people who appear in the audit trail, for its filter. */
export async function auditActors(session: AuthenticatedSession) {
  assertSessionCan(session, "audit:read");
  return withTenant(session.organisationId, (tx) =>
    tx.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users).orderBy(asc(users.lastName)),
  );
}

/** The audit trail as CSV, for filing or a regulator. */
export function auditCsv(rows: AuditRow[]): string {
  const cell = (value: unknown) => {
    const text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const head = ["When", "Who", "Role", "Action", "On", "Record", "Before", "After"];
  return [head, ...rows.map((row) => [row.occurredAt.toISOString(), row.actor, row.actorRole, row.action, row.entityType, row.entityId, row.before, row.after])]
    .map((line) => line.map(cell).join(","))
    .join("\n");
}
