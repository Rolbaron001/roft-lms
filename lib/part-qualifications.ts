import { and, eq, inArray, sql as dbSql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  curriculumModules,
  enrolments,
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
      | "credits_disagree"
      | "in_use"
      | "would_orphan",
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
 * The condition to put on a `curriculumModules` query so it means "the modules
 * this qualification is assessed against".
 *
 * There are two dozen places that ask a qualification for its modules, and the
 * naive query - `where qualification_id = ?` - is right for a full
 * qualification and silently empty for a part. Silently is the problem: a part
 * reports no modules, no criteria and nothing to be assessed on, which looks
 * like a qualification nobody has finished setting up rather than a bug.
 *
 * So this returns the condition rather than the rows, and can be dropped into
 * an existing query without restructuring it. Takes the qualification's own
 * `parentQualificationId`, which the caller usually has already.
 */
export function modulesOfCondition(
  qualificationId: string,
  parentQualificationId: string | null,
) {
  if (!parentQualificationId) {
    return eq(curriculumModules.qualificationId, qualificationId);
  }

  return dbSql`${curriculumModules.id} in (
    select qm.curriculum_module_id from qualification_modules qm
    where qm.qualification_id = ${qualificationId}
  )`;
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

/** What reclassifying a qualification would do, said before it is done. */
export type Reclassification = {
  from: "full" | "part" | "skills_programme";
  to: "full" | "part" | "skills_programme";
  /** Modules of its own curriculum, which a part does not have. */
  ownModules: number;
  /** Modules it selects from a parent, which a full qualification does not. */
  selectedModules: number;
  /** Learners enrolled on it. Any at all, and it cannot be reclassified. */
  enrolled: number;
};

/**
 * Changing what a qualification is, after it has been created.
 *
 * Until now the kind and the parent were settable only at import, so a
 * qualification imported as full that should have been a part had to be
 * deleted and done again - taking its documents and anything already built on
 * it with it. Heidi is about to import several for the first time, and
 * "imported it as the wrong kind" is the most ordinary mistake there is.
 *
 * The line this will not cross is enrolment. Enrolment is per programme ID,
 * and a learner is enrolled on this qualification as it is: changing a full
 * qualification into a part changes which modules they are assessed against,
 * and therefore what they have to do to complete. That is not a correction, it
 * is a different programme, and the platform refuses rather than quietly
 * moving the goalposts under somebody mid-study.
 *
 * Everything else is allowed and reported rather than forbidden. A part that
 * still holds modules of its own curriculum is a real state of affairs - it
 * was imported as a full qualification and had one - and refusing to record
 * the correction because the consequence is untidy would leave the wrong
 * answer in place, which is worse.
 */
export async function planReclassification(
  session: AuthenticatedSession,
  qualificationId: string,
): Promise<Reclassification> {
  assertSessionCan(session, "qualification:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [entry] = await tx
      .select({ kind: qualifications.kind })
      .from(qualifications)
      .where(eq(qualifications.id, qualificationId));

    if (!entry) {
      throw new PartQualificationError(
        "That qualification is not here.",
        "not_found",
      );
    }

    const own = await tx
      .select({ id: curriculumModules.id })
      .from(curriculumModules)
      .where(eq(curriculumModules.qualificationId, qualificationId));

    const selected = await tx
      .select({ id: qualificationModules.id })
      .from(qualificationModules)
      .where(eq(qualificationModules.qualificationId, qualificationId));

    const enrolled = await tx
      .select({ id: enrolments.id })
      .from(enrolments)
      .where(eq(enrolments.qualificationId, qualificationId));

    return {
      from: entry.kind,
      to: entry.kind,
      ownModules: own.length,
      selectedModules: selected.length,
      enrolled: enrolled.length,
    };
  });
}

export async function reclassify(
  session: AuthenticatedSession,
  qualificationId: string,
  input: {
    kind: "full" | "part" | "skills_programme";
    /** Required for a part or a skills programme; ignored for a full one. */
    parentId?: string | null;
  },
): Promise<Reclassification> {
  assertSessionCan(session, "qualification:manage");

  const plan = await planReclassification(session, qualificationId);

  if (plan.enrolled > 0) {
    throw new PartQualificationError(
      `${plan.enrolled} ${plan.enrolled === 1 ? "learner is" : "learners are"} enrolled on this qualification, so what it is cannot be changed underneath them. Enrolment is per programme ID: create the right one and enrol them onto that.`,
      "in_use",
    );
  }

  const wantsParent = input.kind !== "full";
  const parentId = wantsParent ? (input.parentId ?? null) : null;

  if (wantsParent && !parentId) {
    throw new PartQualificationError(
      "A part qualification or skills programme draws its modules from a parent, so it needs one named.",
      "wrong_kind",
    );
  }

  if (parentId === qualificationId) {
    throw new PartQualificationError(
      "A qualification cannot be a part of itself.",
      "wrong_kind",
    );
  }

  if (parentId) {
    const [parent] = await withTenant(session.organisationId, (tx) =>
      tx
        .select({ kind: qualifications.kind })
        .from(qualifications)
        .where(eq(qualifications.id, parentId)),
    );

    if (!parent) {
      throw new PartQualificationError(
        "That parent qualification is not here.",
        "not_found",
      );
    }

    // One level, deliberately. A part of a part has no meaning in the
    // documents: each part's SAQA document lists the full qualification's own
    // module codes.
    if (parent.kind !== "full") {
      throw new PartQualificationError(
        "A part draws from a full qualification. The one named is itself a part.",
        "wrong_kind",
      );
    }
  }

  return withTenant(session.organisationId, async (tx) => {
    await tx
      .update(qualifications)
      .set({ kind: input.kind, parentQualificationId: parentId })
      .where(eq(qualifications.id, qualificationId));

    // A full qualification selects nothing from anybody. Left behind, those
    // rows would keep counting towards its credits.
    let cleared = 0;
    if (input.kind === "full" && plan.selectedModules > 0) {
      await tx
        .delete(qualificationModules)
        .where(eq(qualificationModules.qualificationId, qualificationId));
      cleared = plan.selectedModules;
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "qualification.reclassified",
      entityType: "qualification",
      entityId: qualificationId,
      before: { kind: plan.from },
      after: {
        kind: input.kind,
        parentQualificationId: parentId,
        selectionsCleared: cleared,
      },
    });

    return {
      ...plan,
      to: input.kind,
      selectedModules: plan.selectedModules - cleared,
    };
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
