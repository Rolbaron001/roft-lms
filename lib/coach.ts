/**
 * A workplace coach's work beyond signing the logbook.
 *
 * Heidi's role specifications (job sheet D52 (7) to (10), 18 November 2026):
 * a workplace coach will view their learners' progress; "access, review, and
 * digitally sign off on Workplace Logbooks, practical observation checklists,
 * and witness testimonies"; "submit structured feedback on a learner's
 * workplace readiness and behavioural application of skills"; and message the
 * learner's facilitator or assessor.
 *
 * A coach reaches only the learners whose workplace agreement names them. The
 * learner reads what is recorded about them; their facilitators and assessors
 * read it too, and the assessor takes the signed records as evidence.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  coachRecords,
  cohortMembers,
  cohorts,
  courses,
  curriculumModules,
  curriculumTopicElements,
  enrolments,
  programmeStaff,
  users,
  workplaceAgreements,
  workplaceLogbookEntries,
  workplaceLogbooks,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { raise } from "./notifications";
import { learnerInReach, reachWithin } from "./staff-scope";
import { type AuthenticatedSession } from "./session";

export class CoachError extends Error {
  constructor(
    message: string,
    readonly code: "not_permitted" | "invalid" | "not_found",
  ) {
    super(message);
    this.name = "CoachError";
  }
}

import { READINESS_DIMENSIONS, RECOMMENDATIONS, type ReadinessDimension } from "./coach-shape";
export { READINESS_DIMENSIONS, RECOMMENDATIONS, type ReadinessDimension };

/** Whether this person coaches this learner: a workplace agreement names them. */
async function coaches(tx: TenantDatabase, session: AuthenticatedSession, learnerId: string): Promise<boolean> {
  if (!session.permissions.includes("workplace:sign")) return false;
  const [row] = await tx
    .select({ id: workplaceAgreements.id })
    .from(workplaceAgreements)
    .where(and(eq(workplaceAgreements.learnerId, learnerId), eq(workplaceAgreements.coachId, session.userId)))
    .limit(1);
  return Boolean(row);
}

/** Whether this person may read a learner's coach records: their coach, the learner, or their staff. */
async function mayRead(tx: TenantDatabase, session: AuthenticatedSession, learnerId: string): Promise<boolean> {
  if (session.userId === learnerId) return true;
  if (await coaches(tx, session, learnerId)) return true;
  const staff = ["workplace:manage", "assessment:assess", "enrolment:read_all", "records:read"].some((one) => session.permissions.includes(one as never));
  return staff && (await learnerInReach(tx, await reachWithin(tx, session), learnerId));
}

export type CoachLearner = {
  learnerId: string;
  name: string;
  employer: string;
  logbooks: { id: string; module: string; status: string; done: number; total: number }[];
};

/** The learners this coach's agreements name, with how far each logbook has got (D52 (7)). */
export async function coachLearners(session: AuthenticatedSession): Promise<CoachLearner[]> {
  if (!session.permissions.includes("workplace:sign")) return [];
  return withTenant(session.organisationId, async (tx) => {
    const agreements = await tx
      .select({ learnerId: workplaceAgreements.learnerId, employer: workplaceAgreements.employerName, firstName: users.firstName, lastName: users.lastName })
      .from(workplaceAgreements)
      .innerJoin(users, eq(users.id, workplaceAgreements.learnerId))
      .where(eq(workplaceAgreements.coachId, session.userId));
    const result: CoachLearner[] = [];
    for (const agreement of agreements) {
      if (result.some((one) => one.learnerId === agreement.learnerId)) continue;
      result.push({
        learnerId: agreement.learnerId,
        name: `${agreement.firstName} ${agreement.lastName ?? ""}`.trim(),
        employer: agreement.employer,
        logbooks: await logbookProgress(tx, agreement.learnerId),
      });
    }
    return result;
  });
}

async function logbookProgress(tx: TenantDatabase, learnerId: string) {
  const books = await tx
    .select({ id: workplaceLogbooks.id, status: workplaceLogbooks.status, code: curriculumModules.code, title: curriculumModules.title })
    .from(workplaceLogbooks)
    .innerJoin(curriculumModules, eq(curriculumModules.id, workplaceLogbooks.curriculumModuleId))
    .where(eq(workplaceLogbooks.learnerId, learnerId))
    .orderBy(curriculumModules.sortOrder);
  const out = [];
  for (const book of books) {
    const entries = await tx.select({ completed: workplaceLogbookEntries.completed }).from(workplaceLogbookEntries).where(eq(workplaceLogbookEntries.logbookId, book.id));
    out.push({ id: book.id, module: `${book.code} ${book.title}`, status: book.status, done: entries.filter((one) => one.completed).length, total: entries.length });
  }
  return out;
}

export type CoachRecord = {
  id: string;
  kind: "observation_checklist" | "witness_testimony" | "readiness_feedback" | "message";
  title: string;
  details: unknown;
  body: string;
  witnessName: string | null;
  witnessRole: string | null;
  observedOn: string | null;
  signedAt: Date | null;
  coach: string;
  createdAt: Date;
};

export type CoachLearnerView = {
  name: string;
  isCoach: boolean;
  logbooks: CoachLearner["logbooks"];
  courses: { title: string; status: string }[];
  /** A checklist drafted from each logbook's work activities, for the coach to tick. */
  activities: { logbookId: string; module: string; items: string[] }[];
  records: CoachRecord[];
};

/** Everything about one learner a coach (or their staff, or the learner) may see here. */
export async function coachLearnerView(session: AuthenticatedSession, learnerId: string): Promise<CoachLearnerView | null> {
  return withTenant(session.organisationId, async (tx) => {
    if (!(await mayRead(tx, session, learnerId))) return null;
    const [learner] = await tx.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, learnerId));
    if (!learner) return null;
    const logbooks = await logbookProgress(tx, learnerId);
    const courseRows = await tx
      .select({ title: courses.title, status: enrolments.status })
      .from(enrolments)
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .where(eq(enrolments.userId, learnerId));
    const activities = [];
    for (const book of logbooks) {
      const items = await tx
        .select({ code: curriculumTopicElements.code, description: curriculumTopicElements.description, kind: curriculumTopicElements.kind })
        .from(workplaceLogbookEntries)
        .innerJoin(curriculumTopicElements, eq(curriculumTopicElements.id, workplaceLogbookEntries.topicElementId))
        .where(eq(workplaceLogbookEntries.logbookId, book.id));
      const work = items.filter((one) => one.kind === "work_activity");
      activities.push({ logbookId: book.id, module: book.module, items: (work.length ? work : items).map((one) => `${one.code} ${one.description}`) });
    }
    const coach = users;
    const rows = await tx
      .select({
        id: coachRecords.id,
        kind: coachRecords.kind,
        title: coachRecords.title,
        details: coachRecords.details,
        body: coachRecords.body,
        witnessName: coachRecords.witnessName,
        witnessRole: coachRecords.witnessRole,
        observedOn: coachRecords.observedOn,
        signedAt: coachRecords.signedAt,
        createdAt: coachRecords.createdAt,
        firstName: coach.firstName,
        lastName: coach.lastName,
      })
      .from(coachRecords)
      .innerJoin(coach, eq(coach.id, coachRecords.coachId))
      .where(
        session.userId === learnerId
          ? // A coach's message to staff is between them; the learner reads the signed records.
            and(eq(coachRecords.learnerId, learnerId), ne(coachRecords.kind, "message"))
          : eq(coachRecords.learnerId, learnerId),
      )
      .orderBy(desc(coachRecords.createdAt));
    return {
      name: `${learner.firstName} ${learner.lastName ?? ""}`.trim(),
      isCoach: await coaches(tx, session, learnerId),
      logbooks,
      courses: courseRows,
      activities,
      records: rows.map((row) => ({ ...row, observedOn: row.observedOn ? String(row.observedOn) : null, coach: `${row.firstName} ${row.lastName ?? ""}`.trim() })),
    };
  });
}

/** The learner's facilitators and assessors: named on their programmes, or facilitating their cohorts. */
async function learnerStaff(tx: TenantDatabase, learnerId: string): Promise<string[]> {
  // The agreement may name the qualification; the logbooks always do, through their module.
  const fromAgreements = await tx.select({ id: workplaceAgreements.qualificationId }).from(workplaceAgreements).where(eq(workplaceAgreements.learnerId, learnerId));
  const fromLogbooks = await tx
    .select({ id: curriculumModules.qualificationId })
    .from(workplaceLogbooks)
    .innerJoin(curriculumModules, eq(curriculumModules.id, workplaceLogbooks.curriculumModuleId))
    .where(eq(workplaceLogbooks.learnerId, learnerId));
  const quals = [...new Set([...fromAgreements, ...fromLogbooks].map((row) => row.id).filter((id): id is string => Boolean(id)))];
  const named = quals.length
    ? await tx
        .select({ userId: programmeStaff.userId })
        .from(programmeStaff)
        .where(and(inArray(programmeStaff.qualificationId, quals), inArray(programmeStaff.capacity, ["facilitator", "assessor"])))
    : [];
  const facilitating = await tx
    .select({ userId: cohorts.facilitatorId })
    .from(cohortMembers)
    .innerJoin(cohorts, eq(cohorts.id, cohortMembers.cohortId))
    .where(and(eq(cohortMembers.userId, learnerId), isNull(cohortMembers.leftAt)));
  return [...new Set([...named.map((row) => row.userId), ...facilitating.map((row) => row.userId)].filter((id): id is string => Boolean(id)))];
}

const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function writeRecord(
  session: AuthenticatedSession,
  learnerId: string,
  record: Omit<typeof coachRecords.$inferInsert, "organisationId" | "learnerId" | "coachId">,
  notify: { subject: string; body: string },
): Promise<string> {
  return withTenant(session.organisationId, async (tx) => {
    if (!(await coaches(tx, session, learnerId))) throw new CoachError("You are not this learner's workplace coach.", "not_permitted");
    const signedAt = new Date();
    const signatureHash = record.kind === "message" ? null : fingerprint({ ...record, learnerId, coach: session.userId, signedAt });
    const [made] = await tx
      .insert(coachRecords)
      .values({ ...record, organisationId: session.organisationId, learnerId, coachId: session.userId, signedAt: record.kind === "message" ? null : signedAt, signatureHash })
      .returning({ id: coachRecords.id });
    const staff = await learnerStaff(tx, learnerId);
    for (const userId of [...staff, ...(record.kind === "message" ? [] : [learnerId])]) {
      await raise(tx, {
        organisationId: session.organisationId,
        userId,
        kind: record.kind === "message" ? "coach.message" : "coach.record",
        subject: notify.subject,
        body: notify.body,
        linkPath: `/workplace/learners/${learnerId}`,
        entityType: "coach_record",
        entityId: made.id,
        dedupeKey: `coach_record:${made.id}:${userId}`,
        channels: ["in_app", "email"],
      });
    }
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: `coach.${record.kind}`,
      entityType: "user",
      entityId: learnerId,
      after: { recordId: made.id, title: record.title, notified: staff.length },
    });
    return made.id;
  });
}

const learnerName = async (session: AuthenticatedSession, learnerId: string) => {
  const [row] = await withTenant(session.organisationId, (tx) => tx.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, learnerId)));
  return row ? `${row.firstName} ${row.lastName ?? ""}`.trim() : "the learner";
};

/** A practical observation checklist, signed (D52 (8)). */
export async function recordObservationChecklist(
  session: AuthenticatedSession,
  input: { learnerId: string; logbookId?: string | null; title: string; observedOn: string; items: { label: string; observed: boolean; comment?: string }[] },
): Promise<string> {
  const items = input.items.filter((item) => item.label.trim());
  if (items.length === 0) throw new CoachError("The checklist has nothing on it.", "invalid");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.observedOn)) throw new CoachError("Give the date you observed.", "invalid");
  const name = await learnerName(session, input.learnerId);
  return writeRecord(
    session,
    input.learnerId,
    { kind: "observation_checklist", logbookId: input.logbookId ?? null, title: input.title.trim() || "Practical observation", details: { items }, observedOn: input.observedOn, body: "" },
    { subject: `Observation checklist signed for ${name}`, body: `${items.filter((item) => item.observed).length} of ${items.length} items observed.` },
  );
}

/** A witness testimony, signed by the coach (D52 (8)). */
export async function recordWitnessTestimony(
  session: AuthenticatedSession,
  input: { learnerId: string; logbookId?: string | null; witnessName: string; witnessRole: string; observedOn: string; statement: string },
): Promise<string> {
  if (input.witnessName.trim().length < 2) throw new CoachError("Give the witness's name.", "invalid");
  if (input.statement.trim().length < 10) throw new CoachError("Write what the witness saw.", "invalid");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.observedOn)) throw new CoachError("Give the date it was witnessed.", "invalid");
  const name = await learnerName(session, input.learnerId);
  return writeRecord(
    session,
    input.learnerId,
    {
      kind: "witness_testimony",
      logbookId: input.logbookId ?? null,
      title: `Witness testimony: ${input.witnessName.trim()}`,
      witnessName: input.witnessName.trim(),
      witnessRole: input.witnessRole.trim() || null,
      observedOn: input.observedOn,
      body: input.statement.trim(),
    },
    { subject: `Witness testimony recorded for ${name}`, body: input.statement.trim().slice(0, 300) },
  );
}

/** Structured feedback on workplace readiness (D52 (9)). */
export async function recordReadiness(
  session: AuthenticatedSession,
  input: { learnerId: string; ratings: Partial<Record<ReadinessDimension, number>>; recommendation: string; comments: string },
): Promise<string> {
  const ratings: Record<string, number> = {};
  for (const dimension of READINESS_DIMENSIONS) {
    const value = Number(input.ratings[dimension]);
    if (!(value >= 1 && value <= 4)) throw new CoachError("Rate every item from 1 to 4.", "invalid");
    ratings[dimension] = value;
  }
  if (!RECOMMENDATIONS.includes(input.recommendation as never)) throw new CoachError("Choose your overall view.", "invalid");
  const name = await learnerName(session, input.learnerId);
  return writeRecord(
    session,
    input.learnerId,
    { kind: "readiness_feedback", title: "Workplace readiness", details: { ratings, recommendation: input.recommendation }, body: input.comments.trim() },
    { subject: `Workplace readiness feedback for ${name}`, body: input.comments.trim().slice(0, 300) || "Feedback recorded." },
  );
}

/** A message to the learner's facilitators and assessors (D52 (10)). */
export async function messageStaff(session: AuthenticatedSession, input: { learnerId: string; body: string }): Promise<number> {
  const body = input.body.trim();
  if (body.length < 3) throw new CoachError("Write the message.", "invalid");
  const name = await learnerName(session, input.learnerId);
  const recipients = await withTenant(session.organisationId, (tx) => learnerStaff(tx, input.learnerId));
  if (recipients.length === 0) throw new CoachError("Nobody is named yet as this learner's facilitator or assessor. Ask the provider.", "invalid");
  await writeRecord(session, input.learnerId, { kind: "message", title: "Message to the facilitator and assessor", details: { recipients }, body }, {
    subject: `From ${session.firstName} ${session.lastName}, workplace coach of ${name}`,
    body,
  });
  return recipients.length;
}
