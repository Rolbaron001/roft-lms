import { and, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  curriculumModules,
  qualificationModules,
  qualifications,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Part qualifications, and skills programmes harvested from a qualification.
 *
 * One rule holds the whole thing together: there is one curriculum, and a part
 * selects from it. That is not a design preference, it is what the documents
 * say. The curriculum document and the external assessment specification filed
 * under 118710 and 118711 are byte-identical to the ones under 118709 - the
 * same file, three times - and each part's SAQA document lists the parent's own
 * module codes.
 *
 * Everything below follows from it. A part has no curriculum document of its
 * own, because it uses its parent's. Its credits are its selected modules'
 * credits, so they can be checked rather than typed. And a learner's work
 * against a module counts once, wherever they met it, because there is one
 * module.
 */

export class PartQualificationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "not_permitted"
      | "wrong_kind"
      | "not_in_parent"
      | "credits_disagree",
  ) {
    super(message);
    this.name = "PartQualificationError";
  }
}

/**
 * The modules a qualification is assessed against.
 *
 * For a full qualification, the modules of its own curriculum. For a part or a
 * harvested skills programme, the subset it selects from its parent's.
 *
 * Every count in the platform that means "the whole of this qualification"
 * should read this rather than the curriculum directly - readiness, the
 * Statement of Results, completion. Reading the curriculum directly would
 * credit a part-qualified learner with modules they never took.
 */
export async function modulesOf(
  session: AuthenticatedSession,
  qualificationId: string,
) {
  return withTenant(session.organisationId, async (tx) => {
    const [entry] = await tx
      .select({
        id: qualifications.id,
        kind: qualifications.kind,
        parentId: qualifications.parentQualificationId,
      })
      .from(qualifications)
      .where(eq(qualifications.id, qualificationId));

    if (!entry) {
      throw new PartQualificationError("No such qualification.", "not_found");
    }

    if (entry.kind === "full" || !entry.parentId) {
      return tx
        .select()
        .from(curriculumModules)
        .where(eq(curriculumModules.qualificationId, qualificationId))
        .orderBy(curriculumModules.code);
    }

    return tx
      .select({
        id: curriculumModules.id,
        organisationId: curriculumModules.organisationId,
        qualificationId: curriculumModules.qualificationId,
        code: curriculumModules.code,
        title: curriculumModules.title,
        component: curriculumModules.component,
        credits: curriculumModules.credits,
        notionalHours: curriculumModules.notionalHours,
        sortOrder: curriculumModules.sortOrder,
      })
      .from(qualificationModules)
      .innerJoin(
        curriculumModules,
        eq(curriculumModules.id, qualificationModules.curriculumModuleId),
      )
      .where(eq(qualificationModules.qualificationId, qualificationId))
      .orderBy(curriculumModules.code);
  });
}

/**
 * Records which of its parent's modules a part qualification takes.
 *
 * Refuses a module that is not the parent's. A part draws from one curriculum,
 * and a selection reaching outside it is not a part qualification - it is two
 * qualifications wearing one name, and every credit total computed afterwards
 * would be quietly wrong.
 *
 * Replaces the selection rather than adding to it, so re-reading a corrected
 * SAQA document produces the document's subset rather than the union of both
 * readings.
 */
export async function selectModules(
  session: AuthenticatedSession,
  qualificationId: string,
  moduleIds: string[],
) {
  assertSessionCan(session, "qualification:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [entry] = await tx
      .select({
        id: qualifications.id,
        kind: qualifications.kind,
        title: qualifications.title,
        parentId: qualifications.parentQualificationId,
      })
      .from(qualifications)
      .where(eq(qualifications.id, qualificationId));

    if (!entry) {
      throw new PartQualificationError("No such qualification.", "not_found");
    }

    if (entry.kind === "full") {
      throw new PartQualificationError(
        "A full qualification is assessed against its own curriculum, so it does not select modules.",
        "wrong_kind",
      );
    }

    if (!entry.parentId) {
      throw new PartQualificationError(
        "This has no parent qualification to draw modules from. A part qualification is drawn from a full one; a skills programme that stands alone carries its own curriculum instead.",
        "wrong_kind",
      );
    }

    const wanted = [...new Set(moduleIds)];

    const belong = wanted.length
      ? await tx
          .select({ id: curriculumModules.id })
          .from(curriculumModules)
          .where(
            and(
              eq(curriculumModules.qualificationId, entry.parentId),
              inArray(curriculumModules.id, wanted),
            ),
          )
      : [];

    if (belong.length !== wanted.length) {
      throw new PartQualificationError(
        "Some of those modules do not belong to the parent qualification's curriculum. A part qualification can only take modules its parent has.",
        "not_in_parent",
      );
    }

    await tx
      .delete(qualificationModules)
      .where(eq(qualificationModules.qualificationId, qualificationId));

    if (wanted.length > 0) {
      await tx.insert(qualificationModules).values(
        wanted.map((curriculumModuleId) => ({
          organisationId: session.organisationId,
          qualificationId,
          curriculumModuleId,
        })),
      );
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "qualification.modules_selected",
      entityType: "qualification",
      entityId: qualificationId,
      after: { modules: wanted.length },
    });

    return { selected: wanted.length };
  });
}

/**
 * Whether the selected modules add up to what the qualification claims.
 *
 * The SAQA document states a credit total and lists the modules that make it
 * up, and in 118710 they agree exactly: 16 + 14 + 17 = 47. So the platform can
 * check the arithmetic instead of trusting a typed number - which is worth
 * doing, because these documents are known to contradict themselves. The
 * Commercial Cleaner curriculum gives one module four credits in its summary
 * and twelve in the header of its own specification.
 *
 * Reported rather than enforced. A mismatch means somebody should look at the
 * document, not that the platform should refuse to hold what the document says.
 */
export async function creditsAgree(
  session: AuthenticatedSession,
  qualificationId: string,
): Promise<{
  agree: boolean;
  claimed: number | null;
  fromModules: number;
  perComponent: Record<string, number>;
}> {
  const [entry] = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ totalCredits: qualifications.totalCredits })
      .from(qualifications)
      .where(eq(qualifications.id, qualificationId)),
  );

  const modules = await modulesOf(session, qualificationId);

  const perComponent: Record<string, number> = {};
  let fromModules = 0;

  for (const row of modules) {
    const credits = row.credits ?? 0;
    fromModules += credits;
    perComponent[row.component] = (perComponent[row.component] ?? 0) + credits;
  }

  const claimed = entry?.totalCredits ?? null;

  return {
    agree: claimed === null || claimed === fromModules,
    claimed,
    fromModules,
    perComponent,
  };
}

/**
 * The parts drawn from a full qualification, for its own screen.
 *
 * A provider looking at Commercial Cleaner should be able to see that
 * Kitchenette Cleaner and its siblings come out of it, because that is the
 * relationship a learner asks about: what else can I do with what I have done.
 */
export async function partsOf(
  session: AuthenticatedSession,
  qualificationId: string,
) {
  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: qualifications.id,
        title: qualifications.title,
        saqaId: qualifications.saqaId,
        kind: qualifications.kind,
        totalCredits: qualifications.totalCredits,
      })
      .from(qualifications)
      .where(eq(qualifications.parentQualificationId, qualificationId))
      .orderBy(qualifications.title),
  );
}
