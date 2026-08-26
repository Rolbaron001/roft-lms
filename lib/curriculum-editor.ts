import { and, asc, count, eq, ne, inArray } from "drizzle-orm";
import {
  ELEMENT_KINDS_BY_COMPONENT,
  type ElementKind,
} from "./curriculum-shape";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  assessmentCriteria,
  assessmentDecisions,
  assessmentItemCriteria,
  assessmentItems,
  curriculumModules,
  curriculumTopicElements,
  curriculumTopics,
  lessonCriteria,
  qualifications,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Building a curriculum in the App.
 *
 * Until this existed a curriculum could only arrive as a JSON file transcribed
 * by hand, which meant a provider could not add a qualification without the
 * person who writes those files. That is the difference between a platform a
 * client operates and one that needs its author.
 *
 * Two ideas run through it.
 *
 * **Codes are identity.** A criterion is IAC0203 in the printed document, in
 * the workbook that tests it, in the memorandum that marks it and on the
 * Statement of Results. Two things sharing a code inside the same scope makes
 * every one of those references ambiguous, so it is refused rather than
 * allowed and reported later.
 *
 * **Deleting is where the damage is.** Adding something wrong is visible and
 * easily undone. Removing a criterion that questions already evidence, or that
 * a learner has already been judged against, quietly unlinks work that took
 * months to produce — the foreign keys are set to null or cascade, so nothing
 * complains. Those deletions are refused, and the refusal says what is using
 * it.
 */

export class CurriculumError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "invalid" | "in_use",
  ) {
    super(message);
    this.name = "CurriculumError";
  }
}

const CODE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,49}$/;

function assertCode(value: string, what: string): string {
  const code = value.trim();
  if (!CODE.test(code)) {
    throw new CurriculumError(
      `"${code}" is not usable as a ${what} code. Use letters, digits, and . _ / - only, as the curriculum document prints it.`,
      "invalid",
    );
  }
  return code;
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

export async function updateModule(
  session: AuthenticatedSession,
  moduleId: string,
  input: {
    code?: string;
    title?: string;
    description?: string | null;
    credits?: number | null;
    notionalHours?: number | null;
  },
) {
  assertSessionCan(session, "qualification:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [module] = await tx
      .select()
      .from(curriculumModules)
      .where(eq(curriculumModules.id, moduleId));

    if (!module) throw new CurriculumError("No such module.", "not_found");

    const code = input.code ? assertCode(input.code, "module") : module.code;

    if (code !== module.code) {
      const [clash] = await tx
        .select({ id: curriculumModules.id })
        .from(curriculumModules)
        .where(
          and(
            eq(curriculumModules.qualificationId, module.qualificationId),
            eq(curriculumModules.code, code),
            ne(curriculumModules.id, moduleId),
          ),
        );
      if (clash) {
        throw new CurriculumError(
          `Another module on this qualification is already ${code}.`,
          "invalid",
        );
      }
    }

    const [updated] = await tx
      .update(curriculumModules)
      .set({
        code,
        title: input.title?.trim() ?? module.title,
        description:
          input.description === undefined
            ? module.description
            : input.description,
        credits: input.credits === undefined ? module.credits : input.credits,
        notionalHours:
          input.notionalHours === undefined
            ? module.notionalHours
            : input.notionalHours,
      })
      .where(eq(curriculumModules.id, moduleId))
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "curriculum_module.updated",
      entityType: "curriculum_module",
      entityId: moduleId,
      before: { code: module.code, title: module.title, credits: module.credits },
      after: { code: updated.code, title: updated.title, credits: updated.credits },
    });

    return updated;
  });
}

export async function removeModule(
  session: AuthenticatedSession,
  moduleId: string,
) {
  assertSessionCan(session, "qualification:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [module] = await tx
      .select()
      .from(curriculumModules)
      .where(eq(curriculumModules.id, moduleId));

    if (!module) throw new CurriculumError("No such module.", "not_found");

    const criteria = await tx
      .select({ id: assessmentCriteria.id })
      .from(assessmentCriteria)
      .where(eq(assessmentCriteria.curriculumModuleId, moduleId));

    for (const criterion of criteria) {
      const uses = await criterionUses(tx, criterion.id);
      if (uses.length > 0) {
        throw new CurriculumError(
          `That module cannot be removed: ${uses.join(" ")} Remove or retag those first.`,
          "in_use",
        );
      }
    }

    await tx.delete(curriculumModules).where(eq(curriculumModules.id, moduleId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "curriculum_module.removed",
      entityType: "curriculum_module",
      entityId: moduleId,
      before: { code: module.code, title: module.title },
    });
  });
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

export async function addTopic(
  session: AuthenticatedSession,
  input: {
    curriculumModuleId: string;
    code: string;
    title: string;
    weightPercent?: number | null;
  },
) {
  assertSessionCan(session, "qualification:manage");
  const code = assertCode(input.code, "topic");

  return withTenant(session.organisationId, async (tx) => {
    const [module] = await tx
      .select()
      .from(curriculumModules)
      .where(eq(curriculumModules.id, input.curriculumModuleId));

    if (!module) throw new CurriculumError("No such module.", "not_found");

    const [clash] = await tx
      .select({ id: curriculumTopics.id })
      .from(curriculumTopics)
      .where(
        and(
          eq(curriculumTopics.curriculumModuleId, input.curriculumModuleId),
          eq(curriculumTopics.code, code),
        ),
      );
    if (clash) {
      throw new CurriculumError(
        `${module.code} already has a topic ${code}.`,
        "invalid",
      );
    }

    if (
      input.weightPercent != null &&
      (input.weightPercent < 0 || input.weightPercent > 100)
    ) {
      throw new CurriculumError(
        "A topic's percentage is between 0 and 100.",
        "invalid",
      );
    }

    const [{ existing }] = await tx
      .select({ existing: count() })
      .from(curriculumTopics)
      .where(eq(curriculumTopics.curriculumModuleId, input.curriculumModuleId));

    const [created] = await tx
      .insert(curriculumTopics)
      .values({
        organisationId: session.organisationId,
        curriculumModuleId: input.curriculumModuleId,
        code,
        title: input.title.trim(),
        weightPercent: input.weightPercent ?? null,
        sortOrder: existing,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "curriculum_topic.created",
      entityType: "curriculum_topic",
      entityId: created.id,
      after: { code, title: created.title, module: module.code },
    });

    return created;
  });
}

export async function updateTopic(
  session: AuthenticatedSession,
  topicId: string,
  input: { code?: string; title?: string; weightPercent?: number | null },
) {
  assertSessionCan(session, "qualification:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [topic] = await tx
      .select()
      .from(curriculumTopics)
      .where(eq(curriculumTopics.id, topicId));

    if (!topic) throw new CurriculumError("No such topic.", "not_found");

    const code = input.code ? assertCode(input.code, "topic") : topic.code;

    if (code !== topic.code) {
      const [clash] = await tx
        .select({ id: curriculumTopics.id })
        .from(curriculumTopics)
        .where(
          and(
            eq(curriculumTopics.curriculumModuleId, topic.curriculumModuleId),
            eq(curriculumTopics.code, code),
            ne(curriculumTopics.id, topicId),
          ),
        );
      if (clash) {
        throw new CurriculumError(
          `This module already has a topic ${code}.`,
          "invalid",
        );
      }
    }

    const [updated] = await tx
      .update(curriculumTopics)
      .set({
        code,
        title: input.title?.trim() ?? topic.title,
        weightPercent:
          input.weightPercent === undefined
            ? topic.weightPercent
            : input.weightPercent,
      })
      .where(eq(curriculumTopics.id, topicId))
      .returning();

    return updated;
  });
}

export async function removeTopic(
  session: AuthenticatedSession,
  topicId: string,
) {
  assertSessionCan(session, "qualification:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [topic] = await tx
      .select()
      .from(curriculumTopics)
      .where(eq(curriculumTopics.id, topicId));

    if (!topic) throw new CurriculumError("No such topic.", "not_found");

    await tx.delete(curriculumTopics).where(eq(curriculumTopics.id, topicId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "curriculum_topic.removed",
      entityType: "curriculum_topic",
      entityId: topicId,
      before: { code: topic.code, title: topic.title },
    });
  });
}

// ---------------------------------------------------------------------------
// Topic elements — the lines that say what must actually be taught
// ---------------------------------------------------------------------------

export {
  ELEMENT_KINDS_BY_COMPONENT,
  type ElementKind,
} from "./curriculum-shape";

export async function addTopicElement(
  session: AuthenticatedSession,
  input: {
    topicId: string;
    kind: ElementKind;
    code: string;
    description: string;
  },
) {
  assertSessionCan(session, "qualification:manage");
  const code = assertCode(input.code, "element");

  return withTenant(session.organisationId, async (tx) => {
    const [topic] = await tx
      .select({
        id: curriculumTopics.id,
        code: curriculumTopics.code,
        moduleId: curriculumTopics.curriculumModuleId,
      })
      .from(curriculumTopics)
      .where(eq(curriculumTopics.id, input.topicId));

    if (!topic) throw new CurriculumError("No such topic.", "not_found");

    const [module] = await tx
      .select({ component: curriculumModules.component, code: curriculumModules.code })
      .from(curriculumModules)
      .where(eq(curriculumModules.id, topic.moduleId));

    // A work activity inside a knowledge module is not a typo the platform
    // should absorb: it means somebody has the wrong module open, and the
    // alignment matrix would report coverage that does not exist.
    const allowed = ELEMENT_KINDS_BY_COMPONENT[module.component] ?? [];
    if (!allowed.includes(input.kind)) {
      throw new CurriculumError(
        `${module.code} is a ${module.component} module, so it holds ${allowed
          .map((kind) => kind.replace(/_/g, " "))
          .join(" or ")} — not ${input.kind.replace(/_/g, " ")}.`,
        "invalid",
      );
    }

    const [clash] = await tx
      .select({ id: curriculumTopicElements.id })
      .from(curriculumTopicElements)
      .where(
        and(
          eq(curriculumTopicElements.topicId, input.topicId),
          eq(curriculumTopicElements.code, code),
        ),
      );
    if (clash) {
      throw new CurriculumError(
        `${topic.code} already has ${code}.`,
        "invalid",
      );
    }

    const [{ existing }] = await tx
      .select({ existing: count() })
      .from(curriculumTopicElements)
      .where(eq(curriculumTopicElements.topicId, input.topicId));

    const [created] = await tx
      .insert(curriculumTopicElements)
      .values({
        organisationId: session.organisationId,
        topicId: input.topicId,
        kind: input.kind,
        code,
        description: input.description.trim(),
        sortOrder: existing,
      })
      .returning();

    return created;
  });
}

export async function updateTopicElement(
  session: AuthenticatedSession,
  elementId: string,
  input: { code?: string; description?: string; kind?: ElementKind },
) {
  assertSessionCan(session, "qualification:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [element] = await tx
      .select()
      .from(curriculumTopicElements)
      .where(eq(curriculumTopicElements.id, elementId));

    if (!element) throw new CurriculumError("No such element.", "not_found");

    const code = input.code ? assertCode(input.code, "element") : element.code;

    if (code !== element.code) {
      const [clash] = await tx
        .select({ id: curriculumTopicElements.id })
        .from(curriculumTopicElements)
        .where(
          and(
            eq(curriculumTopicElements.topicId, element.topicId),
            eq(curriculumTopicElements.code, code),
            ne(curriculumTopicElements.id, elementId),
          ),
        );
      if (clash) {
        throw new CurriculumError(
          `This topic already has ${code}.`,
          "invalid",
        );
      }
    }

    const [updated] = await tx
      .update(curriculumTopicElements)
      .set({
        code,
        description: input.description?.trim() ?? element.description,
        kind: input.kind ?? element.kind,
      })
      .where(eq(curriculumTopicElements.id, elementId))
      .returning();

    return updated;
  });
}

export async function removeTopicElement(
  session: AuthenticatedSession,
  elementId: string,
) {
  assertSessionCan(session, "qualification:manage");

  return withTenant(session.organisationId, (tx) =>
    tx
      .delete(curriculumTopicElements)
      .where(eq(curriculumTopicElements.id, elementId)),
  );
}

// ---------------------------------------------------------------------------
// Criteria
// ---------------------------------------------------------------------------

/** Everything currently depending on a criterion, in words. */
async function criterionUses(
  tx: TenantDatabase,
  criterionId: string,
): Promise<string[]> {
  const uses: string[] = [];

  const [tagged] = await tx
    .select({ n: count() })
    .from(assessmentItemCriteria)
    .where(eq(assessmentItemCriteria.criterionId, criterionId));

  const [legacy] = await tx
    .select({ n: count() })
    .from(assessmentItems)
    .where(eq(assessmentItems.criterionId, criterionId));

  const questions = Number(tagged.n) + Number(legacy.n);
  if (questions > 0) {
    uses.push(
      `${questions} ${questions === 1 ? "question evidences" : "questions evidence"} it.`,
    );
  }

  const [lessons] = await tx
    .select({ n: count() })
    .from(lessonCriteria)
    .where(eq(lessonCriteria.criterionId, criterionId));

  if (Number(lessons.n) > 0) {
    uses.push(
      `${lessons.n} ${Number(lessons.n) === 1 ? "lesson teaches" : "lessons teach"} it.`,
    );
  }

  // The one that matters most. A judgement recorded against a criterion is a
  // learner's achievement; deleting the criterion leaves the decision pointing
  // at nothing, and the readiness figure silently drops.
  const decisions = await tx
    .select({ criterionOutcomes: assessmentDecisions.criterionOutcomes })
    .from(assessmentDecisions);

  const judged = decisions.filter(
    (row) => row.criterionOutcomes && criterionId in row.criterionOutcomes,
  ).length;

  if (judged > 0) {
    uses.push(
      `${judged} assessor ${judged === 1 ? "decision has" : "decisions have"} already judged a learner against it.`,
    );
  }

  return uses;
}

export async function updateCriterion(
  session: AuthenticatedSession,
  criterionId: string,
  input: { code?: string; description?: string },
) {
  assertSessionCan(session, "qualification:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [criterion] = await tx
      .select()
      .from(assessmentCriteria)
      .where(eq(assessmentCriteria.id, criterionId));

    if (!criterion) throw new CurriculumError("No such criterion.", "not_found");

    const code = input.code ? assertCode(input.code, "criterion") : criterion.code;

    if (code !== criterion.code) {
      const [clash] = await tx
        .select({ id: assessmentCriteria.id })
        .from(assessmentCriteria)
        .where(
          and(
            eq(
              assessmentCriteria.curriculumModuleId,
              criterion.curriculumModuleId,
            ),
            eq(assessmentCriteria.code, code),
            ne(assessmentCriteria.id, criterionId),
          ),
        );
      if (clash) {
        throw new CurriculumError(
          `This module already has a criterion ${code}.`,
          "invalid",
        );
      }
    }

    const [updated] = await tx
      .update(assessmentCriteria)
      .set({
        code,
        description: input.description?.trim() ?? criterion.description,
      })
      .where(eq(assessmentCriteria.id, criterionId))
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "assessment_criterion.updated",
      entityType: "assessment_criterion",
      entityId: criterionId,
      before: { code: criterion.code, description: criterion.description },
      after: { code: updated.code, description: updated.description },
    });

    return updated;
  });
}

export async function removeCriterion(
  session: AuthenticatedSession,
  criterionId: string,
) {
  assertSessionCan(session, "qualification:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [criterion] = await tx
      .select()
      .from(assessmentCriteria)
      .where(eq(assessmentCriteria.id, criterionId));

    if (!criterion) throw new CurriculumError("No such criterion.", "not_found");

    const uses = await criterionUses(tx, criterionId);
    if (uses.length > 0) {
      throw new CurriculumError(
        `${criterion.code} is still in use: ${uses.join(" ")} Deleting it would unlink that work without warning.`,
        "in_use",
      );
    }

    await tx
      .delete(assessmentCriteria)
      .where(eq(assessmentCriteria.id, criterionId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "assessment_criterion.removed",
      entityType: "assessment_criterion",
      entityId: criterionId,
      before: { code: criterion.code, description: criterion.description },
    });
  });
}

// ---------------------------------------------------------------------------
// What is wrong with this curriculum
// ---------------------------------------------------------------------------

export type CurriculumProblem = {
  where: string;
  what: string;
  severity: "problem" | "note";
};

/**
 * The same checks the importer runs, against a curriculum built by hand.
 *
 * Reported rather than refused: a curriculum is entered over hours and would be
 * unusable if every half-finished state were rejected. What matters is that the
 * list is in front of whoever is building it, and that it empties.
 */
export async function curriculumProblems(
  session: AuthenticatedSession,
  qualificationId: string,
): Promise<CurriculumProblem[]> {
  assertSessionCan(session, "course:read");

  return withTenant(session.organisationId, async (tx) => {
    const problems: CurriculumProblem[] = [];

    const modules = await tx
      .select()
      .from(curriculumModules)
      .where(eq(curriculumModules.qualificationId, qualificationId))
      .orderBy(asc(curriculumModules.sortOrder));

    if (modules.length === 0) {
      return [
        {
          where: "This qualification",
          what: "has no modules yet. Add them as the curriculum document lists them.",
          severity: "problem" as const,
        },
      ];
    }

    const moduleIds = modules.map((module) => module.id);

    const topics = await tx
      .select()
      .from(curriculumTopics)
      .where(inArray(curriculumTopics.curriculumModuleId, moduleIds));

    const elements = topics.length
      ? await tx
          .select()
          .from(curriculumTopicElements)
          .where(
            inArray(
              curriculumTopicElements.topicId,
              topics.map((topic) => topic.id),
            ),
          )
      : [];

    const criteria = await tx
      .select()
      .from(assessmentCriteria)
      .where(inArray(assessmentCriteria.curriculumModuleId, moduleIds));

    for (const entry of modules) {
      const own = topics.filter((t) => t.curriculumModuleId === entry.id);
      const ownCriteria = criteria.filter(
        (c) => c.curriculumModuleId === entry.id,
      );

      if (own.length === 0) {
        problems.push({
          where: entry.code,
          what: "has no topics.",
          severity: "problem",
        });
      }

      // A work experience module carries no assessment criteria by design: it
      // is evidenced by a signed logbook. Criteria on one are a mistake that
      // would make the module impossible to complete.
      if (entry.component === "workplace" && ownCriteria.length > 0) {
        problems.push({
          where: entry.code,
          what: `is a work experience module but has ${ownCriteria.length} assessment criteria. Work experience is evidenced by a signed logbook, so these should be removed.`,
          severity: "problem",
        });
      }

      if (entry.component !== "workplace" && ownCriteria.length === 0) {
        problems.push({
          where: entry.code,
          what: "has no assessment criteria, so nothing in it can ever be achieved.",
          severity: "problem",
        });
      }

      const weighted = own.filter((t) => t.weightPercent !== null);
      if (weighted.length > 0 && weighted.length < own.length) {
        problems.push({
          where: entry.code,
          what: "gives some topics a percentage and not others, so all will be treated as equal.",
          severity: "note",
        });
      }
      if (weighted.length === own.length && own.length > 0) {
        const total = weighted.reduce(
          (sum, topic) => sum + (topic.weightPercent ?? 0),
          0,
        );
        if (total !== 100) {
          problems.push({
            where: entry.code,
            what: `topic percentages add up to ${total}, not 100.`,
            severity: "problem",
          });
        }
      }

      for (const topic of own) {
        const ownElements = elements.filter((e) => e.topicId === topic.id);
        if (ownElements.length === 0) {
          problems.push({
            where: `${entry.code} / ${topic.code}`,
            what: "lists nothing to teach, so the Learning Material Matrix cannot check it.",
            severity: "problem",
          });
        }
      }
    }

    return problems;
  });
}

/** The whole curriculum, shaped for the editor. */
export async function curriculumForEditing(
  session: AuthenticatedSession,
  qualificationId: string,
) {
  assertSessionCan(session, "course:read");

  return withTenant(session.organisationId, async (tx) => {
    const [qualification] = await tx
      .select()
      .from(qualifications)
      .where(eq(qualifications.id, qualificationId));

    if (!qualification) {
      throw new CurriculumError("No such qualification.", "not_found");
    }

    const modules = await tx
      .select()
      .from(curriculumModules)
      .where(eq(curriculumModules.qualificationId, qualificationId))
      .orderBy(asc(curriculumModules.sortOrder));

    const moduleIds = modules.map((module) => module.id);

    const topics = moduleIds.length
      ? await tx
          .select()
          .from(curriculumTopics)
          .where(inArray(curriculumTopics.curriculumModuleId, moduleIds))
          .orderBy(asc(curriculumTopics.sortOrder))
      : [];

    const elements = topics.length
      ? await tx
          .select()
          .from(curriculumTopicElements)
          .where(
            inArray(
              curriculumTopicElements.topicId,
              topics.map((topic) => topic.id),
            ),
          )
          .orderBy(asc(curriculumTopicElements.sortOrder))
      : [];

    const criteria = moduleIds.length
      ? await tx
          .select()
          .from(assessmentCriteria)
          .where(inArray(assessmentCriteria.curriculumModuleId, moduleIds))
          .orderBy(asc(assessmentCriteria.sortOrder))
      : [];

    return {
      qualification,
      modules: modules.map((module) => ({
        ...module,
        topics: topics
          .filter((topic) => topic.curriculumModuleId === module.id)
          .map((topic) => ({
            ...topic,
            elements: elements.filter((element) => element.topicId === topic.id),
          })),
        criteria: criteria.filter(
          (criterion) => criterion.curriculumModuleId === module.id,
        ),
      })),
    };
  });
}
