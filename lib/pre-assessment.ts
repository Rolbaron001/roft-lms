import { and, eq } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import { courses, enrolments, preAssessmentChecklists, preAssessmentConfirmations } from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * The pre-assessment checklist and declaration, completed by a learner before
 * each study unit opens (job sheet D32, 19 October 2026).
 *
 * The provider sets the wording and switches it on in Settings. While it is on,
 * a study unit's steps stay closed to a learner until they have ticked every
 * item and agreed to the declaration for that unit (lib/spine.ts). What they
 * confirmed is kept word for word with the date.
 */

export class PreAssessmentError extends Error {
  constructor(
    message: string,
    public readonly code: "not_permitted" | "invalid" | "not_found",
  ) {
    super(message);
    this.name = "PreAssessmentError";
  }
}

export type ChecklistItem = { title: string; detail: string };

export type Checklist = {
  enabled: boolean;
  introduction: string;
  items: ChecklistItem[];
  declaration: string;
};

/**
 * The starting wording: the checklist Cecelia drew up for Curiosa from the
 * SETA and QCTO assessment guidelines, 19 October 2026. A provider changes it
 * in Settings.
 */
export const DEFAULT_CHECKLIST: Checklist = {
  enabled: false,
  introduction:
    "Before you begin this study unit, your facilitator must make sure you understand how you will be assessed. The SETA and QCTO assessment guidelines require that every learner is told about the assessment process, their rights and their responsibilities before learning and assessment begin. Read each statement and tick it once you understand it. If anything is unclear, ask your facilitator before you continue.",
  items: [
    { title: "I know what I will be assessed on", detail: "The study unit's outcomes, its knowledge and practical requirements, and the assessment methods that will be used." },
    { title: "I know the assessment dates and format", detail: "When, where and how (online or in person) each assessment will take place." },
    { title: "I understand the assessment criteria", detail: "Assessment is competency-based: the result is Competent or Not Yet Competent, not a mark." },
    { title: "I know what evidence I must submit", detail: "This includes my Portfolio of Evidence and any workplace or practical evidence required." },
    { title: "My work must be my own", detail: "I understand the rules on authenticity and plagiarism, and the consequences of dishonest practice." },
    { title: "I know how I will be assessed fairly", detail: "The assessment must be valid, reliable, fair and transparent for all learners." },
    { title: "I know I can ask for reasonable accommodation", detail: "If I have a special need, I may ask for support before the assessment." },
    { title: "I know the re-assessment process", detail: "If I am Not Yet Competent, I understand I may be given feedback and another opportunity." },
    { title: "I know how to lodge an appeal", detail: "I understand the appeals procedure and who to contact if I disagree with an outcome." },
    { title: "I have the resources and identification I need", detail: "A device, internet access, my learner material, and a valid ID or learner number." },
  ],
  declaration:
    "I confirm that I have read and understood this pre-assessment notification. The assessment process, my rights and my responsibilities have been explained to me, I have had the opportunity to ask questions, and I am ready to proceed with the study unit.",
};

async function read(tx: TenantDatabase): Promise<Checklist> {
  const [row] = await tx.select().from(preAssessmentChecklists).limit(1);
  return row
    ? { enabled: row.enabled, introduction: row.introduction, items: row.items, declaration: row.declaration }
    : DEFAULT_CHECKLIST;
}

/** The provider's checklist, or the starting wording where none is saved. */
export async function providerChecklist(session: AuthenticatedSession): Promise<Checklist> {
  return withTenant(session.organisationId, read);
}

export async function saveChecklist(session: AuthenticatedSession, input: Checklist): Promise<void> {
  assertSessionCan(session, "tenant:manage_settings");
  const items = input.items
    .map((item) => ({ title: item.title.trim(), detail: item.detail.trim() }))
    .filter((item) => item.title !== "");
  if (input.enabled && items.length === 0) {
    throw new PreAssessmentError("Add at least one statement before switching the checklist on.", "invalid");
  }
  if (input.declaration.trim().length < 10) {
    throw new PreAssessmentError("Write the declaration the learner agrees to.", "invalid");
  }

  await withTenant(session.organisationId, async (tx) => {
    const values = {
      enabled: input.enabled,
      introduction: input.introduction.trim(),
      items,
      declaration: input.declaration.trim(),
      updatedById: session.userId,
      updatedAt: new Date(),
    };
    await tx
      .insert(preAssessmentChecklists)
      .values({ organisationId: session.organisationId, ...values })
      .onConflictDoUpdate({ target: preAssessmentChecklists.organisationId, set: values });
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "pre_assessment.checklist_saved",
      entityType: "organisation",
      entityId: session.organisationId,
      after: { enabled: input.enabled, items: items.length },
    });
  });
}

/**
 * Whether this learner still owes the checklist on this course: the provider
 * has it on, the course is a study unit, and they have not confirmed it.
 */
export async function checklistOwed(tx: TenantDatabase, courseId: string, userId: string): Promise<boolean> {
  const [course] = await tx.select({ studyUnitId: courses.studyUnitId }).from(courses).where(eq(courses.id, courseId));
  if (!course?.studyUnitId) return false;
  const checklist = await read(tx);
  if (!checklist.enabled) return false;
  const [done] = await tx
    .select({ id: preAssessmentConfirmations.id })
    .from(preAssessmentConfirmations)
    .where(and(eq(preAssessmentConfirmations.courseId, courseId), eq(preAssessmentConfirmations.userId, userId)));
  return !done;
}

export type UnitChecklist = {
  checklist: Checklist;
  owed: boolean;
  confirmedAt: Date | null;
};

/** What a study unit's page shows about the checklist, for this learner. */
export async function unitChecklist(session: AuthenticatedSession, courseId: string, userId = session.userId): Promise<UnitChecklist | null> {
  return withTenant(session.organisationId, async (tx) => {
    const [course] = await tx.select({ studyUnitId: courses.studyUnitId }).from(courses).where(eq(courses.id, courseId));
    if (!course?.studyUnitId) return null;
    const checklist = await read(tx);
    if (!checklist.enabled) return null;
    const [done] = await tx
      .select({ confirmedAt: preAssessmentConfirmations.confirmedAt })
      .from(preAssessmentConfirmations)
      .where(and(eq(preAssessmentConfirmations.courseId, courseId), eq(preAssessmentConfirmations.userId, userId)));
    return { checklist, owed: !done, confirmedAt: done?.confirmedAt ?? null };
  });
}

/**
 * A learner confirms the checklist for one study unit. Every statement must be
 * ticked and the declaration agreed; the wording confirmed is kept.
 */
export async function confirmChecklist(
  session: AuthenticatedSession,
  input: { courseId: string; ticked: number; declarationAccepted: boolean; ipAddress?: string | null },
): Promise<void> {
  await withTenant(session.organisationId, async (tx) => {
    const checklist = await read(tx);
    if (!checklist.enabled) return;

    const [enrolled] = await tx
      .select({ id: enrolments.id })
      .from(enrolments)
      .where(and(eq(enrolments.userId, session.userId), eq(enrolments.courseId, input.courseId)))
      .limit(1);
    if (!enrolled) throw new PreAssessmentError("You are not on that study unit.", "not_permitted");

    if (input.ticked < checklist.items.length) {
      throw new PreAssessmentError("Tick every statement first. Ask your facilitator about anything that is unclear.", "invalid");
    }
    if (!input.declarationAccepted) {
      throw new PreAssessmentError("Agree to the declaration to continue.", "invalid");
    }

    await tx
      .insert(preAssessmentConfirmations)
      .values({
        organisationId: session.organisationId,
        userId: session.userId,
        courseId: input.courseId,
        items: checklist.items,
        declaration: checklist.declaration,
        ipAddress: input.ipAddress ?? null,
      })
      .onConflictDoNothing();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "pre_assessment.confirmed",
      entityType: "course",
      entityId: input.courseId,
      after: { items: checklist.items.length, declaration: checklist.declaration },
      ipAddress: input.ipAddress ?? null,
    });
  });
}
