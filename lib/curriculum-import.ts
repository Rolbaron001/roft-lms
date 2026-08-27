import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  assessmentCriteria,
  curriculumModules,
  curriculumTopicElements,
  curriculumTopics,
  exitLevelOutcomeCriteria,
  exitLevelOutcomes,
  qualifications,
  studyUnitModules,
  studyUnits,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Loading a curriculum document into the platform.
 *
 * A curriculum document is a fixed, published artefact — 85 pages for the HRM
 * Administrator qualification, a few hundred numbered lines, identical for
 * every provider offering it. Typing that into a form would be days of work
 * per qualification, and every provider in the country would do it again,
 * differently, with different typos. So the shape is a file, transcribed once
 * and checked against the document.
 *
 * Re-running replaces the qualification's structure. That is what you want
 * when the QCTO reissues a curriculum, and it is safe because none of this is
 * learner data: criteria are referenced by assessments and lessons, so those
 * links are preserved by code rather than by identity.
 */

const elementSchema = z.object({
  kind: z.enum([
    "knowledge_topic",
    "practical_activity",
    "applied_knowledge",
    "work_activity",
    "contextual_knowledge",
    "supporting_evidence",
  ]),
  code: z.string().trim().min(1).max(50),
  description: z.string().trim().min(1).max(2000),
});

const topicSchema = z.object({
  code: z.string().trim().min(1).max(50),
  title: z.string().trim().min(1).max(500),
  /** The percentage the document gives this topic. Omit when it gives none. */
  weightPercent: z.number().int().min(0).max(100).optional(),
  elements: z.array(elementSchema).default([]),
  criteria: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(50),
        description: z.string().trim().min(1).max(2000),
      }),
    )
    .default([]),
});

const moduleSchema = z.object({
  component: z.enum(["knowledge", "practical", "workplace", "general"]),
  code: z.string().trim().min(1).max(50),
  title: z.string().trim().min(1).max(500),
  credits: z.number().int().min(0).max(1000).optional(),
  nqfLevel: z.number().int().min(1).max(10).optional(),
  purpose: z.string().trim().max(8000).optional(),
  topics: z.array(topicSchema).default([]),
});

export const curriculumFileSchema = z.object({
  title: z.string().trim().min(3).max(300),
  saqaId: z.string().trim().max(50).optional(),
  curriculumCode: z.string().trim().max(50).optional(),
  ofoCode: z.string().trim().max(50).optional(),
  nqfLevel: z.number().int().min(1).max(10).optional(),
  totalCredits: z.number().int().min(0).max(10_000).optional(),
  assessmentQualityPartner: z.string().trim().max(300).optional(),

  /**
   * Component percentages exactly as the document states them, whole numbers
   * summing to 100. Omit when the document does not state them; readiness then
   * derives from credits and says so, rather than quoting a figure that cannot
   * be found in the document a moderator is holding.
   */
  componentWeights: z
    .object({
      knowledge: z.number().int().min(0).max(100),
      practical: z.number().int().min(0).max(100),
      workplace: z.number().int().min(0).max(100),
    })
    .refine(
      (w) => w.knowledge + w.practical + w.workplace === 100,
      { message: "Component weights must add up to 100." },
    )
    .optional(),

  /**
   * The Exit Level Outcomes published with the qualification, and the
   * Associated Assessment Criteria they are judged against. Distinct from the
   * internal criteria inside modules: the EISA is set against these.
   */
  exitLevelOutcomes: z
    .array(
      z.object({
        number: z.string().trim().min(1).max(20),
        description: z.string().trim().min(3).max(2000),
        credits: z.number().int().min(0).max(1000).optional(),
        nqfLevel: z.number().int().min(1).max(10).optional(),
        criteria: z.array(z.string().trim().min(3).max(2000)).default([]),
      }),
    )
    .default([]),

  /**
   * How the provider delivers it. The curriculum publishes modules; a provider
   * teaches study units, each bundling the Knowledge, Practical and Work
   * Experience modules that serve one Exit Level Outcome.
   */
  studyUnits: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(20),
        title: z.string().trim().min(1).max(300),
        /** The ELO number this serves. Omit for a unit aligned to none. */
        exitLevelOutcome: z.string().trim().max(20).optional(),
        credits: z.number().int().min(0).max(1000).optional(),
        /** Module codes, exactly as they appear in `modules`. */
        modules: z.array(z.string().trim().min(1).max(50)).default([]),
      }),
    )
    .default([]),

  modules: z.array(moduleSchema).min(1),
});

export type CurriculumFile = z.infer<typeof curriculumFileSchema>;

/**
 * What a caller writes. Distinct from CurriculumFile because the schema fills
 * in defaults, so the parsed value has fields required that a hand-written
 * file may omit.
 */
export type CurriculumFileInput = z.input<typeof curriculumFileSchema>;

export type ImportSummary = {
  qualificationId: string;
  created: boolean;
  exitLevelOutcomes: number;
  studyUnits: number;
  modules: number;
  topics: number;
  elements: number;
  criteria: number;
  warnings: string[];
};

/**
 * Checks the file against itself before anything is written.
 *
 * These are the mistakes transcription actually produces: a topic weighting
 * that does not add up, a duplicated code, a module with criteria but nothing
 * to teach. Catching them here means the failure names the line in the file
 * rather than surfacing months later as a readiness figure nobody trusts.
 */
export function inspectCurriculum(input: CurriculumFileInput): string[] {
  // Parsed here so the defaults are applied before anything is counted: a file
  // that omits `topics` is not a file with undefined topics, it is a module
  // with none, and the warnings should say so.
  const file = curriculumFileSchema.parse(input);
  const warnings: string[] = [];

  const statedCredits = file.modules.reduce((sum, m) => sum + (m.credits ?? 0), 0);
  if (file.totalCredits && statedCredits !== file.totalCredits) {
    warnings.push(
      `Module credits add up to ${statedCredits}, but the qualification says ${file.totalCredits}.`,
    );
  }

  const moduleCodes = new Set<string>();
  for (const entry of file.modules) {
    if (moduleCodes.has(entry.code)) {
      warnings.push(`Module code ${entry.code} appears more than once.`);
    }
    moduleCodes.add(entry.code);

    const weighted = entry.topics.filter((t) => t.weightPercent !== undefined);
    if (weighted.length > 0 && weighted.length < entry.topics.length) {
      warnings.push(
        `${entry.code}: some topics carry a percentage and some do not, so all will be treated as equal.`,
      );
    }
    if (weighted.length === entry.topics.length && weighted.length > 0) {
      const total = weighted.reduce((sum, t) => sum + (t.weightPercent ?? 0), 0);
      if (total !== 100) {
        warnings.push(
          `${entry.code}: topic percentages add up to ${total}, not 100.`,
        );
      }
    }

    if (entry.topics.length === 0) {
      warnings.push(`${entry.code} has no topics.`);
    }

    for (const topic of entry.topics) {
      // Work experience modules carry no criteria by design: they are proved
      // by a signed logbook, not by assessment. Warning about it here would
      // train the reader to ignore the warnings that matter.
      if (topic.criteria.length === 0 && entry.component !== "workplace") {
        warnings.push(
          `${entry.code} / ${topic.code} has no internal assessment criteria, so it can never be achieved.`,
        );
      }
      if (topic.elements.length === 0) {
        warnings.push(
          `${entry.code} / ${topic.code} lists nothing to teach, so the Learning Material Matrix cannot check it.`,
        );
      }
    }
  }

  const eloNumbers = new Set(file.exitLevelOutcomes.map((e) => e.number));
  for (const unit of file.studyUnits) {
    if (unit.exitLevelOutcome && !eloNumbers.has(unit.exitLevelOutcome)) {
      warnings.push(
        `${unit.code} is aligned to ELO ${unit.exitLevelOutcome}, which is not listed.`,
      );
    }
    for (const code of unit.modules) {
      if (!moduleCodes.has(code)) {
        warnings.push(`${unit.code} lists module ${code}, which is not listed.`);
      }
    }
  }

  const placed = new Set(file.studyUnits.flatMap((u) => u.modules));
  if (file.studyUnits.length > 0) {
    for (const code of moduleCodes) {
      if (!placed.has(code)) {
        warnings.push(`${code} belongs to no study unit, so it will not be taught.`);
      }
    }
  }

  return warnings;
}

export async function importCurriculum(
  session: AuthenticatedSession,
  input: unknown,
): Promise<ImportSummary> {
  assertSessionCan(session, "qualification:manage");
  const file = curriculumFileSchema.parse(input);
  const warnings = inspectCurriculum(input as CurriculumFileInput);

  return withTenant(session.organisationId, async (tx) => {
    // Matched on the QCTO code, which is the qualification's identity in the
    // national system. Titles get reworded between revisions; the code does not.
    const [existing] = file.curriculumCode
      ? await tx
          .select({ id: qualifications.id })
          .from(qualifications)
          .where(eq(qualifications.curriculumCode, file.curriculumCode))
      : [];

    const weights = file.componentWeights
      ? {
          knowledge: file.componentWeights.knowledge / 100,
          practical: file.componentWeights.practical / 100,
          workplace: file.componentWeights.workplace / 100,
        }
      : null;

    const values = {
      organisationId: session.organisationId,
      title: file.title,
      saqaId: file.saqaId ?? null,
      curriculumCode: file.curriculumCode ?? null,
      ofoCode: file.ofoCode ?? null,
      nqfLevel: file.nqfLevel ?? null,
      totalCredits: file.totalCredits ?? null,
      assessmentQualityPartner: file.assessmentQualityPartner ?? null,
      componentWeights: weights,
      updatedAt: new Date(),
    };

    let qualificationId: string;

    if (existing) {
      await tx
        .update(qualifications)
        .set(values)
        .where(eq(qualifications.id, existing.id));
      qualificationId = existing.id;

      // The modules cascade to topics, elements and criteria. Anything
      // pointing at a criterion — a lesson tag, an assessment item — goes with
      // it, which is why re-importing is a deliberate act rather than
      // something that happens on deploy.
      await tx
        .delete(curriculumModules)
        .where(eq(curriculumModules.qualificationId, existing.id));
    } else {
      const [created] = await tx
        .insert(qualifications)
        .values(values)
        .returning({ id: qualifications.id });
      qualificationId = created.id;
    }

    const moduleIdByCode = new Map<string, string>();
    let topicCount = 0;
    let elementCount = 0;
    let criterionCount = 0;

    for (const [moduleIndex, curriculumModule] of file.modules.entries()) {
      const [createdModule] = await tx
        .insert(curriculumModules)
        .values({
          organisationId: session.organisationId,
          qualificationId,
          component: curriculumModule.component,
          code: curriculumModule.code,
          title: curriculumModule.title,
          description: curriculumModule.purpose ?? null,
          credits: curriculumModule.credits ?? null,
          sortOrder: moduleIndex,
        })
        .returning({ id: curriculumModules.id });

      moduleIdByCode.set(curriculumModule.code, createdModule.id);

      for (const [topicIndex, topic] of curriculumModule.topics.entries()) {
        const [createdTopic] = await tx
          .insert(curriculumTopics)
          .values({
            organisationId: session.organisationId,
            curriculumModuleId: createdModule.id,
            code: topic.code,
            title: topic.title,
            weightPercent: topic.weightPercent ?? null,
            sortOrder: topicIndex,
          })
          .returning({ id: curriculumTopics.id });
        topicCount += 1;

        if (topic.elements.length > 0) {
          await tx.insert(curriculumTopicElements).values(
            topic.elements.map((element, index) => ({
              organisationId: session.organisationId,
              topicId: createdTopic.id,
              kind: element.kind,
              code: element.code,
              description: element.description,
              sortOrder: index,
            })),
          );
          elementCount += topic.elements.length;
        }

        if (topic.criteria.length > 0) {
          await tx.insert(assessmentCriteria).values(
            topic.criteria.map((criterion, index) => ({
              organisationId: session.organisationId,
              curriculumModuleId: createdModule.id,
              topicId: createdTopic.id,
              code: criterion.code,
              description: criterion.description,
              sortOrder: topicIndex * 1000 + index,
            })),
          );
          criterionCount += topic.criteria.length;
        }
      }
    }

    // Exit Level Outcomes, then the study units that serve them. Both hang off
    // the qualification, so replacing the modules above did not remove them —
    // they are cleared explicitly.
    await tx
      .delete(exitLevelOutcomes)
      .where(eq(exitLevelOutcomes.qualificationId, qualificationId));
    await tx
      .delete(studyUnits)
      .where(eq(studyUnits.qualificationId, qualificationId));

    const eloIdByNumber = new Map<string, string>();

    for (const [index, elo] of file.exitLevelOutcomes.entries()) {
      const [created] = await tx
        .insert(exitLevelOutcomes)
        .values({
          organisationId: session.organisationId,
          qualificationId,
          number: elo.number,
          description: elo.description,
          credits: elo.credits ?? null,
          nqfLevel: elo.nqfLevel ?? null,
          sortOrder: index,
        })
        .returning({ id: exitLevelOutcomes.id });

      eloIdByNumber.set(elo.number, created.id);

      if (elo.criteria.length > 0) {
        await tx.insert(exitLevelOutcomeCriteria).values(
          elo.criteria.map((description, order) => ({
            organisationId: session.organisationId,
            exitLevelOutcomeId: created.id,
            description,
            sortOrder: order,
          })),
        );
      }
    }

    for (const [index, unit] of file.studyUnits.entries()) {
      const [created] = await tx
        .insert(studyUnits)
        .values({
          organisationId: session.organisationId,
          qualificationId,
          code: unit.code,
          title: unit.title,
          exitLevelOutcomeId: unit.exitLevelOutcome
            ? (eloIdByNumber.get(unit.exitLevelOutcome) ?? null)
            : null,
          credits: unit.credits ?? null,
          sortOrder: index,
        })
        .returning({ id: studyUnits.id });

      const moduleLinks = unit.modules
        .map((code) => moduleIdByCode.get(code))
        .filter((id): id is string => Boolean(id));

      if (moduleLinks.length > 0) {
        await tx.insert(studyUnitModules).values(
          moduleLinks.map((curriculumModuleId) => ({
            organisationId: session.organisationId,
            studyUnitId: created.id,
            curriculumModuleId,
          })),
        );
      }
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: existing ? "curriculum.reimported" : "curriculum.imported",
      entityType: "qualification",
      entityId: qualificationId,
      after: {
        title: file.title,
        curriculumCode: file.curriculumCode,
        modules: file.modules.length,
        topics: topicCount,
        elements: elementCount,
        criteria: criterionCount,
      },
    });

    return {
      qualificationId,
      created: !existing,
      exitLevelOutcomes: file.exitLevelOutcomes.length,
      studyUnits: file.studyUnits.length,
      modules: file.modules.length,
      topics: topicCount,
      elements: elementCount,
      criteria: criterionCount,
      warnings,
    };
  });
}
