/**
 * Moderation Reports, and the lock that signing one puts on what it covers.
 *
 * Heidi's role specifications (job sheet D52 (4) and (5), 17 November 2026):
 * a moderator will "complete and sign off on digital Moderation Reports
 * within the system" and "lock moderated records to prepare them for external
 * verification".
 *
 * A report is for a cohort or a qualification. Its figures are the platform's,
 * drafted from the decisions and moderation within that scope; its findings
 * and recommendations are the moderator's. Signing records the moderator, their
 * registration number, the time and a fingerprint of what was signed, and
 * snapshots every moderated decision in scope. Those decisions are then
 * locked: no assessor may decide the submission again and no moderator may
 * moderate it again, so what an external verifier is shown cannot move.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import { assessmentDecisions, cohorts, moderationReportDecisions, moderationReports, programmeStaff, qualifications, users } from "@/db/schema";
import { recordAudit } from "./audit";
import { decisionsToModerate, type DecisionRow } from "./moderation-sample";
import { inReach, reachWithin } from "./staff-scope";
import { assertSessionCan, type AuthenticatedSession } from "./session";

export class ModerationReportError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "not_permitted" | "invalid" | "locked",
  ) {
    super(message);
    this.name = "ModerationReportError";
  }
}

export type ReportFigures = {
  decisions: number;
  sampled: number;
  moderated: number;
  endorsed: number;
  referredBack: number;
  overridden: number;
  byAssessor: { assessor: string; decisions: number; moderated: number; endorsed: number; referredBack: number; overridden: number }[];
};

/** The figures for a set of decisions: how many, how many sampled and moderated, and with what outcome. */
export function figuresOf(rows: DecisionRow[]): ReportFigures {
  const count = (list: DecisionRow[], outcome: string) => list.filter((row) => row.moderated === outcome).length;
  const assessors = [...new Set(rows.map((row) => row.assessor))].sort();
  return {
    decisions: rows.length,
    sampled: rows.filter((row) => row.sampled).length,
    moderated: rows.filter((row) => row.moderated).length,
    endorsed: count(rows, "endorsed"),
    referredBack: count(rows, "referred_back"),
    overridden: count(rows, "overridden"),
    byAssessor: assessors.map((name) => {
      const theirs = rows.filter((row) => row.assessor === name);
      return {
        assessor: name,
        decisions: theirs.length,
        moderated: theirs.filter((row) => row.moderated).length,
        endorsed: count(theirs, "endorsed"),
        referredBack: count(theirs, "referred_back"),
        overridden: count(theirs, "overridden"),
      };
    }),
  };
}

/** Whether a submission's decisions are locked by a signed Moderation Report. */
export async function lockedForVerification(tx: TenantDatabase, submissionId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: moderationReportDecisions.id })
    .from(moderationReportDecisions)
    .innerJoin(moderationReports, eq(moderationReports.id, moderationReportDecisions.reportId))
    .innerJoin(assessmentDecisions, eq(assessmentDecisions.id, moderationReportDecisions.decisionId))
    .where(and(eq(assessmentDecisions.submissionId, submissionId), isNotNull(moderationReports.signedAt)))
    .limit(1);
  return Boolean(row);
}

export const LOCKED_MESSAGE =
  "This work is locked for external verification: a signed Moderation Report covers it, so its decision and moderation can no longer change.";

const scopeOf = (report: { cohortId: string | null; qualificationId: string | null }) =>
  report.cohortId ? { cohortId: report.cohortId } : { qualificationId: report.qualificationId ?? undefined };

/** What a moderator may report on: the qualifications and cohorts within their reach as moderator. */
export async function reportScopes(session: AuthenticatedSession): Promise<{ value: string; label: string }[]> {
  assertSessionCan(session, "assessment:moderate");
  return withTenant(session.organisationId, async (tx) => {
    const reach = await reachWithin(tx, session, "moderator");
    const quals = await tx.select({ id: qualifications.id, title: qualifications.title }).from(qualifications).orderBy(qualifications.title);
    const cohortRows = await tx.select({ id: cohorts.id, name: cohorts.name }).from(cohorts).orderBy(desc(cohorts.startDate));
    return [
      ...quals.filter((one) => inReach(reach, { qualificationId: one.id })).map((one) => ({ value: `qualification:${one.id}`, label: one.title })),
      ...cohortRows.filter((one) => inReach(reach, { cohortId: one.id })).map((one) => ({ value: `cohort:${one.id}`, label: one.name })),
    ];
  });
}

export async function createReport(session: AuthenticatedSession, scope: { cohortId?: string; qualificationId?: string }): Promise<string> {
  assertSessionCan(session, "assessment:moderate");
  if (!scope.cohortId === !scope.qualificationId) throw new ModerationReportError("Choose a cohort or a qualification.", "invalid");
  return withTenant(session.organisationId, async (tx) => {
    if (!inReach(await reachWithin(tx, session, "moderator"), scope)) {
      throw new ModerationReportError("This is not one of the programmes you moderate.", "not_permitted");
    }
    const [named] = scope.cohortId
      ? await tx.select({ name: cohorts.name }).from(cohorts).where(eq(cohorts.id, scope.cohortId))
      : await tx.select({ name: qualifications.title }).from(qualifications).where(eq(qualifications.id, scope.qualificationId!));
    if (!named) throw new ModerationReportError("No such cohort or qualification.", "not_found");
    const [made] = await tx
      .insert(moderationReports)
      .values({
        organisationId: session.organisationId,
        cohortId: scope.cohortId ?? null,
        qualificationId: scope.qualificationId ?? null,
        moderatorId: session.userId,
        title: `Moderation Report: ${named.name}`,
      })
      .returning({ id: moderationReports.id });
    return made.id;
  });
}

async function loadReport(tx: TenantDatabase, id: string) {
  const [report] = await tx.select().from(moderationReports).where(eq(moderationReports.id, id));
  if (!report) throw new ModerationReportError("No such report.", "not_found");
  return report;
}

export async function saveReport(session: AuthenticatedSession, id: string, input: { findings: string; recommendations: string }): Promise<void> {
  assertSessionCan(session, "assessment:moderate");
  await withTenant(session.organisationId, async (tx) => {
    const report = await loadReport(tx, id);
    if (report.moderatorId !== session.userId) throw new ModerationReportError("Only the moderator writing this report can change it.", "not_permitted");
    if (report.signedAt) throw new ModerationReportError("This report is signed and can no longer change.", "locked");
    await tx
      .update(moderationReports)
      .set({ findings: input.findings.trim().slice(0, 20000), recommendations: input.recommendations.trim().slice(0, 20000), updatedAt: new Date() })
      .where(eq(moderationReports.id, id));
  });
}

/** The registration number this moderator holds on the programme, where one is recorded. */
async function registrationOf(tx: TenantDatabase, userId: string, qualificationId: string | null): Promise<string | null> {
  const rows = await tx
    .select({ number: programmeStaff.registrationNumber, qualificationId: programmeStaff.qualificationId })
    .from(programmeStaff)
    .where(and(eq(programmeStaff.userId, userId), eq(programmeStaff.capacity, "moderator"), isNotNull(programmeStaff.registrationNumber)));
  return (rows.find((row) => row.qualificationId === qualificationId) ?? rows[0])?.number ?? null;
}

export async function signReport(
  session: AuthenticatedSession,
  id: string,
  input: { registrationNumber?: string },
): Promise<{ locked: number }> {
  assertSessionCan(session, "assessment:moderate");
  const report = await withTenant(session.organisationId, (tx) => loadReport(tx, id));
  if (report.moderatorId !== session.userId) throw new ModerationReportError("Only the moderator writing this report can sign it.", "not_permitted");
  if (report.signedAt) throw new ModerationReportError("This report is already signed.", "locked");
  if (report.findings.trim().length < 10) throw new ModerationReportError("Write the findings before signing.", "invalid");

  // The decisions in scope, read with the signer's own reach, as the draft showed them.
  const rows = await decisionsToModerate(session, scopeOf(report));
  const figures = figuresOf(rows);
  const moderated = rows.filter((row) => row.moderated);
  if (moderated.length === 0) throw new ModerationReportError("Nothing in this report's scope has been moderated yet, so there is nothing to sign off.", "invalid");

  return withTenant(session.organisationId, async (tx) => {
    const registration = input.registrationNumber?.trim() || (await registrationOf(tx, session.userId, report.qualificationId));
    const signedAt = new Date();
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ id, findings: report.findings, recommendations: report.recommendations, figures, decisions: moderated.map((row) => row.decisionId).sort(), signer: session.userId, signedAt }))
      .digest("hex");
    await tx
      .update(moderationReports)
      .set({ summary: figures, moderatorRegistrationNumber: registration, signedAt, signatureHash: fingerprint, updatedAt: signedAt })
      .where(and(eq(moderationReports.id, id), sql`${moderationReports.signedAt} is null`));
    await tx
      .insert(moderationReportDecisions)
      .values(moderated.map((row) => ({ organisationId: session.organisationId, reportId: id, decisionId: row.decisionId })))
      .onConflictDoNothing();
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "moderation.report_signed",
      entityType: "moderation_report",
      entityId: id,
      after: { locked: moderated.length, figures, signatureHash: fingerprint },
    });
    return { locked: moderated.length };
  });
}

/** May this person read signed reports across the provider: an external verifier or a Quality Assurer. */
const readsSigned = (session: AuthenticatedSession) =>
  session.permissions.includes("verification:external_audit") || session.permissions.includes("records:read");

export type ReportListing = { id: string; title: string; moderator: string; signedAt: Date | null; locked: number; updatedAt: Date };

export async function listReports(session: AuthenticatedSession): Promise<ReportListing[]> {
  const moderates = session.permissions.includes("assessment:moderate");
  if (!moderates && !readsSigned(session)) return [];
  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({
        id: moderationReports.id,
        title: moderationReports.title,
        moderatorId: moderationReports.moderatorId,
        cohortId: moderationReports.cohortId,
        qualificationId: moderationReports.qualificationId,
        signedAt: moderationReports.signedAt,
        updatedAt: moderationReports.updatedAt,
        firstName: users.firstName,
        lastName: users.lastName,
        locked: sql<number>`(select count(*)::int from moderation_report_decisions d where d.report_id = ${moderationReports.id})`,
      })
      .from(moderationReports)
      .innerJoin(users, eq(users.id, moderationReports.moderatorId))
      .orderBy(desc(moderationReports.updatedAt));
    const reach = moderates ? await reachWithin(tx, session, "moderator") : null;
    return rows
      .filter((row) => (row.signedAt && readsSigned(session)) || row.moderatorId === session.userId || (row.signedAt && reach && inReach(reach, scopeOf(row))))
      .map((row) => ({
        id: row.id,
        title: row.title,
        moderator: `${row.firstName} ${row.lastName ?? ""}`.trim(),
        signedAt: row.signedAt,
        locked: row.locked,
        updatedAt: row.updatedAt,
      }));
  });
}

export type ReportDetail = {
  id: string;
  title: string;
  moderator: string;
  mine: boolean;
  findings: string;
  recommendations: string;
  figures: ReportFigures;
  signedAt: Date | null;
  registrationNumber: string | null;
  signatureHash: string | null;
  lockedDecisions: DecisionRow[];
};

export async function getReport(session: AuthenticatedSession, id: string): Promise<ReportDetail | null> {
  const listed = (await listReports(session)).some((row) => row.id === id);
  if (!listed) return null;
  const report = await withTenant(session.organisationId, (tx) => loadReport(tx, id));
  const [author] = await withTenant(session.organisationId, (tx) =>
    tx.select({ firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, report.moderatorId)),
  );
  let figures: ReportFigures;
  let lockedDecisions: DecisionRow[] = [];
  if (report.signedAt) {
    figures = report.summary as ReportFigures;
    const ids = (
      await withTenant(session.organisationId, (tx) =>
        tx.select({ decisionId: moderationReportDecisions.decisionId }).from(moderationReportDecisions).where(eq(moderationReportDecisions.reportId, id)),
      )
    ).map((row) => row.decisionId);
    if (session.permissions.includes("assessment:moderate") && ids.length) {
      lockedDecisions = (await decisionsToModerate(session, scopeOf(report))).filter((row) => ids.includes(row.decisionId));
    }
  } else {
    figures = figuresOf(await decisionsToModerate(session, scopeOf(report)));
  }
  return {
    id,
    title: report.title,
    moderator: author ? `${author.firstName} ${author.lastName ?? ""}`.trim() : "",
    mine: report.moderatorId === session.userId,
    findings: report.findings,
    recommendations: report.recommendations,
    figures,
    signedAt: report.signedAt,
    registrationNumber: report.moderatorRegistrationNumber,
    signatureHash: report.signatureHash,
    lockedDecisions,
  };
}

/** For the decision and moderation writes in lib/assessment.ts. */
export async function assertNotLocked(tx: TenantDatabase, submissionId: string, fail: (message: string) => Error): Promise<void> {
  if (await lockedForVerification(tx, submissionId)) throw fail(LOCKED_MESSAGE);
}
