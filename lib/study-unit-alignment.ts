/**
 * Recording what the alignment document says, against a qualification.
 *
 * The reading is next door and pure; this is the half that writes. It creates
 * the study units the document names, records the Exit Level Outcome each one
 * serves, and links the curriculum modules that make it up.
 *
 * That last link is the one that could not be derived from anything else. The
 * curriculum document publishes modules and says nothing about study units,
 * because a study unit is the provider's own grouping of those modules to
 * serve one outcome — two providers may group the same qualification
 * differently and both be right. Until this document is read, a study unit
 * created from a filename is a label with material hanging off it and no idea
 * what it covers.
 *
 * Additive. It creates what is missing and updates what it names, and removes
 * nothing: a study unit built by hand before the document arrived keeps its
 * material, and a module linked to a unit the document does not mention stays
 * linked. A provider's own work is not something an import should quietly
 * undo.
 */
import { and, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  curriculumModules,
  exitLevelOutcomeCriteria,
  exitLevelOutcomes,
  qualificationModules,
  qualifications,
  studyUnitModules,
  studyUnits,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { readAlignmentDocument } from "./alignment-document";
import { normaliseCode, resolveCode } from "./module-codes";
import { moduleCodeAliasesFor } from "./module-code-settings";
import { assertSessionCan, type AuthenticatedSession } from "./session";

export type AlignmentApplied = {
  studyUnitsCreated: number;
  studyUnitsUpdated: number;
  outcomesRecorded: number;
  modulesLinked: number;
  /** What the document named that the curriculum does not have. */
  notes: string[];
};

export async function applyAlignmentDocument(
  session: AuthenticatedSession,
  qualificationId: string,
  text: string,
): Promise<AlignmentApplied> {
  assertSessionCan(session, "qualification:manage");

  const reading = readAlignmentDocument(text);

  // This tenant's own spellings, read once before the transaction rather than
  // per module. Empty until somebody has confirmed a table in Settings, and an
  // empty table leaves the exact and punctuation-insensitive matches exactly
  // as they were.
  const aliases = await moduleCodeAliasesFor(session);

  const applied: AlignmentApplied = {
    studyUnitsCreated: 0,
    studyUnitsUpdated: 0,
    outcomesRecorded: 0,
    modulesLinked: 0,
    notes: [...reading.notes],
  };

  await withTenant(session.organisationId, async (tx) => {
    /*
     * The modules to match against.
     *
     * A part qualification selects from its parent's curriculum rather than
     * holding one, so the codes in its alignment document belong to the
     * parent. Looking only at modules owned by this qualification would find
     * none of them and report a perfectly good document as unmatched.
     */
    const [qualification] = await tx
      .select({ parentId: qualifications.parentQualificationId })
      .from(qualifications)
      .where(eq(qualifications.id, qualificationId));

    const owners = [qualificationId, qualification?.parentId].filter(
      (id): id is string => Boolean(id),
    );

    const modules = await tx
      .select({ id: curriculumModules.id, code: curriculumModules.code })
      .from(curriculumModules)
      .where(inArray(curriculumModules.qualificationId, owners));

    /*
     * Matched three ways, in order, and the order is the safety.
     *
     * Exactly, first: the code as the curriculum holds it.
     *
     * Then without punctuation, because the alignment document writes KM-01
     * and the curriculum document writes KM01. That was already here and
     * covers the easy third of it.
     *
     * Then through this tenant's own table of spellings, which is what crosses
     * a dropped leading zero or a shortened prefix - the failure that took all
     * fifteen modules of 121151 at once on 21 September. The table is
     * generated, shown and confirmed by a person in Settings; it is empty
     * until then, and an empty table changes nothing about the two steps
     * above. See lib/module-codes.ts.
     */
    const moduleByCode = new Map(
      modules.map((one) => [normaliseCode(one.code), one.id]),
    );

    const known = modules.map((one) => one.code);
    const findModule = (code: string): string | undefined => {
      const direct = moduleByCode.get(normaliseCode(code));
      if (direct) return direct;

      const resolved = resolveCode(code, known, aliases);
      return resolved ? moduleByCode.get(resolved) : undefined;
    };

    /** Codes the document names that the curriculum does not hold. */
    const unmatched: string[] = [];

    for (const [index, unit] of reading.studyUnits.entries()) {
      // --- the outcome it serves ------------------------------------------
      let outcomeId: string | null = null;

      if (unit.outcome) {
        const number = String(unit.outcome.number);

        const [existing] = await tx
          .select({ id: exitLevelOutcomes.id })
          .from(exitLevelOutcomes)
          .where(
            and(
              eq(exitLevelOutcomes.qualificationId, qualificationId),
              eq(exitLevelOutcomes.number, number),
            ),
          );

        if (existing) {
          outcomeId = existing.id;
          await tx
            .update(exitLevelOutcomes)
            .set({
              description: unit.outcome.description || undefined,
              credits: unit.outcome.credits,
              nqfLevel: unit.outcome.nqfLevel,
            })
            .where(eq(exitLevelOutcomes.id, existing.id));
        } else {
          const [created] = await tx
            .insert(exitLevelOutcomes)
            .values({
              organisationId: session.organisationId,
              qualificationId,
              number,
              description: unit.outcome.description || unit.title,
              credits: unit.outcome.credits,
              nqfLevel: unit.outcome.nqfLevel,
              sortOrder: index,
            })
            .returning({ id: exitLevelOutcomes.id });
          outcomeId = created.id;
        }

        applied.outcomesRecorded += 1;

        /*
         * The associated criteria are replaced rather than added to.
         *
         * Unlike everything else here, these are a list the document owns
         * outright: they are the outcome's own wording, and a second upload of
         * a corrected document has to be able to correct them rather than
         * appending a second copy beside the first.
         */
        if (unit.outcome.criteria.length > 0) {
          await tx
            .delete(exitLevelOutcomeCriteria)
            .where(eq(exitLevelOutcomeCriteria.exitLevelOutcomeId, outcomeId));

          await tx.insert(exitLevelOutcomeCriteria).values(
            unit.outcome.criteria.map((description, order) => ({
              organisationId: session.organisationId,
              exitLevelOutcomeId: outcomeId!,
              description,
              sortOrder: order,
            })),
          );
        }
      }

      // --- the study unit itself -------------------------------------------
      const [held] = await tx
        .select({ id: studyUnits.id, title: studyUnits.title })
        .from(studyUnits)
        .where(
          and(
            eq(studyUnits.qualificationId, qualificationId),
            eq(studyUnits.code, unit.code),
          ),
        );

      let studyUnitId: string;

      if (held) {
        studyUnitId = held.id;
        await tx
          .update(studyUnits)
          .set({
            // A unit created from a filename is called "Study Unit 3". The
            // document knows it is "Operationalising L&D".
            title: unit.title || held.title,
            exitLevelOutcomeId: outcomeId ?? undefined,
            sortOrder: index,
          })
          .where(eq(studyUnits.id, held.id));
        applied.studyUnitsUpdated += 1;
      } else {
        const [created] = await tx
          .insert(studyUnits)
          .values({
            organisationId: session.organisationId,
            qualificationId,
            code: unit.code,
            title: unit.title || unit.code,
            exitLevelOutcomeId: outcomeId,
            sortOrder: index,
          })
          .returning({ id: studyUnits.id });
        studyUnitId = created.id;
        applied.studyUnitsCreated += 1;
      }

      // --- the modules it covers -------------------------------------------
      for (const code of unit.moduleCodes) {
        const moduleId = findModule(code);

        if (!moduleId) {
          /*
           * Collected, not reported one at a time.
           *
           * Roland, 21 September, looking at fifteen of these in a row: every
           * module of a fifteen-module qualification failed to match, and the
           * message repeated the same sentence fifteen times without once
           * saying what the curriculum's codes actually are. Fifteen lines
           * that each say "KM01 is not there" cannot be told apart from one
           * line saying it, and neither tells you what IS there - which is the
           * only fact that identifies the problem.
           *
           * So they are gathered and summarised below, alongside the codes the
           * curriculum holds.
           */
          unmatched.push(code);
          continue;
        }

        const [already] = await tx
          .select({ id: studyUnitModules.id })
          .from(studyUnitModules)
          .where(
            and(
              eq(studyUnitModules.studyUnitId, studyUnitId),
              eq(studyUnitModules.curriculumModuleId, moduleId),
            ),
          );

        if (already) continue;

        await tx.insert(studyUnitModules).values({
          organisationId: session.organisationId,
          studyUnitId,
          curriculumModuleId: moduleId,
        });
        applied.modulesLinked += 1;

        /*
         * A part qualification also has to select the module, or it is linked
         * to a study unit it does not formally take. Only for a part: a full
         * qualification owns its curriculum outright and selects nothing.
         */
        if (qualification?.parentId) {
          const [selected] = await tx
            .select({ id: qualificationModules.id })
            .from(qualificationModules)
            .where(
              and(
                eq(qualificationModules.qualificationId, qualificationId),
                eq(qualificationModules.curriculumModuleId, moduleId),
              ),
            );

          if (!selected) {
            await tx.insert(qualificationModules).values({
              organisationId: session.organisationId,
              qualificationId,
              curriculumModuleId: moduleId,
            });
          }
        }
      }
    }

    /*
     * One note for the lot, and it says what the curriculum actually holds.
     *
     * The codes matter more than the count. Matching is done without
     * punctuation or spaces - the alignment document writes KM-01 and the
     * curriculum writes KM01 - so a failure here is almost always a genuinely
     * different naming scheme, and the two lists side by side identify it in
     * one glance. Without them, "KM01 is not in this curriculum" is true and
     * useless, because the reader cannot see what to compare it against.
     */
    if (unmatched.length > 0) {
      const wanted = [...new Set(unmatched)];
      const held = modules
        .map((one) => one.code)
        .sort((a, b) => a.localeCompare(b));

      applied.notes.push(
        held.length === 0
          ? `The document names ${wanted.length} modules (${wanted.join(", ")}) and this qualification has no curriculum yet. Import the curriculum first; the study units and their outcomes are recorded either way, and uploading this document again afterwards will link them.`
          : applied.modulesLinked === 0
            ? `None of the ${wanted.length} modules this document names could be matched, so nothing has been placed under a study unit. The document names ${wanted.join(", ")}. This curriculum holds ${held.join(", ")}. Matching ignores spaces and hyphens, so the two schemes genuinely differ - correct the codes on either side and upload the document again.`
            : `${wanted.length} of the modules this document names could not be matched: ${wanted.join(", ")}. This curriculum holds ${held.join(", ")}. Everything else was linked.`,
      );
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "qualification.alignment_applied",
      entityType: "qualification",
      entityId: qualificationId,
      after: {
        studyUnitsCreated: applied.studyUnitsCreated,
        studyUnitsUpdated: applied.studyUnitsUpdated,
        outcomesRecorded: applied.outcomesRecorded,
        modulesLinked: applied.modulesLinked,
      },
    });
  });

  return applied;
}
