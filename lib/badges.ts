import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  withTenant,
  withPlatformScope,
  type TenantDatabase,
} from "@/db/client";
import {
  badgeAwards,
  badges,
  courses,
  curriculumModules,
  learningPaths,
  qualifications,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { BADGE_SHAPES } from "./badge-shapes";

/**
 * Competency badges.
 *
 * A retention measure, not decoration. Formal certification under the OQSF
 * arrives months after the work is finished: the external assessment has to be
 * sat, moderated and processed by the assessment quality partner. The client
 * has measurably lost learners in that gap - people who did the work, waited,
 * heard nothing, and concluded nothing was happening.
 *
 * A badge is the recognition that arrives on the day the module is finished,
 * which is the day it means something to the person who finished it.
 *
 * It is emphatically not a qualification, and the platform never lets it look
 * like one. It carries no SAQA identifier, no credits and no awarding-body
 * claim. The verification page says in plain words what it is and what it is
 * not, because the one way this becomes a liability is a learner showing an
 * employer something that reads like a certificate and is not.
 */

export class BadgeError extends Error {
  constructor(
    message: string,
    readonly reason: "not_found" | "invalid" | "duplicate",
  ) {
    super(message);
    this.name = "BadgeError";
  }
}

/** Six hex digits with a hash, or nothing. */
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Which field has to be set for each kind. `default` names nothing. */
const TARGET_OF: Record<string, string | null> = {
  curriculum_module: "curriculumModuleId",
  qualification: "qualificationId",
  course: "courseId",
  learning_path: "learningPathId",
  default: null,
};

const defineInput = z
  .object({
    kind: z.enum([
      "curriculum_module",
      "qualification",
      "course",
      "learning_path",
      "default",
    ]),
    curriculumModuleId: z.string().uuid().optional(),
    qualificationId: z.string().uuid().optional(),
    courseId: z.string().uuid().optional(),
    learningPathId: z.string().uuid().optional(),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    glyph: z.string().trim().min(1).max(8).optional(),
    shape: z.enum(BADGE_SHAPES).optional(),
    background: z.string().trim().regex(HEX, "Use a colour like #4C1D95.").optional(),
    ink: z.string().trim().regex(HEX, "Use a colour like #FFFFFF.").optional(),
  })
  .refine(
    (value) => {
      const field = TARGET_OF[value.kind];
      // The default names nothing on purpose, and must not name anything -
      // otherwise it is a specific badge wearing the fallback's name.
      if (field === null) {
        return (
          !value.curriculumModuleId &&
          !value.qualificationId &&
          !value.courseId &&
          !value.learningPathId
        );
      }
      return Boolean((value as Record<string, unknown>)[field]);
    },
    { message: "Say what earns the badge." },
  );

export async function defineBadge(
  session: AuthenticatedSession,
  input: z.input<typeof defineInput>,
) {
  assertSessionCan(session, "course:author");
  const parsed = defineInput.parse(input);

  return withTenant(session.organisationId, async (tx) => {
    const [created] = await tx
      .insert(badges)
      .values({
        organisationId: session.organisationId,
        kind: parsed.kind,
        curriculumModuleId: parsed.curriculumModuleId ?? null,
        qualificationId: parsed.qualificationId ?? null,
        courseId: parsed.courseId ?? null,
        learningPathId: parsed.learningPathId ?? null,
        name: parsed.name,
        description: parsed.description || null,
        glyph: parsed.glyph || "★",
        shape: parsed.shape ?? "circle",
        background: parsed.background ?? null,
        ink: parsed.ink ?? null,
      })
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "badge.defined",
      entityType: "badge",
      entityId: created.id,
      after: { name: created.name, kind: created.kind },
    });

    return created;
  });
}

/**
 * A short, human-readable reference for a badge somebody can be shown.
 *
 * Deliberately not the row's identifier. A learner shares this in a message or
 * reads it down a phone, and a UUID is neither. Ambiguous characters are left
 * out for the same reason.
 */
function reference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let index = 0; index < 10; index += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (index === 4) out += "-";
  }
  return out;
}

/**
 * Awards whatever this learner has now earned and does not yet hold.
 *
 * Takes the completed modules as an argument rather than working them out,
 * because the caller has just computed readiness and recomputing it here would
 * be the same expensive read done twice with a chance of the two disagreeing.
 *
 * Idempotent, and quietly so. It runs after every assessment decision, and a
 * decision that changes nothing must not produce a second badge or an error.
 */
export async function awardEarnedBadges(
  organisationId: string,
  learnerId: string,
  completed: { curriculumModuleId: string; completedOn: string }[],
): Promise<{ awarded: number }> {
  if (completed.length === 0) return { awarded: 0 };

  return withTenant(organisationId, async (tx) => {
    const defined = await tx
      .select({
        id: badges.id,
        curriculumModuleId: badges.curriculumModuleId,
      })
      .from(badges)
      .where(
        and(
          eq(badges.active, true),
          eq(badges.kind, "curriculum_module"),
          inArray(
            badges.curriculumModuleId,
            completed.map((row) => row.curriculumModuleId),
          ),
        ),
      );

    if (defined.length === 0) return { awarded: 0 };

    const held = await tx
      .select({ badgeId: badgeAwards.badgeId })
      .from(badgeAwards)
      .where(
        and(
          eq(badgeAwards.learnerId, learnerId),
          inArray(
            badgeAwards.badgeId,
            defined.map((row) => row.id),
          ),
        ),
      );

    const already = new Set(held.map((row) => row.badgeId));
    const dates = new Map(
      completed.map((row) => [row.curriculumModuleId, row.completedOn]),
    );

    const toAward = defined
      .filter((badge) => !already.has(badge.id))
      .map((badge) => ({
        organisationId,
        badgeId: badge.id,
        learnerId,
        // The day the work was finished, not the day this ran. A learner who
        // finished in March and was backfilled in July finished in March.
        earnedOn: dates.get(badge.curriculumModuleId ?? "") ?? "",
        reference: reference(),
      }))
      .filter((row) => row.earnedOn !== "");

    if (toAward.length === 0) return { awarded: 0 };

    // onConflictDoNothing rather than a check-then-insert: two decisions
    // recorded at once would both pass the check and one would fail the
    // constraint, which is an error message about a badge nobody asked for.
    await tx.insert(badgeAwards).values(toAward).onConflictDoNothing();

    return { awarded: toAward.length };
  });
}

/**
 * Awards the badge for finishing one intervention - a course, a programme, or
 * a whole qualification.
 *
 * Falls back to the tenant's default badge when nothing specific is defined,
 * which is the point of having a default: a provider who does not want to
 * design one per course designs one badge and every completion earns it. A
 * provider who has designed neither gets nothing, silently, which is also a
 * valid choice and not an error.
 *
 * Idempotent, like the module awards. Completing a course twice - a
 * re-enrolment, a corrected record - must not produce a second badge.
 */
export async function awardCompletionBadge(
  organisationId: string,
  learnerId: string,
  target: {
    kind: "course" | "learning_path" | "qualification";
    id: string;
    completedOn: string;
  },
): Promise<{ awarded: boolean }> {
  return withTenant(organisationId, (tx) =>
    awardCompletionBadgeIn(tx, organisationId, learnerId, target),
  );
}

/**
 * The same award, inside a transaction the caller already has open.
 *
 * Completion is decided inside a transaction that also writes the enrolment
 * and its audit entry, and the badge belongs in that same unit of work: a
 * learner recorded as finished with no badge, because a second connection
 * failed afterwards, is a support question nobody can answer from the record.
 */
export async function awardCompletionBadgeIn(
  tx: TenantDatabase,
  organisationId: string,
  learnerId: string,
  target: {
    kind: "course" | "learning_path" | "qualification";
    id: string;
    completedOn: string;
  },
): Promise<{ awarded: boolean }> {
  if (!target.completedOn) return { awarded: false };

  const column =
    target.kind === "course"
      ? badges.courseId
      : target.kind === "learning_path"
        ? badges.learningPathId
        : badges.qualificationId;

  {
    const [specific] = await tx
      .select({ id: badges.id })
      .from(badges)
      .where(
        and(
          eq(badges.active, true),
          eq(badges.kind, target.kind),
          eq(column, target.id),
        ),
      )
      .limit(1);

    let badgeId = specific?.id ?? null;

    if (!badgeId) {
      const [fallback] = await tx
        .select({ id: badges.id })
        .from(badges)
        .where(and(eq(badges.active, true), eq(badges.kind, "default")))
        .limit(1);
      badgeId = fallback?.id ?? null;
    }

    if (!badgeId) return { awarded: false };

    // The default badge can be earned once per learner however many things
    // they finish, because it says nothing about which. A learner holding it
    // twice would be a list with a repeated row and no way to tell them apart.
    const inserted = await tx
      .insert(badgeAwards)
      .values({
        organisationId,
        badgeId,
        learnerId,
        earnedOn: target.completedOn,
        reference: reference(),
      })
      .onConflictDoNothing()
      .returning({ id: badgeAwards.id });

    return { awarded: inserted.length > 0 };
  }
}

/**
 * Stops a badge being earned, without touching anybody who holds it.
 *
 * Retired rather than deleted, always. A learner was shown this badge and may
 * have shown it to somebody else; deleting the definition would turn their
 * verification page into "no such badge", which reads as though they made it
 * up. Retiring means nobody new earns it and every existing award stays true.
 */
export async function retireBadge(
  session: AuthenticatedSession,
  badgeId: string,
) {
  assertSessionCan(session, "course:author");

  return withTenant(session.organisationId, async (tx) => {
    const [updated] = await tx
      .update(badges)
      .set({ active: false })
      .where(eq(badges.id, badgeId))
      .returning({ id: badges.id, name: badges.name });

    if (!updated) {
      throw new BadgeError("No such badge.", "not_found");
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "badge.retired",
      entityType: "badge",
      entityId: updated.id,
      after: { name: updated.name },
    });

    return updated;
  });
}

/**
 * The tenant's fallback badge, or null.
 *
 * Read on the badge screen so it can say whether completions currently earn
 * anything at all, which is otherwise invisible: a provider with no default
 * and no specific badges has a working platform that quietly awards nothing.
 */
export async function defaultBadge(session: AuthenticatedSession) {
  return withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select()
      .from(badges)
      .where(and(eq(badges.kind, "default"), eq(badges.active, true)))
      .limit(1);
    return row ?? null;
  });
}

/** A learner's badges, newest first. */
export async function learnerBadges(
  session: AuthenticatedSession,
  learnerId: string,
) {
  if (learnerId !== session.userId) {
    assertSessionCan(session, "enrolment:read_all");
  }

  return withTenant(session.organisationId, async (tx) =>
    tx
      .select({
        id: badgeAwards.id,
        reference: badgeAwards.reference,
        earnedOn: badgeAwards.earnedOn,
        name: badges.name,
        description: badges.description,
        glyph: badges.glyph,
      })
      .from(badgeAwards)
      .innerJoin(badges, eq(badges.id, badgeAwards.badgeId))
      .where(eq(badgeAwards.learnerId, learnerId))
      .orderBy(desc(badgeAwards.earnedOn)),
  );
}

/** Every badge a tenant has defined, with how many hold it. */
export async function definedBadges(session: AuthenticatedSession) {
  assertSessionCan(session, "course:read");

  return withTenant(session.organisationId, async (tx) => {
    const defined = await tx
      .select({
        id: badges.id,
        kind: badges.kind,
        name: badges.name,
        description: badges.description,
        glyph: badges.glyph,
        shape: badges.shape,
        background: badges.background,
        ink: badges.ink,
        active: badges.active,
        moduleTitle: curriculumModules.title,
        moduleCode: curriculumModules.code,
        qualificationTitle: qualifications.title,
        courseTitle: courses.title,
        pathTitle: learningPaths.title,
      })
      .from(badges)
      .leftJoin(
        curriculumModules,
        eq(curriculumModules.id, badges.curriculumModuleId),
      )
      .leftJoin(qualifications, eq(qualifications.id, badges.qualificationId))
      .leftJoin(courses, eq(courses.id, badges.courseId))
      .leftJoin(learningPaths, eq(learningPaths.id, badges.learningPathId))
      .orderBy(badges.name);

    if (defined.length === 0) return [];

    const awarded = await tx
      .select({ badgeId: badgeAwards.badgeId })
      .from(badgeAwards)
      .where(
        inArray(
          badgeAwards.badgeId,
          defined.map((row) => row.id),
        ),
      );

    const tally = new Map<string, number>();
    for (const row of awarded) {
      tally.set(row.badgeId, (tally.get(row.badgeId) ?? 0) + 1);
    }

    return defined.map((row) => ({ ...row, held: tally.get(row.id) ?? 0 }));
  });
}

/**
 * Looks a badge up by its public reference, for the verification page.
 *
 * Runs outside a tenant session, like certificate verification does, because
 * whoever is checking it is an employer with a reference and no account. What
 * comes back is the minimum that answers the question: who, what, when, and
 * which provider says so.
 */
export async function verifyBadge(reference: string) {
  const cleaned = reference.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(cleaned)) return null;

  return withPlatformScope(
    "verifying a badge from a reference, which has no signed-in user",
    async (tx) => {
      const [found] = await tx
        .select({
          reference: badgeAwards.reference,
          earnedOn: badgeAwards.earnedOn,
          name: badges.name,
          description: badges.description,
          glyph: badges.glyph,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(badgeAwards)
        .innerJoin(badges, eq(badges.id, badgeAwards.badgeId))
        .innerJoin(users, eq(users.id, badgeAwards.learnerId))
        .where(eq(badgeAwards.reference, cleaned));

      if (!found) return null;

      const { firstName, lastName, ...rest } = found;
      return { ...rest, holderName: `${firstName} ${lastName}` };
    },
  );
}
