import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  assessmentDecisions,
  assessmentSubmissions,
  assessments,
  courseStepPrerequisites,
  courseSteps,
  courses,
  curriculumModules,
  lessons,
  moderationRecords,
  programmeDocuments,
  progressRecords,
  enrolments,
  stepOverrides,
  stepProgress,
  users,
  workplaceLogbooks,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { can } from "./rbac";

/**
 * The spine, and the gates on it.
 *
 * A course is one ordered list of steps. A step opens when its gate is
 * satisfied and not before, and this file is the only place that decides.
 *
 * Two rules run through it:
 *
 *   1. **Guards refuse, they do not warn.** Hiding a locked step in the
 *      interface is presentation, not protection. `assertStepOpen` is called
 *      by every action that touches a step — open it, save a draft, submit,
 *      attach evidence — and refuses with a named reason. Someone who guesses
 *      the URL gets the same answer as someone who clicks.
 *
 *   2. **Developmental work is not a measurement of competence.** A workbook
 *      prepares a learner for the summative; it does not judge them. So a
 *      prerequisite of `competent` naming a formative assessment is refused
 *      when it is written, not silently treated as never satisfied — which is
 *      what a gate that can never open looks like from the outside.
 */

export class SpineError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "not_permitted"
      | "locked"
      | "invalid",
  ) {
    super(message);
    this.name = "SpineError";
  }
}

export type PrerequisiteRule =
  | "opened"
  | "submitted"
  | "reviewed"
  | "competent"
  | "signed_off";

export type StepKind = "lesson" | "assessment" | "document" | "workplace";

/** How far a learner has got with one step, regardless of what kind it is. */
export type StepProgress = {
  opened: boolean;
  submitted: boolean;
  reviewed: boolean;
  competent: boolean;
  signedOff: boolean;
};

export type StepView = {
  id: string;
  kind: StepKind;
  title: string;
  guidance: string | null;
  optional: boolean;
  sortOrder: number;
  targetId: string;
  /** True when this step's own gate is satisfied for this learner. */
  open: boolean;
  /** Why it is not, in words a learner can act on. Empty when open. */
  blockedBy: string[];
  /** Set when a person granted an exception rather than the gate opening. */
  overrideReason: string | null;
  progress: StepProgress;
  /** Where the learner is: done, in progress, or not started. */
  state: "not_started" | "in_progress" | "done";
};

const RULE_WORDING: Record<PrerequisiteRule, string> = {
  opened: "opened",
  submitted: "handed in",
  reviewed: "marked and returned",
  competent: "judged competent",
  signed_off: "signed off",
};

/**
 * The rules that can only ever be satisfied by a summative assessment or a
 * logbook. Naming one of these against a formative step produces a gate that
 * never opens, so it is refused at authoring time.
 */
const COMPETENCE_RULES: PrerequisiteRule[] = ["competent"];

// ---------------------------------------------------------------------------
// Reading the spine
// ---------------------------------------------------------------------------

type StepRow = typeof courseSteps.$inferSelect;

async function loadSteps(
  tx: TenantDatabase,
  courseId: string,
): Promise<StepRow[]> {
  return tx
    .select()
    .from(courseSteps)
    .where(eq(courseSteps.courseId, courseId))
    .orderBy(asc(courseSteps.sortOrder), asc(courseSteps.createdAt));
}

/**
 * What a learner has actually done, for every step of a course at once.
 *
 * Deliberately one pass rather than a query per step: a study unit has ten or
 * twenty steps and a facilitator's blocked-learners screen asks this for a
 * whole cohort.
 */
async function loadProgress(
  tx: TenantDatabase,
  steps: StepRow[],
  userId: string,
): Promise<Map<string, StepProgress>> {
  const blank = (): StepProgress => ({
    opened: false,
    submitted: false,
    reviewed: false,
    competent: false,
    signedOff: false,
  });

  const progress = new Map<string, StepProgress>(
    steps.map((step) => [step.id, blank()]),
  );

  // Opening is recorded uniformly, so a document step — which has no lesson
  // record and no submission to look at — can satisfy an `opened` gate like
  // anything else.
  const opens = await tx
    .select({ stepId: stepProgress.stepId })
    .from(stepProgress)
    .where(
      and(
        eq(stepProgress.userId, userId),
        inArray(
          stepProgress.stepId,
          steps.map((step) => step.id),
        ),
      ),
    );
  for (const open of opens) {
    const entry = progress.get(open.stepId);
    if (entry) entry.opened = true;
  }

  // --- lessons and documents: opened, and completed --------------------------
  const lessonIds = steps
    .filter((step) => step.kind === "lesson" && step.lessonId)
    .map((step) => step.lessonId!);

  if (lessonIds.length > 0) {
    const records = await tx
      .select({
        lessonId: progressRecords.lessonId,
        state: progressRecords.state,
      })
      .from(progressRecords)
      .innerJoin(enrolments, eq(enrolments.id, progressRecords.enrolmentId))
      .where(
        and(
          eq(enrolments.userId, userId),
          inArray(progressRecords.lessonId, lessonIds),
        ),
      );

    const byLesson = new Map(records.map((r) => [r.lessonId, r.state]));
    for (const step of steps) {
      if (step.kind !== "lesson" || !step.lessonId) continue;
      const state = byLesson.get(step.lessonId);
      const entry = progress.get(step.id)!;
      entry.opened = entry.opened || state !== undefined;
      // A lesson is "handed in" when it is finished. There is nothing to mark,
      // so finishing it also counts as reviewed — otherwise a `reviewed` gate
      // on a reading step could never open.
      entry.submitted = state === "completed";
      entry.reviewed = state === "completed";
    }
  }

  // A document is read, not handed in. Opening it is all there is to do, so
  // opening it is also the most a gate on it can ask for.
  for (const step of steps) {
    if (step.kind !== "document") continue;
    const entry = progress.get(step.id)!;
    entry.submitted = entry.opened;
    entry.reviewed = entry.opened;
  }

  // --- assessments: submitted, marked, and judged ----------------------------
  const assessmentIds = steps
    .filter((step) => step.kind === "assessment" && step.assessmentId)
    .map((step) => step.assessmentId!);

  if (assessmentIds.length > 0) {
    const rows = await tx
      .select({
        assessmentId: assessmentSubmissions.assessmentId,
        status: assessmentSubmissions.status,
        attemptNumber: assessmentSubmissions.attemptNumber,
        decisionOutcome: assessmentDecisions.outcome,
        moderationOutcome: moderationRecords.outcome,
        revisedOutcome: moderationRecords.revisedOutcome,
      })
      .from(assessmentSubmissions)
      .leftJoin(
        assessmentDecisions,
        eq(assessmentDecisions.submissionId, assessmentSubmissions.id),
      )
      .leftJoin(
        moderationRecords,
        eq(moderationRecords.decisionId, assessmentDecisions.id),
      )
      .where(
        and(
          eq(assessmentSubmissions.userId, userId),
          inArray(assessmentSubmissions.assessmentId, assessmentIds),
        ),
      )
      .orderBy(desc(assessmentSubmissions.attemptNumber));

    for (const step of steps) {
      if (step.kind !== "assessment" || !step.assessmentId) continue;
      const attempts = rows.filter((r) => r.assessmentId === step.assessmentId);
      if (attempts.length === 0) continue;

      const entry = progress.get(step.id)!;
      entry.opened = true;
      entry.submitted = attempts.some((a) => a.status !== "draft");
      entry.reviewed = attempts.some((a) => a.decisionOutcome !== null);

      // Competence is the *best* result across attempts, not the latest: a
      // learner judged competent on attempt one does not become not-competent
      // by sitting it again. A moderator's override replaces the assessor's
      // decision where there is one.
      entry.competent = attempts.some((attempt) => {
        const outcome =
          attempt.moderationOutcome === "overridden" && attempt.revisedOutcome
            ? attempt.revisedOutcome
            : attempt.decisionOutcome;
        // Only a settled decision counts. "assessed" is waiting for a
        // moderator and "referred_back" was sent back to the assessor;
        // neither is a result anybody may rely on yet.
        return (
          outcome === "competent" &&
          (attempt.status === "finalised" || attempt.status === "moderated")
        );
      });
    }
  }

  // --- workplace modules: the logbook ---------------------------------------
  const moduleIds = steps
    .filter((step) => step.kind === "workplace" && step.curriculumModuleId)
    .map((step) => step.curriculumModuleId!);

  if (moduleIds.length > 0) {
    const books = await tx
      .select({
        curriculumModuleId: workplaceLogbooks.curriculumModuleId,
        status: workplaceLogbooks.status,
      })
      .from(workplaceLogbooks)
      .where(
        and(
          eq(workplaceLogbooks.learnerId, userId),
          inArray(workplaceLogbooks.curriculumModuleId, moduleIds),
        ),
      );

    const byModule = new Map(books.map((b) => [b.curriculumModuleId, b.status]));
    for (const step of steps) {
      if (step.kind !== "workplace" || !step.curriculumModuleId) continue;
      const status = byModule.get(step.curriculumModuleId);
      if (!status) continue;
      const entry = progress.get(step.id)!;
      entry.opened = true;
      entry.submitted = status !== "draft";
      entry.reviewed = status === "coach_signed" || status === "accepted_by_assessor";
      entry.signedOff = status === "accepted_by_assessor";
      // A work experience module carries no assessment criteria. An accepted
      // logbook is what stands in their place, so it satisfies `competent`
      // too — otherwise a study unit could never be finished on one.
      entry.competent = status === "accepted_by_assessor";
    }
  }

  return progress;
}

function satisfies(progress: StepProgress, rule: PrerequisiteRule): boolean {
  switch (rule) {
    case "opened":
      return progress.opened;
    case "submitted":
      return progress.submitted;
    case "reviewed":
      return progress.reviewed;
    case "competent":
      return progress.competent;
    case "signed_off":
      return progress.signedOff;
  }
}

/**
 * The whole spine for one learner: every step, whether it is open, and if not
 * exactly what it is waiting for.
 */
export async function stepsForLearner(
  session: AuthenticatedSession,
  courseId: string,
  userId: string,
): Promise<StepView[]> {
  if (userId !== session.userId && !can(session, "enrolment:read_all")) {
    throw new SpineError(
      "That belongs to someone else.",
      "not_permitted",
    );
  }

  return withTenant(session.organisationId, (tx) =>
    computeSteps(tx, courseId, userId),
  );
}

async function computeSteps(
  tx: TenantDatabase,
  courseId: string,
  userId: string,
): Promise<StepView[]> {
  const steps = await loadSteps(tx, courseId);
  if (steps.length === 0) return [];

  const stepIds = steps.map((step) => step.id);

  const [prerequisites, overrides, progress, titles] = await Promise.all([
    tx
      .select()
      .from(courseStepPrerequisites)
      .where(inArray(courseStepPrerequisites.stepId, stepIds)),
    tx
      .select()
      .from(stepOverrides)
      .where(
        and(
          inArray(stepOverrides.stepId, stepIds),
          eq(stepOverrides.userId, userId),
          isNull(stepOverrides.revokedAt),
        ),
      ),
    loadProgress(tx, steps, userId),
    resolveTitles(tx, steps),
  ]);

  const byStep = new Map<string, typeof prerequisites>();
  for (const prerequisite of prerequisites) {
    const list = byStep.get(prerequisite.stepId) ?? [];
    list.push(prerequisite);
    byStep.set(prerequisite.stepId, list);
  }

  const overrideByStep = new Map(
    overrides.map((override) => [override.stepId, override.reason]),
  );
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const now = new Date();

  return steps.map((step, index) => {
    const own = progress.get(step.id)!;
    const override = overrideByStep.get(step.id) ?? null;
    const blockedBy: string[] = [];

    // `sequential` is written out as the prerequisite it stands for, so both
    // release modes go through one evaluation rather than two.
    const effective =
      step.release === "prerequisites"
        ? (byStep.get(step.id) ?? [])
        : step.release === "sequential" && index > 0
          ? [
              {
                requiredStepId: steps[index - 1].id,
                rule: step.sequentialRule,
                anyOfGroup: null as string | null,
              },
            ]
          : [];

    // Alternatives sharing a label satisfy the step if any one of them does;
    // everything else is ANDed.
    const groups = new Map<string, typeof effective>();
    for (const prerequisite of effective) {
      const key = prerequisite.anyOfGroup ?? `__${prerequisite.requiredStepId}_${prerequisite.rule}`;
      const list = groups.get(key) ?? [];
      list.push(prerequisite);
      groups.set(key, list);
    }

    for (const [, alternatives] of groups) {
      const met = alternatives.some((prerequisite) => {
        const required = progress.get(prerequisite.requiredStepId);
        return required
          ? satisfies(required, prerequisite.rule as PrerequisiteRule)
          : false;
      });

      if (!met) {
        const described = alternatives.map((prerequisite) => {
          const required = stepById.get(prerequisite.requiredStepId);
          const name = required
            ? (titles.get(required.id) ?? "an earlier step")
            : "an earlier step";
          return `${name} must be ${RULE_WORDING[prerequisite.rule as PrerequisiteRule]}`;
        });
        blockedBy.push(described.join(", or "));
      }
    }

    if (step.availableFrom && step.availableFrom > now) {
      blockedBy.push(
        `it opens on ${step.availableFrom.toLocaleDateString("en-ZA", { dateStyle: "long" })}`,
      );
    }
    if (step.availableUntil && step.availableUntil < now) {
      blockedBy.push(
        `it closed on ${step.availableUntil.toLocaleDateString("en-ZA", { dateStyle: "long" })}`,
      );
    }

    const open = blockedBy.length === 0 || override !== null;

    return {
      id: step.id,
      kind: step.kind as StepKind,
      title: titles.get(step.id) ?? "Untitled step",
      guidance: step.guidance,
      optional: step.optional === 1,
      sortOrder: step.sortOrder,
      targetId:
        step.lessonId ??
        step.assessmentId ??
        step.programmeDocumentId ??
        step.curriculumModuleId!,
      open,
      blockedBy: open && override ? [] : blockedBy,
      overrideReason: override,
      progress: own,
      state: own.reviewed
        ? "done"
        : own.opened
          ? "in_progress"
          : "not_started",
    };
  });
}

/** Titles come from the step, or from whatever it points at. */
async function resolveTitles(
  tx: TenantDatabase,
  steps: StepRow[],
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const need = steps.filter((step) => !step.title);

  const pick = async <T extends { id: string; title: string }>(
    rows: T[],
    match: (step: StepRow) => string | null,
  ) => {
    const byId = new Map(rows.map((row) => [row.id, row.title]));
    for (const step of need) {
      const key = match(step);
      if (key && byId.has(key)) titles.set(step.id, byId.get(key)!);
    }
  };

  const ids = (kind: StepKind, column: keyof StepRow) =>
    need
      .filter((step) => step.kind === kind && step[column])
      .map((step) => step[column] as string);

  const lessonIds = ids("lesson", "lessonId");
  if (lessonIds.length > 0) {
    await pick(
      await tx
        .select({ id: lessons.id, title: lessons.title })
        .from(lessons)
        .where(inArray(lessons.id, lessonIds)),
      (step) => step.lessonId,
    );
  }

  const assessmentIds = ids("assessment", "assessmentId");
  if (assessmentIds.length > 0) {
    await pick(
      await tx
        .select({ id: assessments.id, title: assessments.title })
        .from(assessments)
        .where(inArray(assessments.id, assessmentIds)),
      (step) => step.assessmentId,
    );
  }

  const documentIds = ids("document", "programmeDocumentId");
  if (documentIds.length > 0) {
    await pick(
      await tx
        .select({ id: programmeDocuments.id, title: programmeDocuments.title })
        .from(programmeDocuments)
        .where(inArray(programmeDocuments.id, documentIds)),
      (step) => step.programmeDocumentId,
    );
  }

  const moduleIds = ids("workplace", "curriculumModuleId");
  if (moduleIds.length > 0) {
    await pick(
      await tx
        .select({ id: curriculumModules.id, title: curriculumModules.title })
        .from(curriculumModules)
        .where(inArray(curriculumModules.id, moduleIds)),
      (step) => step.curriculumModuleId,
    );
  }

  for (const step of steps) {
    if (step.title) titles.set(step.id, step.title);
    else if (!titles.has(step.id)) titles.set(step.id, "Untitled step");
  }

  return titles;
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

/**
 * Refuses unless this learner may work on this step right now.
 *
 * Called by every action that touches a step, not only by the page that lists
 * them. A learner who types the URL of a locked assessment is told the same
 * thing as one who sees it greyed out, and neither can save a draft against it.
 */
export async function assertStepOpen(
  session: AuthenticatedSession,
  stepId: string,
  userId: string = session.userId,
): Promise<void> {
  const open = await withTenant(session.organisationId, async (tx) => {
    const [step] = await tx
      .select({ courseId: courseSteps.courseId })
      .from(courseSteps)
      .where(eq(courseSteps.id, stepId));

    if (!step) throw new SpineError("No such step.", "not_found");

    const views = await computeSteps(tx, step.courseId, userId);
    return views.find((view) => view.id === stepId) ?? null;
  });

  if (!open) throw new SpineError("No such step.", "not_found");

  if (!open.open) {
    throw new SpineError(
      `"${open.title}" is not open yet: ${open.blockedBy.join("; ")}.`,
      "locked",
    );
  }
}

/**
 * Refuses if the lesson sits on a spine and its step is not open yet.
 *
 * A course with no steps is not gated at all, and this does nothing — which is
 * what keeps every course built before the spine existed working exactly as it
 * did. Gating is something a course opts into by having a spine.
 */
export async function assertLessonStepOpen(
  session: AuthenticatedSession,
  lessonId: string,
): Promise<void> {
  const stepId = await withTenant(session.organisationId, async (tx) => {
    const [step] = await tx
      .select({ id: courseSteps.id })
      .from(courseSteps)
      .where(eq(courseSteps.lessonId, lessonId));
    return step?.id ?? null;
  });

  if (stepId) await assertStepOpen(session, stepId);
}

/**
 * The same question asked without an exception, for a page deciding what to
 * render. The refusal above is what protects the action.
 */
export async function isStepOpen(
  session: AuthenticatedSession,
  stepId: string,
  userId: string = session.userId,
): Promise<boolean> {
  try {
    await assertStepOpen(session, stepId, userId);
    return true;
  } catch (error) {
    if (error instanceof SpineError && error.code === "locked") return false;
    throw error;
  }
}

/**
 * Records that a learner opened a step, and refuses if it is not theirs to
 * open.
 *
 * This is the write behind every `opened` gate. It runs the guard first, so a
 * learner cannot unlock the rest of a spine by asking to open a step they were
 * never let into.
 */
export async function recordStepOpened(
  session: AuthenticatedSession,
  stepId: string,
): Promise<void> {
  await assertStepOpen(session, stepId);

  await withTenant(session.organisationId, async (tx) => {
    await tx
      .insert(stepProgress)
      .values({
        organisationId: session.organisationId,
        stepId,
        userId: session.userId,
      })
      .onConflictDoNothing();
  });
}

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

export type AddStepInput = {
  courseId: string;
  kind: StepKind;
  lessonId?: string;
  assessmentId?: string;
  programmeDocumentId?: string;
  curriculumModuleId?: string;
  title?: string;
  guidance?: string;
  release?: "open" | "sequential" | "prerequisites";
  sequentialRule?: PrerequisiteRule;
  optional?: boolean;
  availableFrom?: Date;
  availableUntil?: Date;
};

export async function addStep(
  session: AuthenticatedSession,
  input: AddStepInput,
) {
  assertSessionCan(session, "course:author");

  const target =
    input.kind === "lesson"
      ? input.lessonId
      : input.kind === "assessment"
        ? input.assessmentId
        : input.kind === "document"
          ? input.programmeDocumentId
          : input.curriculumModuleId;

  if (!target) {
    throw new SpineError(
      `A ${input.kind} step has to name the ${input.kind} it points at.`,
      "invalid",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [course] = await tx
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.id, input.courseId));

    if (!course) throw new SpineError("No such course.", "not_found");

    const existing = await loadSteps(tx, input.courseId);

    const [step] = await tx
      .insert(courseSteps)
      .values({
        organisationId: session.organisationId,
        courseId: input.courseId,
        kind: input.kind,
        lessonId: input.kind === "lesson" ? target : null,
        assessmentId: input.kind === "assessment" ? target : null,
        programmeDocumentId: input.kind === "document" ? target : null,
        curriculumModuleId: input.kind === "workplace" ? target : null,
        title: input.title ?? null,
        guidance: input.guidance ?? null,
        release: input.release ?? "sequential",
        sequentialRule: input.sequentialRule ?? "opened",
        optional: input.optional ? 1 : 0,
        availableFrom: input.availableFrom ?? null,
        availableUntil: input.availableUntil ?? null,
        sortOrder: existing.length,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "course.step_added",
      entityType: "course_step",
      entityId: step.id,
      after: { courseId: input.courseId, kind: input.kind, target },
    });

    return step;
  });
}

/**
 * Writes a prerequisite, refusing the ones that could never be satisfied.
 *
 * Two refusals matter here. A `competent` rule naming a formative assessment
 * builds a gate that can never open, because a formative assessment produces
 * no competence decision — and it usually means the author has mistaken a
 * workbook for a measurement. And a prerequisite pointing forwards, or round
 * in a circle, locks a learner out of both steps for ever.
 */
export async function addPrerequisite(
  session: AuthenticatedSession,
  input: {
    stepId: string;
    requiredStepId: string;
    rule: PrerequisiteRule;
    anyOfGroup?: string;
  },
) {
  assertSessionCan(session, "course:author");

  if (input.stepId === input.requiredStepId) {
    throw new SpineError("A step cannot wait for itself.", "invalid");
  }

  return withTenant(session.organisationId, async (tx) => {
    const [step] = await tx
      .select()
      .from(courseSteps)
      .where(eq(courseSteps.id, input.stepId));
    const [required] = await tx
      .select()
      .from(courseSteps)
      .where(eq(courseSteps.id, input.requiredStepId));

    if (!step || !required) throw new SpineError("No such step.", "not_found");

    if (step.courseId !== required.courseId) {
      throw new SpineError(
        "A step can only wait for another step on the same course.",
        "invalid",
      );
    }

    if (COMPETENCE_RULES.includes(input.rule)) {
      if (required.kind === "assessment" && required.assessmentId) {
        const [assessment] = await tx
          .select({ purpose: assessments.purpose, title: assessments.title })
          .from(assessments)
          .where(eq(assessments.id, required.assessmentId));

        if (assessment?.purpose === "formative") {
          throw new SpineError(
            `"${assessment.title}" is formative, so it never produces a competence decision — ` +
              `a gate waiting for one would never open. Wait for it to be handed in or marked instead.`,
            "invalid",
          );
        }
      } else if (required.kind === "lesson" || required.kind === "document") {
        throw new SpineError(
          "A lesson or a document is not assessed, so it cannot be judged competent. " +
            "Wait for it to be opened instead.",
          "invalid",
        );
      }
    }

    if (input.rule === "signed_off" && required.kind !== "workplace") {
      throw new SpineError(
        "Only a work experience module is signed off. Pick another rule.",
        "invalid",
      );
    }

    // A cycle would lock a learner out of every step in it, permanently.
    const wouldCycle = await createsCycle(
      tx,
      step.courseId,
      input.stepId,
      input.requiredStepId,
    );
    if (wouldCycle) {
      throw new SpineError(
        "That would make two steps wait for each other, and neither would ever open.",
        "invalid",
      );
    }

    const [created] = await tx
      .insert(courseStepPrerequisites)
      .values({
        organisationId: session.organisationId,
        stepId: input.stepId,
        requiredStepId: input.requiredStepId,
        rule: input.rule,
        anyOfGroup: input.anyOfGroup ?? null,
      })
      .returning();

    // Writing a prerequisite means the step waits for what it names, not for
    // whatever happens to sit above it on the list.
    if (step.release !== "prerequisites") {
      await tx
        .update(courseSteps)
        .set({ release: "prerequisites" })
        .where(eq(courseSteps.id, input.stepId));
    }

    return created;
  });
}

/** Depth-first search over the prerequisite graph, following the new edge. */
async function createsCycle(
  tx: TenantDatabase,
  courseId: string,
  stepId: string,
  requiredStepId: string,
): Promise<boolean> {
  const steps = await loadSteps(tx, courseId);
  const stepIds = steps.map((step) => step.id);
  const edges = await tx
    .select({
      stepId: courseStepPrerequisites.stepId,
      requiredStepId: courseStepPrerequisites.requiredStepId,
    })
    .from(courseStepPrerequisites)
    .where(inArray(courseStepPrerequisites.stepId, stepIds));

  const waitsFor = new Map<string, string[]>();
  for (const edge of [...edges, { stepId, requiredStepId }]) {
    const list = waitsFor.get(edge.stepId) ?? [];
    list.push(edge.requiredStepId);
    waitsFor.set(edge.stepId, list);
  }

  // Walk everything the step would then be waiting for. Arriving back at the
  // step itself means the chain closes on itself and neither end could open.
  const seen = new Set<string>();
  const stack = [...(waitsFor.get(stepId) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === stepId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(waitsFor.get(current) ?? []));
  }
  return false;
}

export async function reorderSteps(
  session: AuthenticatedSession,
  courseId: string,
  orderedStepIds: string[],
) {
  assertSessionCan(session, "course:author");

  return withTenant(session.organisationId, async (tx) => {
    const steps = await loadSteps(tx, courseId);
    const known = new Set(steps.map((step) => step.id));

    if (
      orderedStepIds.length !== steps.length ||
      orderedStepIds.some((id) => !known.has(id))
    ) {
      throw new SpineError(
        "The new order has to list every step of the course exactly once.",
        "invalid",
      );
    }

    for (const [index, id] of orderedStepIds.entries()) {
      await tx
        .update(courseSteps)
        .set({ sortOrder: index })
        .where(eq(courseSteps.id, id));
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "course.steps_reordered",
      entityType: "course",
      entityId: courseId,
      after: { order: orderedStepIds },
    });
  });
}

export async function removeStep(session: AuthenticatedSession, stepId: string) {
  assertSessionCan(session, "course:author");

  return withTenant(session.organisationId, async (tx) => {
    const [step] = await tx
      .select()
      .from(courseSteps)
      .where(eq(courseSteps.id, stepId));
    if (!step) throw new SpineError("No such step.", "not_found");

    await tx.delete(courseSteps).where(eq(courseSteps.id, stepId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "course.step_removed",
      entityType: "course_step",
      entityId: stepId,
      before: { courseId: step.courseId, kind: step.kind },
    });
  });
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

/**
 * Lets one learner past one gate, on the record.
 *
 * The reason is required and the audit entry is written in the same
 * transaction, so an override cannot exist without an account of why it was
 * granted and by whom.
 */
export async function grantOverride(
  session: AuthenticatedSession,
  input: { stepId: string; userId: string; reason: string },
) {
  assertSessionCan(session, "enrolment:manage");

  const reason = input.reason.trim();
  if (reason.length < 10) {
    throw new SpineError(
      "Say why this learner is being let past. It is shown on their record and in the moderation pack.",
      "invalid",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [step] = await tx
      .select({ id: courseSteps.id, courseId: courseSteps.courseId })
      .from(courseSteps)
      .where(eq(courseSteps.id, input.stepId));
    if (!step) throw new SpineError("No such step.", "not_found");

    const [granted] = await tx
      .insert(stepOverrides)
      .values({
        organisationId: session.organisationId,
        stepId: input.stepId,
        userId: input.userId,
        reason,
        grantedById: session.userId,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "course.step_overridden",
      entityType: "course_step",
      entityId: input.stepId,
      after: { userId: input.userId, reason },
    });

    return granted;
  });
}

export async function revokeOverride(
  session: AuthenticatedSession,
  overrideId: string,
) {
  assertSessionCan(session, "enrolment:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [revoked] = await tx
      .update(stepOverrides)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(stepOverrides.id, overrideId), isNull(stepOverrides.revokedAt)),
      )
      .returning();

    if (!revoked) throw new SpineError("No such override.", "not_found");

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "course.step_override_revoked",
      entityType: "course_step",
      entityId: revoked.stepId,
      before: { userId: revoked.userId, reason: revoked.reason },
    });

    return revoked;
  });
}

// ---------------------------------------------------------------------------
// The facilitator's screen
// ---------------------------------------------------------------------------

export type BlockedLearner = {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  stepTitle: string;
  blockedBy: string[];
  stepId: string;
};

/**
 * Who is stuck on this course, and on what.
 *
 * The single screen a facilitator lives in. A learner appears once, for the
 * earliest step they cannot open — being blocked on step three is the fact
 * that matters, and also being blocked on steps four to ten is noise.
 */
export async function blockedLearners(
  session: AuthenticatedSession,
  courseId: string,
): Promise<BlockedLearner[]> {
  assertSessionCan(session, "enrolment:read_all");

  return withTenant(session.organisationId, async (tx) => {
    const enrolled = await tx
      .select({
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(enrolments)
      .innerJoin(users, eq(users.id, enrolments.userId))
      .where(
        and(
          eq(enrolments.courseId, courseId),
          inArray(enrolments.status, ["assigned", "in_progress", "overdue"]),
        ),
      );

    const blocked: BlockedLearner[] = [];

    for (const learner of enrolled) {
      const views = await computeSteps(tx, courseId, learner.userId);
      const stuck = views.find(
        (view) => !view.open && !view.optional && view.state !== "done",
      );
      if (!stuck) continue;

      blocked.push({
        ...learner,
        stepId: stuck.id,
        stepTitle: stuck.title,
        blockedBy: stuck.blockedBy,
      });
    }

    return blocked;
  });
}
