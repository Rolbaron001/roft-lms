import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  assessmentCriteria,
  assessmentDecisions,
  assessmentSubmissions,
  curriculumModules,
  curriculumTopicElements,
  curriculumTopics,
  enrolments,
  moderationRecords,
  qualifications,
  users,
  workplaceLogbookEntries,
  workplaceLogbooks,
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

/**
 * How a module is proved.
 *
 * Knowledge and practical modules carry Internal Assessment Criteria and are
 * proved by achieving all of them. Work experience modules carry none: the
 * QCTO curriculum defines work activities, contextual knowledge and supporting
 * evidence, and the proof is a logbook signed by the workplace coach and
 * accepted by an assessor. Counting criteria for a work experience module
 * therefore counts zero out of zero forever.
 */
export type EvidenceRoute = "criteria" | "logbook";

export type ModuleReadiness = {
  moduleId: string;
  code: string;
  title: string;
  component: Component;
  credits: number | null;
  route: EvidenceRoute;
  topics: TopicReadiness[];
  achievedCount: number;
  totalCount: number;
  /** Weighted by topic, so a module is not 90% done because its small topics are. */
  percent: number;
  complete: boolean;
  /**
   * When the last outstanding criterion in this module was achieved, or when
   * the assessor accepted the logbook. The Statement of Results has to carry a
   * date per module, and this is it. Null until the module is complete.
   */
  competenceAchievedAt: Date | null;
  /** Present for a work experience module: where its logbook has got to. */
  logbook: {
    id: string;
    status: string;
    coachSignedAt: Date | null;
  } | null;
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

    const topicElementRows = topics.length
      ? await tx
          .select({
            topicId: curriculumTopicElements.topicId,
            id: curriculumTopicElements.id,
          })
          .from(curriculumTopicElements)
          .where(
            inArray(
              curriculumTopicElements.topicId,
              topics.map((topic) => topic.id),
            ),
          )
      : [];

    const topicElementCounts = new Map<string, number>();
    for (const row of topicElementRows) {
      topicElementCounts.set(
        row.topicId,
        (topicElementCounts.get(row.topicId) ?? 0) + 1,
      );
    }

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

    // Work experience is proved by a signed logbook, not by criteria. Both the
    // requirements the curriculum lists and the learner's progress against them
    // are read here so a workplace module can report something truthful.
    const logbooks = moduleIds.length
      ? await tx
          .select({
            id: workplaceLogbooks.id,
            curriculumModuleId: workplaceLogbooks.curriculumModuleId,
            status: workplaceLogbooks.status,
            coachSignedAt: workplaceLogbooks.coachSignedAt,
            acceptedAt: workplaceLogbooks.acceptedAt,
          })
          .from(workplaceLogbooks)
          .where(
            and(
              eq(workplaceLogbooks.learnerId, userId),
              inArray(workplaceLogbooks.curriculumModuleId, moduleIds),
            ),
          )
      : [];

    const logbookProgress = logbooks.length
      ? await tx
          .select({
            logbookId: workplaceLogbookEntries.logbookId,
            completed: workplaceLogbookEntries.completed,
          })
          .from(workplaceLogbookEntries)
          .where(
            inArray(
              workplaceLogbookEntries.logbookId,
              logbooks.map((entry) => entry.id),
            ),
          )
      : [];

    // Counted per module so a workplace module with requirements captured is
    // distinguishable from one nobody has transcribed yet.
    const elementCounts = new Map<string, number>();
    for (const topic of topics) {
      const forTopic = topicElementCounts.get(topic.id) ?? 0;
      elementCounts.set(
        topic.curriculumModuleId,
        (elementCounts.get(topic.curriculumModuleId) ?? 0) + forTopic,
      );
    }

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

        // A work experience module carries no Internal Assessment Criteria; the
        // QCTO curriculum gives it work activities, contextual knowledge and
        // supporting evidence instead, and the proof is a logbook signed by the
        // workplace coach and accepted by an assessor. Counting criteria for
        // one would count zero out of zero for ever, so it is never complete
        // and the learner is never eligible.
        const route: EvidenceRoute =
          component === "workplace" && moduleTotal === 0 ? "logbook" : "criteria";

        const logbook = logbooks.find(
          (entry) => entry.curriculumModuleId === curriculumModule.id,
        );

        let complete: boolean;
        let weighted = weightedPercent;
        let dates: Date[];

        if (route === "logbook") {
          const entries = logbook
            ? logbookProgress.filter((row) => row.logbookId === logbook.id)
            : [];
          const done = entries.filter((row) => row.completed).length;

          // Progress is what the learner has recorded; completion is what the
          // assessor accepted. A logbook can be 100 per cent recorded and still
          // not signed, and that gap is the whole point of the sign-off.
          weighted =
            entries.length > 0 ? done / entries.length : 0;
          complete = logbook?.status === "accepted_by_assessor";
          dates = logbook?.acceptedAt ? [logbook.acceptedAt] : [];

          // Said in the same list as an outstanding criterion, because to the
          // facilitator planning next month it is the same kind of fact: a
          // thing standing between this learner and the EISA.
          if (!complete) {
            outstanding.push({
              component,
              moduleCode: curriculumModule.code,
              moduleTitle: curriculumModule.title,
              criterionCode: "Logbook",
              description: !logbook
                ? "No work experience logbook has been opened."
                : logbook.status === "coach_signed"
                  ? "Signed by the workplace coach, waiting for an assessor to accept it."
                  : logbook.status === "submitted_to_coach"
                    ? "With the workplace coach for signature."
                    : logbook.status === "returned_by_coach"
                      ? "Returned by the workplace coach for more evidence."
                      : `${done} of ${entries.length} requirements recorded; not yet submitted to the coach.`,
            });
          }
        } else {
          complete = moduleTotal > 0 && moduleAchieved === moduleTotal;
          dates = topicResults
            .flatMap((t) => t.criteria)
            .map((c) => c.achievedAt)
            .filter((d): d is Date => d !== null);
        }

        return {
          moduleId: curriculumModule.id,
          code: curriculumModule.code,
          title: curriculumModule.title,
          component,
          credits: curriculumModule.credits,
          topics: topicResults,
          achievedCount: moduleAchieved,
          totalCount: moduleTotal,
          route,
          percent: round(weighted * 100),
          complete,
          logbook: logbook
            ? {
                id: logbook.id,
                status: logbook.status,
                coachSignedAt: logbook.coachSignedAt,
              }
            : null,
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
        // Every module of the component, whichever way each is proved. Summing
        // criteria alone would call a component complete while its work
        // experience logbooks sat unsigned.
        complete: moduleResults.length > 0 && moduleResults.every((m) => m.complete),
      });
    }

    // Components carrying no criteria are dropped from the weighting rather
    // than counted as zero. A qualification with no workplace component should
    // not be capped at 73% for the whole of its existence.
    // A component is "present" if it has modules at all, not if it has
    // criteria. Work experience has none by design, and dropping it from the
    // weighting would silently redistribute its 27 per cent to the others.
    const present = componentResults.filter((c) => c.modules.length > 0);
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
    // A module nobody has transcribed has neither criteria nor requirements.
    // A work experience module with requirements captured is not missing
    // anything: it is simply proved a different way.
    const modulesWithoutCriteria = componentResults
      .flatMap((c) => c.modules)
      .filter(
        (m) =>
          m.totalCount === 0 &&
          (m.route !== "logbook" || (elementCounts.get(m.moduleId) ?? 0) === 0),
      )
      .map((m) => m.code);

    const allModules = componentResults.flatMap((c) => c.modules);

    const curriculumComplete =
      modulesWithoutCriteria.length === 0 && allModules.length > 0;

    return {
      qualificationId: qualification.id,
      qualificationTitle: qualification.title,
      saqaId: qualification.saqaId,
      learner,
      components: componentResults,
      weightSource: source,
      readinessIndex,
      // The gate. Not the index, and not a threshold on it.
      // Every criterion achieved and every work experience logbook accepted.
      // The qualification document requires all internal assessment criteria
      // for all modules; for work experience the Statement of Work Experience
      // is what stands in their place, so both routes must be satisfied.
      eisaEligible:
        curriculumComplete && allModules.every((module) => module.complete),
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
