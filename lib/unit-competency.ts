import { and, eq } from "drizzle-orm";
import type { TenantDatabase } from "@/db/client";
import {
  competencies,
  competencyFrameworks,
  courseCompetencies,
  courses,
  exitLevelOutcomes,
  qualifications,
  studyUnits,
} from "@/db/schema";

/**
 * The competency a study unit's course attests to.
 *
 * Roland, 27 September (W5): all learning covers a competency that is
 * achieved, accredited or not, or there is no purpose to it. The rule stays.
 * What the walk of 26 September found wrong was the list a study unit's course
 * was offered: on Acme it was plant safety and equipment diagnosis, which have
 * nothing to do with an HR qualification, and nothing on the page connected
 * the two.
 *
 * A study unit already says what it achieves. The curriculum names an Exit
 * Level Outcome for each, and the alignment document places each unit against
 * one, so that outcome is the competency. A unit serving no outcome, which
 * happens (SU1 of the HRM Administrator programme is an introduction), stands
 * as its own.
 *
 * Kept in a framework named after the qualification and made once, so every
 * unit of one qualification shares it and a second import finds it rather
 * than adding another. Found by `source`, which the framework records as the
 * qualification it came from, not by name: a provider may rename it.
 */
export async function ensureStudyUnitCompetency(
  tx: TenantDatabase,
  organisationId: string,
  courseId: string,
): Promise<string | null> {
  const [unit] = await tx
    .select({
      id: studyUnits.id,
      code: studyUnits.code,
      title: studyUnits.title,
      qualificationId: studyUnits.qualificationId,
      qualificationTitle: qualifications.title,
      eloId: exitLevelOutcomes.id,
      eloNumber: exitLevelOutcomes.number,
      eloDescription: exitLevelOutcomes.description,
    })
    .from(courses)
    .innerJoin(studyUnits, eq(studyUnits.id, courses.studyUnitId))
    .innerJoin(qualifications, eq(qualifications.id, studyUnits.qualificationId))
    .leftJoin(exitLevelOutcomes, eq(exitLevelOutcomes.id, studyUnits.exitLevelOutcomeId))
    .where(eq(courses.id, courseId));

  if (!unit) return null;

  const source = `qualification:${unit.qualificationId}`;
  let [framework] = await tx
    .select({ id: competencyFrameworks.id })
    .from(competencyFrameworks)
    .where(
      and(
        eq(competencyFrameworks.organisationId, organisationId),
        eq(competencyFrameworks.source, source),
      ),
    )
    .limit(1);

  if (!framework) {
    [framework] = await tx
      .insert(competencyFrameworks)
      .values({
        organisationId,
        name: unit.qualificationTitle,
        description:
          "What each study unit of this qualification achieves: its exit level outcome, or the unit itself where it serves none. Made by the platform from the qualification's own documents.",
        source,
      })
      .returning({ id: competencyFrameworks.id });
  }

  const outcome =
    unit.eloId && unit.eloDescription
      ? { id: unit.eloId, number: unit.eloNumber, description: unit.eloDescription }
      : null;
  const code = outcome ? `ELO ${outcome.number}` : unit.code;
  const name = outcome
    ? outcome.description.length > 200
      ? `${outcome.description.slice(0, 197).trimEnd()}...`
      : outcome.description
    : `${unit.code} ${unit.title}`.trim();

  await tx
    .insert(competencies)
    .values({
      organisationId,
      frameworkId: framework.id,
      code,
      name,
      description: outcome?.description ?? null,
      externalReference: outcome?.id ?? unit.id,
    })
    .onConflictDoNothing();

  const [competency] = await tx
    .select({ id: competencies.id })
    .from(competencies)
    .where(and(eq(competencies.frameworkId, framework.id), eq(competencies.code, code)));

  await tx
    .insert(courseCompetencies)
    .values({ organisationId, courseId, competencyId: competency.id })
    .onConflictDoNothing();

  return competency.id;
}
