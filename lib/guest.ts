/**
 * What a Guest (a QCTO or QP verifier) may see (Heidi, 13 November 2026; job
 * sheet D51): "Browse designated 'open' or demo courses and view module
 * outlines. Preview multimedia content, SCORM packages, and sample quizzes
 * (without saving scores to the database). Restricted from viewing any
 * personal learner data, grades, discussion boards, or administrative
 * dashboards."
 *
 * An administrator opens a qualification to guests. A Guest then previews it
 * through the same learner's-eye pages staff use to check it, with the staff
 * links left out and every paper shown as the learner sees it, answers
 * hidden. Nothing a Guest does is recorded: the preview records nothing for
 * anybody.
 */
import { and, asc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { assessmentPapers, assessments, courses, qualifications, studyUnits, users } from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/** Whether this person sees the platform as a Guest: the preview and nothing to build. */
export function isGuest(session: AuthenticatedSession): boolean {
  return session.permissions.includes("guest:preview") && !session.permissions.includes("course:author");
}

/** The qualifications opened to guests, for a Guest's home page. */
export async function qualificationsOpenToGuests(session: AuthenticatedSession) {
  assertSessionCan(session, "guest:preview");
  return withTenant(session.organisationId, (tx) =>
    tx
      .select({ id: qualifications.id, title: qualifications.title, saqaId: qualifications.saqaId, nqfLevel: qualifications.nqfLevel })
      .from(qualifications)
      .where(eq(qualifications.openToGuests, true))
      .orderBy(asc(qualifications.title)),
  );
}

/** When this person's own access ends, or null, for their home page. */
export async function accessEndsFor(session: AuthenticatedSession): Promise<Date | null> {
  const [row] = await withTenant(
    session.organisationId,
    (tx) => tx.select({ endsAt: users.accessEndsAt }).from(users).where(eq(users.id, session.userId)),
    { ownSitting: true },
  );
  return row?.endsAt ?? null;
}

/** Whether a Guest may preview this qualification. */
export async function guestMayOpenQualification(session: AuthenticatedSession, qualificationId: string): Promise<boolean> {
  if (!session.permissions.includes("guest:preview")) return false;
  const [row] = await withTenant(session.organisationId, (tx) =>
    tx.select({ open: qualifications.openToGuests }).from(qualifications).where(eq(qualifications.id, qualificationId)),
  );
  return row?.open === true;
}

/** Whether a Guest may preview this paper: it belongs to a qualification opened to guests. */
export async function guestMayOpenPaper(session: AuthenticatedSession, paperId: string): Promise<boolean> {
  if (!session.permissions.includes("guest:preview")) return false;
  const [row] = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ open: qualifications.openToGuests })
      .from(assessmentPapers)
      .innerJoin(assessments, eq(assessments.id, assessmentPapers.assessmentId))
      .innerJoin(courses, eq(courses.id, assessments.courseId))
      .innerJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
      .innerJoin(qualifications, eq(qualifications.id, studyUnits.qualificationId))
      .where(and(eq(assessmentPapers.id, paperId), eq(qualifications.openToGuests, true))),
  );
  return row?.open === true;
}

/**
 * The paper reader's permission, for one read a Guest has already been
 * cleared for by guestMayOpenPaper. Never stored or passed on: the session
 * the Guest holds is unchanged.
 */
export function asPaperReader(session: AuthenticatedSession): AuthenticatedSession {
  return { ...session, permissions: [...session.permissions, "assessment:author"] };
}

/** Opens a qualification to guests, or closes it (an administrator, D51). */
export async function setOpenToGuests(session: AuthenticatedSession, qualificationId: string, open: boolean): Promise<void> {
  assertSessionCan(session, "qualification:manage");
  await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .update(qualifications)
      .set({ openToGuests: open, updatedAt: new Date() })
      .where(eq(qualifications.id, qualificationId))
      .returning({ id: qualifications.id });
    if (!row) return;
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: open ? "qualification.opened_to_guests" : "qualification.closed_to_guests",
      entityType: "qualification",
      entityId: qualificationId,
    });
  });
}
