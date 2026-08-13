import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  assessmentCriteria,
  assessmentDecisions,
  assessmentSubmissions,
  curriculumModules,
  curriculumTopics,
  enrolments,
  moderationRecords,
  qualifications,
  users,
} from "@/db/schema";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * EISA readiness.
 *
 * Under the OQSF a learner finishes a qualification by passing an External
 * Integrated Summative Assessment, set by the Assessment Quality Partner and
 * sat at a registered assessment centre. The provider's job is everything
 * before that: internal training and internal summative assessment, ending in
 * a Statement of Results that admits the learner to the EISA.
 *
 * Two numbers come out of here, and confusing them would be the whole mistake:
 *
 *   readinessIndex   how far through, weighted by component. A progress bar.
 *                    Useful to a facilitator planning the next month's work.
 *
 *   eisaEligible     whether the learner may sit the EISA. Binary, and
 *                    achieved only when EVERY internal assessment criterion in
 *                    EVERY module has been achieved.
 *
 * The qualification document is unambiguous about the second: admission
 * requires "confirmation of achievement ... that all internal assessment
 * criteria for all modules in the related curriculum document have been
 * achieved". There is no pass mark, no 80% rule, nothing to round up. A
 * learner at 99% is not nearly eligible; they are not eligible. Presenting the
 * weighted index as though it were the gate is how a provider ends up sending
 * somebody to an assessment centre they will be turned away from.
 */

export type WeightSource = "document" | "credits" | "equal";

export type CriterionReadiness = {
  criterionId: string;
  code: string;
  description: string;
  achieved: boolean;
  achievedAt: Date | null;
};

export type TopicReadiness = {
  topicId: string | null;
  code: string;
  title: string;
  /** Share of its module, 0–1, after normalising whatever the document gave. */
  weight: number;
  criteria: CriterionReadiness[];
  achievedCount: number;
  totalCount: number;
  percent: number;
};

export type ModuleReadiness = {
  moduleId: string;
  code: string;
  title: string;
  component: Component;
  credits: number | null;
  topics: TopicReadiness[];
  achievedCount: number;
  totalCount: number;
  /** Weighted by topic, so a module is not 90% done because its small topics are. */
  percent: number;
  complete: boolean;
  /**
   * When the last outstanding criterion in this module was achieved. The
   * Statement of Results has to carry a date per module, and this is it.
   * Null until the module is complete — a partial module has no such date.
   */
  competenceAchievedAt: Date | null;
};

export type Component = "knowledge" | "practical" | "workplace";

export type ComponentReadiness = {
  component: Component;
  weight: number;
  modules: ModuleReadiness[];
  achievedCount: number;
  totalCount: number;
  percent: number;
  complete: boolean;
};

export type Outstanding = {
  component: Component;
  moduleCode: string;
  moduleTitle: string;
  criterionCode: string;
  description: string;
};

export type QualificationReadiness = {
  qualificationId: string;
  qualificationTitle: string;
  saqaId: string | null;
  learner: { userId: string; firstName: string; lastName: string };
  components: ComponentReadiness[];
  weightSource: WeightSource;
  /** 0–100, weighted across components. Progress, not permission. */
  readinessIndex: number;
  /** The gate. Every criterion in every module, or false. */
  eisaEligible: boolean;
  achievedCriteria: number;
  totalCriteria: number;
  outstanding: Outstanding[];
  /**
   * False when some module of the qualification carries no criteria at all,
   * which means the curriculum document has not been fully captured rather
   * than that the learner has finished it.
   */
  curriculumComplete: boolean;
  modulesWithoutCriteria: string[];
};

const COMPONENTS: Component[] = ["knowledge", "practical", "workplace"];

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/**
 * How much each component counts.
 *
 * Preference order matters. The curriculum document's own figures win, even
 * when they disagree with the credit arithmetic — for the HRM Administrator
 * curriculum they do disagree, stating 38/35/27 against a credit split of
 * 35/35/30, and the document is the authority a moderator will check against.
 * Credits are the fallback, and an equal split the last resort.
 */
export function resolveComponentWeights(
  stated: { knowledge: number; practical: number; workplace: number } | null,
  creditsByComponent: Record<Component, number>,
): { weights: Record<Component, number>; source: WeightSource } {
  if (stated) {
    const total = stated.knowledge + stated.practical + stated.workplace;
    if (total > 0) {
      return {
        weights: {
          knowledge: stated.knowledge / total,
          practical: stated.practical / total,
          workplace: stated.workplace / total,
        },
        source: "document",
      };
    }
  }

  const creditTotal = COMPONENTS.reduce(
    (sum, c) => sum + creditsByComponent[c],
    0,
  );

  if (creditTotal > 0) {
    return {
      weights: {
        knowledge: creditsByComponent.knowledge / creditTotal,
        practical: creditsByComponent.practical / creditTotal,
        workplace: creditsByComponent.workplace / creditTotal,
      },
      source: "credits",
    };
  }

  return {
    weights: { knowledge: 1 / 3, practical: 1 / 3, workplace: 1 / 3 },
    source: "equal",
  };
}

/**
 * Topic shares within a module.
 *
 * Knowledge modules state a percentage per topic; practical and work
 * experience modules usually do not. A module with some topics weighted and
 * some not is treated as unweighted throughout: mixing stated percentages with
 * invented ones produces a number nobody can reconcile against the document,
 * and an even split is at least honestly approximate.
 */
export function resolveTopicWeights(
  topics: { weightPercent: number | null }[],
): number[] {
  if (topics.length === 0) return [];

  const allWeighted = topics.every((t) => (t.weightPercent ?? 0) > 0);
  if (allWeighted) {
    const total = topics.reduce((sum, t) => sum + (t.weightPercent ?? 0), 0);
    if (total > 0) {
      return topics.map((t) => (t.weightPercent ?? 0) / total);
    }
  }

  return topics.map(() => 1 / topics.length);
}

/**
 * Every criterion this learner has been judged competent against, and when.
 *
 * "Final" excludes decisions still waiting for a moderator and those referred
 * back, matching the rule certificates already use: an unmoderated judgement
 * is not yet a judgement. Where a moderator overrode the assessor, the
 * moderator's outcome is the one that counts.
 *
 * A criterion achieved on one attempt stays achieved. It can be met in any
 * assessment that covers it, and a later attempt at a different assessment
 * failing to demonstrate it does not remove an achievement already moderated —
 * so the earliest date on which it was achieved is the one recorded.
 */
async function achievedCriteriaFor(
  tx: TenantDatabase,
  userId: string,
): Promise<Map<string, Date>> {
  const rows = await tx
    .select({
      criterionOutcomes: assessmentDecisions.criterionOutcomes,
      decisionOutcome: assessmentDecisions.outcome,
      signedAt: assessmentDecisions.signedAt,
      status: assessmentSubmissions.status,
      moderationOutcome: moderationRecords.outcome,
      revisedOutcome: moderationRecords.revisedOutcome,
      actionedAt: moderationRecords.actionedAt,
    })
    .from(assessmentDecisions)
    .innerJoin(
      assessmentSubmissions,
      eq(assessmentSubmissions.id, assessmentDecisions.submissionId),
    )
    .leftJoin(
      moderationRecords,
      eq(moderationRecords.decisionId, assessmentDecisions.id),
    )
    .where(
      and(
        eq(assessmentSubmissions.userId, userId),
        inArray(assessmentSubmissions.status, ["moderated", "finalised"]),
      ),
    );

  const achieved = new Map<string, Date>();

  for (const row of rows) {
    const overridden =
      row.moderationOutcome === "overridden" && row.revisedOutcome
        ? row.revisedOutcome
        : null;

    // An overriding moderator replaces the assessor's whole judgement, so the
    // per-criterion marks underneath it go with it. Without this, a learner
    // could bank criteria from a decision that was set aside.
    if (overridden === "not_yet_competent") continue;

    // A decision whose overall outcome was "not yet competent" is not skipped.
    // Criteria met within a failed attempt still count — that is the point of
    // criterion-referenced assessment, and re-testing what somebody has
    // already demonstrated is exactly what it exists to avoid.

    const when = row.actionedAt ?? row.signedAt ?? null;
    if (!when) continue;

    for (const [criterionId, outcome] of Object.entries(
      row.criterionOutcomes ?? {},
    )) {
      if (outcome !== "competent") continue;
      const existing = achieved.get(criterionId);
      if (!existing || when < existing) {
        achieved.set(criterionId, when);
      }
    }
  }

  return achieved;
}

/**
 * Where one learner stands against one qualification.
 */
export async function qualificationReadiness(
  session: AuthenticatedSession,
  qualificationId: string,
  userId: string,
): Promise<QualificationReadiness> {
  // A learner may see their own; anybody else needs to be entitled to look at
  // other people's progress.
  if (userId !== session.userId) {
    assertSessionCan(session, "enrolment:read_all");
  }

  return withTenant(session.organisationId, async (tx) => {
    const [qualification] = await tx
      .select({
        id: qualifications.id,
        title: qualifications.title,
        saqaId: qualifications.saqaId,
        componentWeights: qualifications.componentWeights,
      })
      .from(qualifications)
      .where(eq(qualifications.id, qualificationId));

    if (!qualification) {
      throw new Error("Qualification not found.");
    }

    const [learner] = await tx
      .select({
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(eq(users.id, userId));

    if (!learner) {
      throw new Error("Learner not found.");
    }

    const modules = await tx
      .select({
        id: curriculumModules.id,
        code: curriculumModules.code,
        title: curriculumModules.title,
        component: curriculumModules.component,
        credits: curriculumModules.credits,
        sortOrder: curriculumModules.sortOrder,
      })
      .from(curriculumModules)
      .where(eq(curriculumModules.qualificationId, qualificationId));

    const moduleIds = modules.map((m) => m.id);

    const topics = moduleIds.length
      ? await tx
          .select({
            id: curriculumTopics.id,
            curriculumModuleId: curriculumTopics.curriculumModuleId,
            code: curriculumTopics.code,
            title: curriculumTopics.title,
            weightPercent: curriculumTopics.weightPercent,
            sortOrder: curriculumTopics.sortOrder,
          })
          .from(curriculumTopics)
          .where(inArray(curriculumTopics.curriculumModuleId, moduleIds))
      : [];

    const criteria = moduleIds.length
      ? await tx
          .select({
            id: assessmentCriteria.id,
            curriculumModuleId: assessmentCriteria.curriculumModuleId,
            topicId: assessmentCriteria.topicId,
            code: assessmentCriteria.code,
            description: assessmentCriteria.description,
            sortOrder: assessmentCriteria.sortOrder,
          })
          .from(assessmentCriteria)
          .where(inArray(assessmentCriteria.curriculumModuleId, moduleIds))
      : [];

    const achieved = await achievedCriteriaFor(tx, userId);

    const creditsByComponent: Record<Component, number> = {
      knowledge: 0,
      practical: 0,
      workplace: 0,
    };
    for (const row of modules) {
      if (isComponent(row.component)) {
        creditsByComponent[row.component] += row.credits ?? 0;
      }
    }

    const { weights, source } = resolveComponentWeights(
      qualification.componentWeights,
      creditsByComponent,
    );

    const outstanding: Outstanding[] = [];
    const componentResults: ComponentReadiness[] = [];
    let achievedCriteria = 0;
    let totalCriteria = 0;

    for (const component of COMPONENTS) {
      const componentModules = modules
        .filter((m) => m.component === component)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));

      const moduleResults: ModuleReadiness[] = componentModules.map((curriculumModule) => {
        const moduleCriteria = criteria.filter(
          (c) => c.curriculumModuleId === curriculumModule.id,
        );

        const moduleTopics = topics
          .filter((t) => t.curriculumModuleId === curriculumModule.id)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));

        // Criteria captured before topics existed, or by a tenant not using
        // them, hang directly off the curriculumModule. They are gathered into one
        // unnamed topic so the same arithmetic covers both shapes.
        const looseCriteria = moduleCriteria.filter((c) => !c.topicId);

        const topicRows: {
          topicId: string | null;
          code: string;
          title: string;
          weightPercent: number | null;
          criteria: typeof moduleCriteria;
        }[] = moduleTopics.map((topic) => ({
          topicId: topic.id,
          code: topic.code,
          title: topic.title,
          weightPercent: topic.weightPercent,
          criteria: moduleCriteria.filter((c) => c.topicId === topic.id),
        }));

        if (looseCriteria.length > 0) {
          topicRows.push({
            topicId: null,
            code: curriculumModule.code,
            title: "Assessment criteria",
            weightPercent: null,
            criteria: looseCriteria,
          });
        }

        const topicWeights = resolveTopicWeights(topicRows);

        const topicResults: TopicReadiness[] = topicRows.map((row, index) => {
          const criteriaResults: CriterionReadiness[] = row.criteria
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
            .map((criterion) => {
              const at = achieved.get(criterion.id) ?? null;
              return {
                criterionId: criterion.id,
                code: criterion.code,
                description: criterion.description,
                achieved: at !== null,
                achievedAt: at,
              };
            });

          const achievedHere = criteriaResults.filter((c) => c.achieved).length;

          for (const criterion of criteriaResults) {
            if (!criterion.achieved) {
              outstanding.push({
                component,
                moduleCode: curriculumModule.code,
                moduleTitle: curriculumModule.title,
                criterionCode: criterion.code,
                description: criterion.description,
              });
            }
          }

          return {
            topicId: row.topicId,
            code: row.code,
            title: row.title,
            weight: topicWeights[index],
            criteria: criteriaResults,
            achievedCount: achievedHere,
            totalCount: criteriaResults.length,
            percent:
              criteriaResults.length === 0
                ? 0
                : round((achievedHere / criteriaResults.length) * 100),
          };
        });

        const moduleAchieved = topicResults.reduce(
          (sum, t) => sum + t.achievedCount,
          0,
        );
        const moduleTotal = topicResults.reduce(
          (sum, t) => sum + t.totalCount,
          0,
        );

        // Weighted by topic. A module whose 25% topics are done and whose 75%
        // topic is not is a quarter finished, however many criteria sit in each.
        const weightedPercent = topicResults
          .filter((t) => t.totalCount > 0)
          .reduce((sum, t) => sum + t.weight * (t.achievedCount / t.totalCount), 0);

        const complete = moduleTotal > 0 && moduleAchieved === moduleTotal;

        const dates = topicResults
          .flatMap((t) => t.criteria)
          .map((c) => c.achievedAt)
          .filter((d): d is Date => d !== null);

        return {
          moduleId: curriculumModule.id,
          code: curriculumModule.code,
          title: curriculumModule.title,
          component,
          credits: curriculumModule.credits,
          topics: topicResults,
          achievedCount: moduleAchieved,
          totalCount: moduleTotal,
          percent: round(weightedPercent * 100),
          complete,
          // The date the module was finished is the date of its *last*
          // criterion, not its first.
          competenceAchievedAt:
            complete && dates.length > 0
              ? new Date(Math.max(...dates.map((d) => d.getTime())))
              : null,
        };
      });

      const componentAchieved = moduleResults.reduce(
        (sum, m) => sum + m.achievedCount,
        0,
      );
      const componentTotal = moduleResults.reduce(
        (sum, m) => sum + m.totalCount,
        0,
      );

      achievedCriteria += componentAchieved;
      totalCriteria += componentTotal;

      // Credit-weighted across modules within the component, falling back to
      // an even split where a curriculum records no credits.
      const creditTotal = moduleResults.reduce(
        (sum, m) => sum + (m.credits ?? 0),
        0,
      );
      const componentPercent =
        moduleResults.length === 0
          ? 0
          : creditTotal > 0
            ? moduleResults.reduce(
                (sum, m) => sum + ((m.credits ?? 0) / creditTotal) * m.percent,
                0,
              )
            : moduleResults.reduce((sum, m) => sum + m.percent, 0) /
              moduleResults.length;

      componentResults.push({
        component,
        weight: weights[component],
        modules: moduleResults,
        achievedCount: componentAchieved,
        totalCount: componentTotal,
        percent: round(componentPercent),
        complete: componentTotal > 0 && componentAchieved === componentTotal,
      });
    }

    // Components carrying no criteria are dropped from the weighting rather
    // than counted as zero. A qualification with no workplace component should
    // not be capped at 73% for the whole of its existence.
    const present = componentResults.filter((c) => c.totalCount > 0);
    const presentWeight = present.reduce((sum, c) => sum + c.weight, 0);

    const readinessIndex =
      presentWeight > 0
        ? round(
            present.reduce((sum, c) => sum + (c.weight / presentWeight) * c.percent, 0),
          )
        : 0;

    // A module with no criteria cannot be failed, so without this check a
    // half-transcribed curriculum reports every learner eligible: the modules
    // nobody has captured contribute nothing to either total, and the ones
    // that were captured are complete. That is the most dangerous number this
    // file could produce, because it is wrong in the direction of sending
    // somebody to an assessment centre.
    const modulesWithoutCriteria = componentResults
      .flatMap((c) => c.modules)
      .filter((m) => m.totalCount === 0)
      .map((m) => m.code);

    const curriculumComplete =
      modulesWithoutCriteria.length === 0 && totalCriteria > 0;

    return {
      qualificationId: qualification.id,
      qualificationTitle: qualification.title,
      saqaId: qualification.saqaId,
      learner,
      components: componentResults,
      weightSource: source,
      readinessIndex,
      // The gate. Not the index, and not a threshold on it.
      eisaEligible: curriculumComplete && achievedCriteria === totalCriteria,
      achievedCriteria,
      totalCriteria,
      outstanding,
      curriculumComplete,
      modulesWithoutCriteria,
    };
  });
}

function isComponent(value: string): value is Component {
  return value === "knowledge" || value === "practical" || value === "workplace";
}

export type CohortRow = {
  userId: string;
  firstName: string;
  lastName: string;
  qualificationId: string;
  qualificationTitle: string;
  readinessIndex: number;
  eisaEligible: boolean;
  achievedCriteria: number;
  totalCriteria: number;
  outstandingCount: number;
  curriculumComplete: boolean;
};

/**
 * Everybody working towards an accredited qualification, and how far along.
 *
 * The Skills Development Facilitator's view: who can be entered for the next
 * EISA sitting, and who is close enough to be worth pushing. Computed per
 * learner rather than in one query — the arithmetic has enough judgement in it
 * (component weights, topic weights, moderation) that having two
 * implementations would guarantee two different answers.
 */
export async function cohortReadiness(
  session: AuthenticatedSession,
): Promise<CohortRow[]> {
  assertSessionCan(session, "enrolment:read_all");

  const pairs = await withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .selectDistinct({
        userId: enrolments.userId,
        qualificationId: enrolments.qualificationId,
      })
      .from(enrolments)
      .innerJoin(users, eq(users.id, enrolments.userId))
      .where(
        and(
          isNotNull(enrolments.qualificationId),
          eq(users.status, "active"),
        ),
      );

    return rows.filter(
      (row): row is { userId: string; qualificationId: string } =>
        row.qualificationId !== null,
    );
  });

  const results: CohortRow[] = [];

  for (const pair of pairs) {
    const readiness = await qualificationReadiness(
      session,
      pair.qualificationId,
      pair.userId,
    );

    results.push({
      userId: readiness.learner.userId,
      firstName: readiness.learner.firstName,
      lastName: readiness.learner.lastName,
      qualificationId: readiness.qualificationId,
      qualificationTitle: readiness.qualificationTitle,
      readinessIndex: readiness.readinessIndex,
      eisaEligible: readiness.eisaEligible,
      achievedCriteria: readiness.achievedCriteria,
      totalCriteria: readiness.totalCriteria,
      outstandingCount: readiness.outstanding.length,
      curriculumComplete: readiness.curriculumComplete,
    });
  }

  return results.sort(
    (a, b) =>
      Number(b.eisaEligible) - Number(a.eisaEligible) ||
      b.readinessIndex - a.readinessIndex ||
      a.lastName.localeCompare(b.lastName),
  );
}
