import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  curriculumModules,
  curriculumTopicElements,
  curriculumTopics,
  evidenceArtifacts,
  qualifications,
  userRoles,
  users,
  workplaceAgreements,
  workplaceLogbookEntries,
  workplaceLogbooks,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Work Integrated Learning: the workplace agreement, the logbook, and the
 * coach's sign-off.
 *
 * A work experience module is not assessed by the provider watching. The
 * learner does real work at a real employer, and somebody there — the
 * Workplace Coach — attests that they did it. The curriculum says so plainly:
 * "the supervisor must provide coaching and must sign the logbook indicating
 * that the learner has gained adequate exposure and demonstrated the ability
 * to apply the specific skills."
 *
 * Three rules run through everything here, and each exists because an external
 * verifier checks it:
 *
 *   1. The coach is not the learner. Enforced by a database trigger, not just
 *      by this file.
 *   2. The order is learner, then coach, then assessor. A logbook cannot reach
 *      an assessor unsigned, and a learner cannot edit one after it is signed.
 *   3. Nothing is signed off that is not complete. Every work activity ticked,
 *      every required piece of supporting evidence supplied.
 */

export class WorkplaceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "not_permitted"
      | "invalid_state"
      | "incomplete",
  ) {
    super(message);
    this.name = "WorkplaceError";
  }
}

/**
 * The kinds of curriculum line a logbook is built from.
 *
 * Work activities are what the learner does; contextual knowledge is what they
 * must be able to speak to; supporting evidence is what the workplace has to
 * produce. All three appear in the sign-off document, and all three are
 * generated from the curriculum rather than typed, so a logbook cannot quietly
 * omit a requirement.
 */
const LOGBOOK_ELEMENT_KINDS = [
  "work_activity",
  "contextual_knowledge",
  "supporting_evidence",
] as const;

export const agreementInput = z.object({
  learnerId: z.string().uuid(),
  coachId: z.string().uuid(),
  qualificationId: z.string().uuid().optional(),
  employerName: z.string().trim().min(2).max(300),
  employerAddress: z.string().trim().max(1000).optional(),
  coachDesignation: z.string().trim().max(200).optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
});

export type AgreementInput = z.input<typeof agreementInput>;

export async function createAgreement(
  session: AuthenticatedSession,
  input: AgreementInput,
) {
  assertSessionCan(session, "workplace:manage");
  const parsed = agreementInput.parse(input);

  if (parsed.learnerId === parsed.coachId) {
    throw new WorkplaceError(
      "A learner cannot be their own workplace coach.",
      "not_permitted",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const people = await tx
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        jobTitle: users.jobTitle,
      })
      .from(users)
      .where(inArray(users.id, [parsed.learnerId, parsed.coachId]));

    const coach = people.find((person) => person.id === parsed.coachId);
    const learner = people.find((person) => person.id === parsed.learnerId);

    if (!coach || !learner) {
      throw new WorkplaceError("Learner or coach not found.", "not_found");
    }

    const [created] = await tx
      .insert(workplaceAgreements)
      .values({
        organisationId: session.organisationId,
        learnerId: parsed.learnerId,
        coachId: parsed.coachId,
        qualificationId: parsed.qualificationId ?? null,
        employerName: parsed.employerName,
        employerAddress: parsed.employerAddress ?? null,
        // Copied, not only referenced. People change employers and job titles;
        // the agreement has to keep saying who signed and in what capacity.
        coachName: `${coach.firstName} ${coach.lastName}`,
        coachDesignation: parsed.coachDesignation ?? coach.jobTitle ?? null,
        coachEmail: coach.email,
        startDate: parsed.startDate ? new Date(parsed.startDate) : null,
        endDate: parsed.endDate ? new Date(parsed.endDate) : null,
        createdById: session.userId,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "workplace_agreement.created",
      entityType: "workplace_agreement",
      entityId: created.id,
      after: {
        learnerId: parsed.learnerId,
        coachId: parsed.coachId,
        employerName: parsed.employerName,
      },
    });

    return created;
  });
}

/**
 * Opens a logbook for one work experience module, generating a line for every
 * requirement the curriculum states.
 */
export async function openLogbook(
  session: AuthenticatedSession,
  agreementId: string,
  curriculumModuleId: string,
) {
  assertSessionCan(session, "workplace:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [agreement] = await tx
      .select()
      .from(workplaceAgreements)
      .where(eq(workplaceAgreements.id, agreementId));

    if (!agreement) {
      throw new WorkplaceError("Agreement not found.", "not_found");
    }

    const [module] = await tx
      .select({
        id: curriculumModules.id,
        component: curriculumModules.component,
        code: curriculumModules.code,
      })
      .from(curriculumModules)
      .where(eq(curriculumModules.id, curriculumModuleId));

    if (!module) {
      throw new WorkplaceError("Module not found.", "not_found");
    }

    if (module.component !== "workplace") {
      throw new WorkplaceError(
        `${module.code} is not a work experience module, so it has no logbook.`,
        "invalid_state",
      );
    }

    const elements = await tx
      .select({ id: curriculumTopicElements.id })
      .from(curriculumTopicElements)
      .innerJoin(
        curriculumTopics,
        eq(curriculumTopics.id, curriculumTopicElements.topicId),
      )
      .where(
        and(
          eq(curriculumTopics.curriculumModuleId, curriculumModuleId),
          inArray(curriculumTopicElements.kind, [...LOGBOOK_ELEMENT_KINDS]),
        ),
      );

    if (elements.length === 0) {
      throw new WorkplaceError(
        `${module.code} has no work activities recorded, so a logbook would attest to nothing. Import the curriculum for this module first.`,
        "invalid_state",
      );
    }

    const [logbook] = await tx
      .insert(workplaceLogbooks)
      .values({
        organisationId: session.organisationId,
        agreementId,
        learnerId: agreement.learnerId,
        curriculumModuleId,
      })
      .returning();

    await tx.insert(workplaceLogbookEntries).values(
      elements.map((element) => ({
        organisationId: session.organisationId,
        logbookId: logbook.id,
        topicElementId: element.id,
      })),
    );

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "workplace_logbook.opened",
      entityType: "workplace_logbook",
      entityId: logbook.id,
      after: { module: module.code, entries: elements.length },
    });

    return logbook;
  });
}

async function loadLogbook(tx: TenantDatabase, logbookId: string) {
  const [logbook] = await tx
    .select()
    .from(workplaceLogbooks)
    .where(eq(workplaceLogbooks.id, logbookId));

  if (!logbook) {
    throw new WorkplaceError("Logbook not found.", "not_found");
  }

  const [agreement] = await tx
    .select()
    .from(workplaceAgreements)
    .where(eq(workplaceAgreements.id, logbook.agreementId));

  return { logbook, agreement };
}

/**
 * The logbook as a person reads it: the curriculum's own lines, grouped, with
 * what has been done against each.
 *
 * Who may see it is decided here. A coach sees only logbooks under their own
 * agreements — one employer's supervisor has no business seeing another's
 * people, and no permission can express "only mine".
 */
export async function getLogbook(
  session: AuthenticatedSession,
  logbookId: string,
) {
  return withTenant(session.organisationId, async (tx) => {
    const { logbook, agreement } = await loadLogbook(tx, logbookId);

    const isLearner = logbook.learnerId === session.userId;
    const isCoach = agreement?.coachId === session.userId;
    const isStaff =
      session.permissions.includes("workplace:manage") ||
      session.permissions.includes("assessment:assess");

    if (!isLearner && !isCoach && !isStaff) {
      throw new WorkplaceError("Logbook not found.", "not_found");
    }

    const rows = await tx
      .select({
        entryId: workplaceLogbookEntries.id,
        completed: workplaceLogbookEntries.completed,
        completedAt: workplaceLogbookEntries.completedAt,
        note: workplaceLogbookEntries.note,
        elementId: curriculumTopicElements.id,
        kind: curriculumTopicElements.kind,
        code: curriculumTopicElements.code,
        description: curriculumTopicElements.description,
        topicCode: curriculumTopics.code,
        topicTitle: curriculumTopics.title,
        topicOrder: curriculumTopics.sortOrder,
        elementOrder: curriculumTopicElements.sortOrder,
      })
      .from(workplaceLogbookEntries)
      .innerJoin(
        curriculumTopicElements,
        eq(curriculumTopicElements.id, workplaceLogbookEntries.topicElementId),
      )
      .innerJoin(
        curriculumTopics,
        eq(curriculumTopics.id, curriculumTopicElements.topicId),
      )
      .where(eq(workplaceLogbookEntries.logbookId, logbookId))
      .orderBy(
        asc(curriculumTopics.sortOrder),
        asc(curriculumTopicElements.sortOrder),
      );

    const files = rows.length
      ? await tx
          .select({
            id: evidenceArtifacts.id,
            logbookEntryId: evidenceArtifacts.logbookEntryId,
            filename: evidenceArtifacts.filename,
            sizeBytes: evidenceArtifacts.sizeBytes,
          })
          .from(evidenceArtifacts)
          .where(
            inArray(
              evidenceArtifacts.logbookEntryId,
              rows.map((row) => row.entryId),
            ),
          )
      : [];

    const [module] = await tx
      .select({
        code: curriculumModules.code,
        title: curriculumModules.title,
        credits: curriculumModules.credits,
      })
      .from(curriculumModules)
      .where(eq(curriculumModules.id, logbook.curriculumModuleId));

    const [learner] = await tx
      .select({
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        nationalId: users.nationalId,
      })
      .from(users)
      .where(eq(users.id, logbook.learnerId));

    const entries = rows.map((row) => ({
      ...row,
      evidence: files.filter((file) => file.logbookEntryId === row.entryId),
    }));

    return {
      logbook,
      agreement,
      module,
      learner,
      entries,
      canEdit:
        isLearner &&
        (logbook.status === "draft" || logbook.status === "returned_by_coach"),
      canSign: isCoach && logbook.status === "submitted_to_coach",
      outstanding: outstandingOf(entries),
    };
  });
}

type EntryLike = {
  kind: string;
  code: string;
  completed: boolean;
  evidence: { id: string }[];
};

/**
 * What still stands between this logbook and a signature.
 *
 * Supporting evidence needs a file, not a tick. A checklist that can be
 * completed by ticking boxes is not evidence, and it is the first thing an
 * external verifier probes.
 */
export function outstandingOf(entries: EntryLike[]): string[] {
  const missing: string[] = [];

  for (const entry of entries) {
    if (!entry.completed) {
      missing.push(entry.code);
      continue;
    }
    if (entry.kind === "supporting_evidence" && entry.evidence.length === 0) {
      missing.push(`${entry.code} (no file attached)`);
    }
  }

  return missing;
}

/** The learner ticks a line, or unticks it. */
export async function setEntryCompleted(
  session: AuthenticatedSession,
  entryId: string,
  completed: boolean,
  note?: string,
) {
  assertSessionCan(session, "workplace:log");

  return withTenant(session.organisationId, async (tx) => {
    const [entry] = await tx
      .select({
        id: workplaceLogbookEntries.id,
        logbookId: workplaceLogbookEntries.logbookId,
      })
      .from(workplaceLogbookEntries)
      .where(eq(workplaceLogbookEntries.id, entryId));

    if (!entry) {
      throw new WorkplaceError("Entry not found.", "not_found");
    }

    const { logbook } = await loadLogbook(tx, entry.logbookId);

    if (logbook.learnerId !== session.userId) {
      throw new WorkplaceError("That is not your logbook.", "not_permitted");
    }

    if (logbook.status !== "draft" && logbook.status !== "returned_by_coach") {
      throw new WorkplaceError(
        "This logbook has been submitted and can no longer be changed.",
        "invalid_state",
      );
    }

    await tx
      .update(workplaceLogbookEntries)
      .set({
        completed,
        completedAt: completed ? new Date() : null,
        note: note ?? null,
      })
      .where(eq(workplaceLogbookEntries.id, entryId));
  });
}

/** The learner sends the logbook to their coach. */
export async function submitToCoach(
  session: AuthenticatedSession,
  logbookId: string,
  hoursClaimed?: number,
) {
  assertSessionCan(session, "workplace:log");

  return withTenant(session.organisationId, async (tx) => {
    const { logbook } = await loadLogbook(tx, logbookId);

    if (logbook.learnerId !== session.userId) {
      throw new WorkplaceError("That is not your logbook.", "not_permitted");
    }

    if (logbook.status !== "draft" && logbook.status !== "returned_by_coach") {
      throw new WorkplaceError(
        "This logbook has already been submitted.",
        "invalid_state",
      );
    }

    await tx
      .update(workplaceLogbooks)
      .set({
        status: "submitted_to_coach",
        submittedAt: new Date(),
        hoursClaimed: hoursClaimed ?? logbook.hoursClaimed,
        updatedAt: new Date(),
      })
      .where(eq(workplaceLogbooks.id, logbookId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: "learner",
      action: "workplace_logbook.submitted",
      entityType: "workplace_logbook",
      entityId: logbookId,
    });
  });
}

/**
 * The coach signs, or sends it back.
 *
 * Signing computes a hash over the coach, the logbook and every entry as it
 * stood at that moment. It is not a cryptographic signature — the coach holds
 * no key — but it means a later change to a signed logbook is detectable
 * rather than deniable, which is the property that matters at audit.
 */
export async function coachSignOff(
  session: AuthenticatedSession,
  logbookId: string,
  decision: { outcome: "signed" | "returned"; comments?: string },
) {
  assertSessionCan(session, "workplace:sign");

  return withTenant(session.organisationId, async (tx) => {
    const { logbook, agreement } = await loadLogbook(tx, logbookId);

    if (!agreement || agreement.coachId !== session.userId) {
      throw new WorkplaceError(
        "You are not the workplace coach for this learner.",
        "not_permitted",
      );
    }

    if (logbook.status !== "submitted_to_coach") {
      throw new WorkplaceError(
        "This logbook is not waiting for your signature.",
        "invalid_state",
      );
    }

    if (decision.outcome === "returned") {
      await tx
        .update(workplaceLogbooks)
        .set({
          status: "returned_by_coach",
          coachComments: decision.comments ?? null,
          updatedAt: new Date(),
        })
        .where(eq(workplaceLogbooks.id, logbookId));

      await recordAudit(tx, {
        organisationId: session.organisationId,
        actorId: session.userId,
        actorRole: "workplace_coach",
        action: "workplace_logbook.returned",
        entityType: "workplace_logbook",
        entityId: logbookId,
        after: { comments: decision.comments ?? null },
      });
      return;
    }

    const entries = await tx
      .select({
        entryId: workplaceLogbookEntries.id,
        completed: workplaceLogbookEntries.completed,
        code: curriculumTopicElements.code,
        kind: curriculumTopicElements.kind,
      })
      .from(workplaceLogbookEntries)
      .innerJoin(
        curriculumTopicElements,
        eq(curriculumTopicElements.id, workplaceLogbookEntries.topicElementId),
      )
      .where(eq(workplaceLogbookEntries.logbookId, logbookId));

    const files = await tx
      .select({ logbookEntryId: evidenceArtifacts.logbookEntryId })
      .from(evidenceArtifacts)
      .where(
        inArray(
          evidenceArtifacts.logbookEntryId,
          entries.map((entry) => entry.entryId),
        ),
      );

    const outstanding = outstandingOf(
      entries.map((entry) => ({
        kind: entry.kind,
        code: entry.code,
        completed: entry.completed,
        evidence: files
          .filter((file) => file.logbookEntryId === entry.entryId)
          .map(() => ({ id: "" })),
      })),
    );

    if (outstanding.length > 0) {
      throw new WorkplaceError(
        `This logbook is not complete, so it cannot be signed: ${outstanding.slice(0, 8).join(", ")}${outstanding.length > 8 ? `, and ${outstanding.length - 8} more` : ""}.`,
        "incomplete",
      );
    }

    const signedAt = new Date();
    const signatureHash = createHash("sha256")
      .update(
        JSON.stringify({
          logbookId,
          coachId: session.userId,
          coachEmail: agreement.coachEmail,
          signedAt: signedAt.toISOString(),
          entries: entries
            .map((entry) => `${entry.code}:${entry.completed ? 1 : 0}`)
            .sort(),
        }),
      )
      .digest("hex");

    await tx
      .update(workplaceLogbooks)
      .set({
        status: "coach_signed",
        coachSignedAt: signedAt,
        coachComments: decision.comments ?? null,
        coachSignatureHash: signatureHash,
        updatedAt: signedAt,
      })
      .where(eq(workplaceLogbooks.id, logbookId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: "workplace_coach",
      action: "workplace_logbook.signed",
      entityType: "workplace_logbook",
      entityId: logbookId,
      after: {
        coachName: agreement.coachName,
        employer: agreement.employerName,
        signatureHash,
      },
    });
  });
}

/** The assessor takes receipt of a signed logbook. */
export async function acceptLogbook(
  session: AuthenticatedSession,
  logbookId: string,
) {
  assertSessionCan(session, "assessment:assess");

  return withTenant(session.organisationId, async (tx) => {
    const { logbook } = await loadLogbook(tx, logbookId);

    if (logbook.status !== "coach_signed") {
      throw new WorkplaceError(
        "Only a logbook signed by the workplace coach can be accepted.",
        "invalid_state",
      );
    }

    if (logbook.learnerId === session.userId) {
      throw new WorkplaceError(
        "You cannot accept your own logbook.",
        "not_permitted",
      );
    }

    await tx
      .update(workplaceLogbooks)
      .set({
        status: "accepted_by_assessor",
        assessorId: session.userId,
        acceptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(workplaceLogbooks.id, logbookId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: "assessor",
      action: "workplace_logbook.accepted",
      entityType: "workplace_logbook",
      entityId: logbookId,
    });
  });
}

/** Logbooks this person should be looking at, whoever they are. */
export async function myLogbooks(session: AuthenticatedSession) {
  return withTenant(session.organisationId, async (tx) => {
    const isCoach = session.permissions.includes("workplace:sign");
    const isStaff =
      session.permissions.includes("workplace:manage") ||
      session.permissions.includes("assessment:assess");

    const rows = await tx
      .select({
        id: workplaceLogbooks.id,
        status: workplaceLogbooks.status,
        learnerId: workplaceLogbooks.learnerId,
        coachId: workplaceAgreements.coachId,
        employerName: workplaceAgreements.employerName,
        moduleCode: curriculumModules.code,
        moduleTitle: curriculumModules.title,
        learnerFirst: users.firstName,
        learnerLast: users.lastName,
        submittedAt: workplaceLogbooks.submittedAt,
        coachSignedAt: workplaceLogbooks.coachSignedAt,
      })
      .from(workplaceLogbooks)
      .innerJoin(
        workplaceAgreements,
        eq(workplaceAgreements.id, workplaceLogbooks.agreementId),
      )
      .innerJoin(
        curriculumModules,
        eq(curriculumModules.id, workplaceLogbooks.curriculumModuleId),
      )
      .innerJoin(users, eq(users.id, workplaceLogbooks.learnerId))
      .orderBy(asc(curriculumModules.sortOrder));

    return rows.filter(
      (row) =>
        isStaff ||
        row.learnerId === session.userId ||
        (isCoach && row.coachId === session.userId),
    );
  });
}

/** Agreements a coach holds, or all of them for staff. */
export async function listAgreements(session: AuthenticatedSession) {
  assertSessionCan(session, "workplace:manage");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: workplaceAgreements.id,
        learnerId: workplaceAgreements.learnerId,
        employerName: workplaceAgreements.employerName,
        coachName: workplaceAgreements.coachName,
        coachEmail: workplaceAgreements.coachEmail,
        startDate: workplaceAgreements.startDate,
        endDate: workplaceAgreements.endDate,
        learnerFirst: users.firstName,
        learnerLast: users.lastName,
      })
      .from(workplaceAgreements)
      .innerJoin(users, eq(users.id, workplaceAgreements.learnerId))
      .where(isNull(workplaceAgreements.endedAt)),
  );
}

/**
 * Everything the "new agreement" and "open logbook" forms need to offer.
 *
 * Learners and coaches are listed separately rather than as one list of
 * people, so the form cannot present an arrangement the database will refuse.
 * Work experience modules are listed with the logbooks already open against
 * them, because opening a second logbook for the same learner and module is
 * the mistake this screen would otherwise invite.
 */
export async function workplaceSetupData(session: AuthenticatedSession) {
  assertSessionCan(session, "workplace:manage");

  return withTenant(session.organisationId, async (tx) => {
    const people = await tx
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        jobTitle: users.jobTitle,
        role: userRoles.role,
      })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .where(and(eq(users.status, "active"), isNull(userRoles.revokedAt)))
      .orderBy(asc(users.lastName), asc(users.firstName));

    const uniqueBy = (role: string) => {
      const seen = new Map<string, (typeof people)[number]>();
      for (const person of people) {
        if (person.role === role && !seen.has(person.id)) {
          seen.set(person.id, person);
        }
      }
      return [...seen.values()];
    };

    const modules = await tx
      .select({
        id: curriculumModules.id,
        code: curriculumModules.code,
        title: curriculumModules.title,
        qualificationTitle: qualifications.title,
        /**
         * A module with no work activities cannot produce a logbook that
         * attests to anything, so the form says so rather than letting
         * openLogbook refuse after the fact.
         */
        elementCount: sql<number>`(
          select count(*)::int
          from curriculum_topic_elements cte
          join curriculum_topics ct on ct.id = cte.topic_id
          where ct.curriculum_module_id = curriculum_modules.id
            and cte.kind in ('work_activity', 'contextual_knowledge', 'supporting_evidence')
        )`,
      })
      .from(curriculumModules)
      .innerJoin(
        qualifications,
        eq(qualifications.id, curriculumModules.qualificationId),
      )
      .where(eq(curriculumModules.component, "workplace"))
      .orderBy(asc(curriculumModules.sortOrder));

    const agreements = await tx
      .select({
        id: workplaceAgreements.id,
        learnerId: workplaceAgreements.learnerId,
        employerName: workplaceAgreements.employerName,
        coachName: workplaceAgreements.coachName,
        coachEmail: workplaceAgreements.coachEmail,
        coachDesignation: workplaceAgreements.coachDesignation,
        startDate: workplaceAgreements.startDate,
        endDate: workplaceAgreements.endDate,
        learnerFirst: users.firstName,
        learnerLast: users.lastName,
      })
      .from(workplaceAgreements)
      .innerJoin(users, eq(users.id, workplaceAgreements.learnerId))
      .where(isNull(workplaceAgreements.endedAt))
      .orderBy(asc(users.lastName));

    const openLogbooks = await tx
      .select({
        agreementId: workplaceLogbooks.agreementId,
        curriculumModuleId: workplaceLogbooks.curriculumModuleId,
      })
      .from(workplaceLogbooks);

    return {
      learners: uniqueBy("learner"),
      coaches: uniqueBy("workplace_coach"),
      modules,
      agreements: agreements.map((agreement) => ({
        ...agreement,
        moduleIdsOpen: openLogbooks
          .filter((entry) => entry.agreementId === agreement.id)
          .map((entry) => entry.curriculumModuleId),
      })),
    };
  });
}
