import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant, withPlatformScope } from "@/db/client";
import {
  badgeAwards,
  badges,
  curriculumModules,
  qualifications,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

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

const defineInput = z
  .object({
    kind: z.enum(["curriculum_module", "qualification"]),
    curriculumModuleId: z.string().uuid().optional(),
    qualificationId: z.string().uuid().optional(),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    glyph: z.string().trim().min(1).max(8).optional(),
  })
  .refine(
    (value) =>
      value.kind === "curriculum_module"
        ? Boolean(value.curriculumModuleId)
        : Boolean(value.qualificationId),
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
        name: parsed.name,
        description: parsed.description || null,
        glyph: parsed.glyph || "★",
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
        active: badges.active,
        moduleTitle: curriculumModules.title,
        moduleCode: curriculumModules.code,
        qualificationTitle: qualifications.title,
      })
      .from(badges)
      .leftJoin(
        curriculumModules,
        eq(curriculumModules.id, badges.curriculumModuleId),
      )
      .leftJoin(qualifications, eq(qualifications.id, badges.qualificationId))
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
