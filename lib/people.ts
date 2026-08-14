import { randomBytes } from "node:crypto";
import { and, asc, count, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import {
  withPlatformScope,
  withTenant,
  type TenantDatabase,
} from "@/db/client";
import { certificates, enrolments, userRoles, users } from "@/db/schema";
import { recordAudit } from "./audit";
import {
  assertPasswordAcceptable,
  hashPassword,
  verifyPassword,
} from "./password";
import {
  assertSessionCan,
  revokeAllSessionsForUser,
  type AuthenticatedSession,
} from "./session";
import { type Role } from "./rbac";
import { validateSouthAfricanId } from "./south-african-id";

/**
 * Managing the people in a tenant.
 *
 * Three rules here exist to stop an administrator doing damage they cannot
 * undo:
 *
 *   1. Nobody can suspend, anonymise or strip the roles from their own
 *      account. Every one of those actions would end the session performing
 *      it, and there may be nobody else able to reverse it.
 *   2. The last remaining administrator cannot lose that role. A tenant with
 *      no administrator can only be repaired by ROFT with direct database
 *      access, which is exactly the support call worth designing out.
 *   3. Anonymisation clears who someone was, never what they achieved. POPIA
 *      grants erasure of personal data; SAQA requires achievement records to
 *      be retained. Both are satisfied by separating the two.
 */

export class PeopleError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "not_found"
      | "not_permitted"
      | "invalid_input"
      | "would_lock_out"
      | "duplicate",
  ) {
    super(message);
    this.name = "PeopleError";
  }
}

const ROLE_VALUES = [
  "platform_owner",
  "tenant_admin",
  "instructor",
  "assessor",
  "moderator",
  "line_manager",
  "learner",
  "skills_development_facilitator",
  "external_verifier",
  "workplace_coach",
] as const;

/**
 * An initial password, given to the administrator to pass on.
 *
 * No email is sent because there is no mail server yet; showing it once and
 * expecting it to be handed over is honest about that, rather than pretending
 * an invitation went out. Deliberately readable aloud.
 */
export function generateInitialPassword(): string {
  const words = [
    "amber", "basalt", "cedar", "delta", "ember", "flint", "granite",
    "harbour", "indigo", "juniper", "kestrel", "lantern", "meadow",
    "nimbus", "onyx", "pewter", "quarry", "ridge", "summit", "thistle",
  ];
  const pick = () => words[randomBytes(1)[0] % words.length];
  const digits = String(100 + (randomBytes(2).readUInt16BE(0) % 900));
  return `${pick()}-${pick()}-${pick()}-${digits}`;
}

export const personInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  jobTitle: z.string().trim().max(200).optional(),
  team: z.string().trim().max(100).optional(),
  site: z.string().trim().max(100).optional(),
  lineManagerId: z.string().uuid().optional().nullable(),
  ofoCode: z.string().trim().max(50).optional(),
  nationalId: z.string().trim().max(20).optional(),
  gender: z.string().trim().max(20).optional(),
  equityCode: z.string().trim().max(10).optional(),
  disabilityCode: z.string().trim().max(10).optional(),
  nationality: z.string().trim().max(100).optional(),
  roles: z.array(z.enum(ROLE_VALUES)).default([]),
});

export type PersonInput = z.input<typeof personInput>;

/**
 * Identity numbers are checked here as well as at export time. Catching a
 * mistyped number while the person who has the document is still in front of
 * you is worth far more than catching it the night before a SETA return.
 */
function assertIdentityNumberIsUsable(nationalId: string | undefined) {
  if (!nationalId) return;
  const check = validateSouthAfricanId(nationalId);
  if (!check.valid) {
    throw new PeopleError(
      `That identity number is not valid: ${check.reason}`,
      "invalid_input",
    );
  }
}

export async function listPeople(
  session: AuthenticatedSession,
  filters: { team?: string; search?: string } = {},
) {
  assertSessionCan(session, "user:read");

  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        jobTitle: users.jobTitle,
        team: users.team,
        site: users.site,
        status: users.status,
        nationalId: users.nationalId,
        equityCode: users.equityCode,
        ofoCode: users.ofoCode,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .orderBy(asc(users.lastName), asc(users.firstName));

    const roles = await tx
      .select({ userId: userRoles.userId, role: userRoles.role })
      .from(userRoles)
      .where(isNull(userRoles.revokedAt));

    const search = filters.search?.trim().toLowerCase();

    return rows
      .filter((row) => (filters.team ? row.team === filters.team : true))
      .filter((row) =>
        search
          ? `${row.firstName} ${row.lastName} ${row.email}`
              .toLowerCase()
              .includes(search)
          : true,
      )
      .map((row) => ({
        ...row,
        roles: roles
          .filter((entry) => entry.userId === row.id)
          .map((entry) => entry.role),
        /** Fields the statutory return needs but does not yet have. */
        missingForStatutory: [
          row.nationalId ? null : "identity number",
          row.equityCode ? null : "equity code",
          row.ofoCode ? null : "OFO code",
        ].filter(Boolean) as string[],
      }));
  });
}

export async function getPerson(
  session: AuthenticatedSession,
  userId: string,
) {
  assertSessionCan(session, "user:read");

  return withTenant(session.organisationId, async (tx) => {
    const [person] = await tx.select().from(users).where(eq(users.id, userId));
    if (!person) throw new PeopleError("Person not found.", "not_found");

    const roles = await tx
      .select({
        role: userRoles.role,
        registrationNumber: userRoles.registrationNumber,
      })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), isNull(userRoles.revokedAt)));

    const [{ enrolmentCount }] = await tx
      .select({ enrolmentCount: count() })
      .from(enrolments)
      .where(eq(enrolments.userId, userId));

    const [{ certificateCount }] = await tx
      .select({ certificateCount: count() })
      .from(certificates)
      .where(
        and(eq(certificates.userId, userId), isNull(certificates.revokedAt)),
      );

    return { person, roles, enrolmentCount, certificateCount };
  });
}

export async function invitePerson(
  session: AuthenticatedSession,
  input: PersonInput,
): Promise<{ userId: string; initialPassword: string }> {
  assertSessionCan(session, "user:invite");
  const parsed = personInput.parse(input);
  assertIdentityNumberIsUsable(parsed.nationalId);

  if (parsed.roles.length > 0) {
    assertSessionCan(session, "user:manage_roles");
  }

  const initialPassword = generateInitialPassword();
  const passwordHash = await hashPassword(initialPassword);

  const userId = await withTenant(session.organisationId, async (tx) => {
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, parsed.email));

    if (existing) {
      throw new PeopleError(
        "Somebody with that email address already exists here.",
        "duplicate",
      );
    }

    const [created] = await tx
      .insert(users)
      .values({
        organisationId: session.organisationId,
        email: parsed.email,
        passwordHash,
        // The administrator reads this password out to them, so it is known to
        // two people from the moment it exists. It gets exactly one use.
        mustChangePassword: true,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        status: "active",
        jobTitle: parsed.jobTitle ?? null,
        team: parsed.team ?? null,
        site: parsed.site ?? null,
        lineManagerId: parsed.lineManagerId || null,
        ofoCode: parsed.ofoCode ?? null,
        nationalId: parsed.nationalId ?? null,
        gender: parsed.gender ?? null,
        equityCode: parsed.equityCode ?? null,
        disabilityCode: parsed.disabilityCode ?? null,
        nationality: parsed.nationality ?? null,
      })
      .returning({ id: users.id });

    if (parsed.roles.length > 0) {
      await tx.insert(userRoles).values(
        parsed.roles.map((role) => ({
          organisationId: session.organisationId,
          userId: created.id,
          role,
        })),
      );
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "user.invited",
      entityType: "user",
      entityId: created.id,
      // recordAudit redacts credentials, so the password cannot land here.
      after: { email: parsed.email, roles: parsed.roles },
    });

    return created.id;
  });

  return { userId, initialPassword };
}

export async function updatePerson(
  session: AuthenticatedSession,
  userId: string,
  input: PersonInput,
) {
  assertSessionCan(session, "user:invite");
  const parsed = personInput.parse(input);
  assertIdentityNumberIsUsable(parsed.nationalId);

  return withTenant(session.organisationId, async (tx) => {
    const [before] = await tx.select().from(users).where(eq(users.id, userId));
    if (!before) throw new PeopleError("Person not found.", "not_found");

    if (before.anonymisedAt) {
      throw new PeopleError(
        "This record was anonymised and cannot be edited.",
        "not_permitted",
      );
    }

    if (parsed.lineManagerId === userId) {
      throw new PeopleError(
        "Somebody cannot be their own line manager.",
        "invalid_input",
      );
    }

    const [updated] = await tx
      .update(users)
      .set({
        email: parsed.email,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        jobTitle: parsed.jobTitle ?? null,
        team: parsed.team ?? null,
        site: parsed.site ?? null,
        lineManagerId: parsed.lineManagerId || null,
        ofoCode: parsed.ofoCode ?? null,
        nationalId: parsed.nationalId ?? null,
        gender: parsed.gender ?? null,
        equityCode: parsed.equityCode ?? null,
        disabilityCode: parsed.disabilityCode ?? null,
        nationality: parsed.nationality ?? null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "user.updated",
      entityType: "user",
      entityId: userId,
      before,
      after: updated,
    });

    return updated;
  });
}

/** Administrators still holding the role, excluding one person. */
async function otherAdministratorCount(
  tx: TenantDatabase,
  excludingUserId: string,
): Promise<number> {
  const [{ total }] = await tx
    .select({ total: count() })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(
      and(
        eq(userRoles.role, "tenant_admin"),
        isNull(userRoles.revokedAt),
        eq(users.status, "active"),
        ne(userRoles.userId, excludingUserId),
      ),
    );

  return total;
}

export async function setRoles(
  session: AuthenticatedSession,
  userId: string,
  roles: Role[],
  registrationNumbers: Partial<Record<Role, string>> = {},
) {
  assertSessionCan(session, "user:manage_roles");

  if (userId === session.userId) {
    throw new PeopleError(
      "You cannot change your own roles. Ask another administrator.",
      "not_permitted",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [person] = await tx.select().from(users).where(eq(users.id, userId));
    if (!person) throw new PeopleError("Person not found.", "not_found");

    const existing = await tx
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), isNull(userRoles.revokedAt)));

    const had = existing.map((row) => row.role);

    // Rule 2: never remove the last administrator.
    if (had.includes("tenant_admin") && !roles.includes("tenant_admin")) {
      if ((await otherAdministratorCount(tx, userId)) === 0) {
        throw new PeopleError(
          "This is the only administrator. Give somebody else the role first, or the organisation would be left with nobody able to manage it.",
          "would_lock_out",
        );
      }
    }

    await tx.delete(userRoles).where(eq(userRoles.userId, userId));

    if (roles.length > 0) {
      await tx.insert(userRoles).values(
        roles.map((role) => ({
          organisationId: session.organisationId,
          userId,
          role,
          registrationNumber: registrationNumbers[role] ?? null,
        })),
      );
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "user.roles_changed",
      entityType: "user",
      entityId: userId,
      before: { roles: had },
      after: { roles },
    });

    // Roles are read from the database on every request, so a change takes
    // effect on the person's next page load without ending their session.
    return roles;
  });
}

export async function setPersonStatus(
  session: AuthenticatedSession,
  userId: string,
  status: "active" | "suspended",
) {
  assertSessionCan(session, "user:invite");

  if (userId === session.userId) {
    throw new PeopleError(
      "You cannot suspend your own account.",
      "not_permitted",
    );
  }

  await withTenant(session.organisationId, async (tx) => {
    const [person] = await tx.select().from(users).where(eq(users.id, userId));
    if (!person) throw new PeopleError("Person not found.", "not_found");

    if (
      status === "suspended" &&
      (await otherAdministratorCount(tx, userId)) === 0
    ) {
      const isAdmin = await tx
        .select({ role: userRoles.role })
        .from(userRoles)
        .where(
          and(
            eq(userRoles.userId, userId),
            eq(userRoles.role, "tenant_admin"),
            isNull(userRoles.revokedAt),
          ),
        );

      if (isAdmin.length > 0) {
        throw new PeopleError(
          "This is the only administrator; suspending them would leave nobody able to manage the organisation.",
          "would_lock_out",
        );
      }
    }

    await tx
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(eq(users.id, userId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: status === "suspended" ? "user.suspended" : "user.reactivated",
      entityType: "user",
      entityId: userId,
      before: { status: person.status },
      after: { status },
    });
  });

  // The reason sessions live in the database: suspension takes effect now.
  if (status === "suspended") {
    await revokeAllSessionsForUser(
      session.organisationId,
      userId,
      "account_suspended",
      session.userId,
    );
  }
}

export async function resetPassword(
  session: AuthenticatedSession,
  userId: string,
): Promise<string> {
  assertSessionCan(session, "user:invite");

  const password = generateInitialPassword();
  const passwordHash = await hashPassword(password);

  await withTenant(session.organisationId, async (tx) => {
    const [person] = await tx.select().from(users).where(eq(users.id, userId));
    if (!person) throw new PeopleError("Person not found.", "not_found");

    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: true, updatedAt: new Date() })
      .where(eq(users.id, userId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "user.password_reset",
      entityType: "user",
      entityId: userId,
    });
  });

  await revokeAllSessionsForUser(
    session.organisationId,
    userId,
    "password_reset_by_administrator",
    session.userId,
  );

  return password;
}

/**
 * Changes your own password.
 *
 * The one password operation that needs no permission: it is about your own
 * account, and requiring a permission would mean a learner could be handed a
 * password they were then unable to replace.
 *
 * The current password is required even when a change is being forced. An
 * unattended signed-in browser is the ordinary way an account is taken over,
 * and without this check that browser is enough to lock the owner out.
 */
export async function changeOwnPassword(
  session: AuthenticatedSession,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (newPassword === currentPassword) {
    throw new PeopleError(
      "The new password must be different from the current one.",
      "invalid_input",
    );
  }

  // Throws WeakPasswordError before anything is read or written, so a rejected
  // password never reaches the database.
  assertPasswordAcceptable(newPassword);

  const passwordHash = await hashPassword(newPassword);

  await withTenant(session.organisationId, async (tx) => {
    const [person] = await tx
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, session.userId));

    if (!person?.passwordHash) {
      throw new PeopleError("Account not found.", "not_found");
    }

    if (!(await verifyPassword(currentPassword, person.passwordHash))) {
      throw new PeopleError("Current password is not correct.", "not_permitted");
    }

    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
      .where(eq(users.id, session.userId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "user.password_changed",
      entityType: "user",
      entityId: session.userId,
    });
  });

  // Every other session for this person ends. If the password is being changed
  // because somebody else knew it — which is exactly the case after an
  // administrator reset — leaving their session alive achieves nothing.
  await revokeAllSessionsForUser(
    session.organisationId,
    session.userId,
    "password_changed_by_owner",
    session.userId,
    { exceptSessionId: session.sessionId },
  );
}

/**
 * POPIA erasure.
 *
 * Clears who somebody was and keeps what they achieved. The Act grants a data
 * subject erasure of personal information; SAQA and the QCTO require
 * achievement records to be retained for national verification. Both hold at
 * once only if the two are separable, which is why demographic fields live on
 * the user and the competencies attested live frozen on the certificate.
 *
 * A certificate issued to this person remains verifiable, and the capability
 * they demonstrated still counts — it simply is no longer attached to a
 * named, contactable individual.
 */
export async function anonymisePerson(
  session: AuthenticatedSession,
  userId: string,
  reason: string,
) {
  assertSessionCan(session, "user:anonymise");

  if (userId === session.userId) {
    throw new PeopleError(
      "You cannot anonymise your own account.",
      "not_permitted",
    );
  }

  if (reason.trim().length < 5) {
    throw new PeopleError(
      "Record why this was done; the audit log keeps it permanently.",
      "invalid_input",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [person] = await tx.select().from(users).where(eq(users.id, userId));
    if (!person) throw new PeopleError("Person not found.", "not_found");

    if (person.anonymisedAt) {
      throw new PeopleError(
        "This record has already been anonymised.",
        "invalid_input",
      );
    }

    if ((await otherAdministratorCount(tx, userId)) === 0) {
      const isAdmin = await tx
        .select({ role: userRoles.role })
        .from(userRoles)
        .where(
          and(
            eq(userRoles.userId, userId),
            eq(userRoles.role, "tenant_admin"),
            isNull(userRoles.revokedAt),
          ),
        );
      if (isAdmin.length > 0) {
        throw new PeopleError(
          "This is the only administrator.",
          "would_lock_out",
        );
      }
    }

    const now = new Date();
    const marker = `anonymised-${userId.slice(0, 8)}@example.invalid`;

    await tx
      .update(users)
      .set({
        email: marker,
        firstName: "Anonymised",
        lastName: "Record",
        passwordHash: null,
        nationalId: null,
        dateOfBirth: null,
        gender: null,
        equityCode: null,
        disabilityCode: null,
        nationality: null,
        jobTitle: null,
        team: null,
        site: null,
        ofoCode: null,
        lineManagerId: null,
        status: "anonymised",
        anonymisedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, userId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "user.anonymised",
      entityType: "user",
      entityId: userId,
      after: {
        reason,
        // Recorded so an auditor can see the achievement record survived.
        certificatesRetained: await tx
          .select({ total: count() })
          .from(certificates)
          .where(eq(certificates.userId, userId))
          .then(([row]) => row.total),
      },
    });

    return { anonymisedAt: now };
  });
}

/** Everyone who could be somebody's line manager. */
export async function possibleLineManagers(
  session: AuthenticatedSession,
  excludeUserId?: string,
) {
  assertSessionCan(session, "user:read");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(users)
      .where(
        excludeUserId
          ? and(eq(users.status, "active"), ne(users.id, excludeUserId))
          : eq(users.status, "active"),
      )
      .orderBy(asc(users.lastName)),
  );
}

export { ROLE_VALUES };
export type { Role };

/**
 * The platform mailbox address for a person, e.g. n.mahlangu@lms.roftbusiness.org
 *
 * Built from the name rather than being random, because a learner has to read
 * it off a screen and type it into their own mail client, and because an
 * assessor's address appears on documents a moderator reads.
 *
 * The domain comes from settings, so a tenant on their own domain gets
 * addresses on it. Nothing here contacts the network — this only proposes an
 * address; whether the platform can receive at it is a matter of DNS.
 */
export function proposeMailboxAddress(
  firstName: string,
  lastName: string,
  domain: string,
  taken: Set<string> = new Set(),
): string {
  const strip = (value: string) =>
    value
      .normalize("NFD")
      // Mail addresses are ASCII in practice. Nkosi and Nkösi must not become
      // two different mailboxes, and a local part with an accent in it is
      // rejected by servers that never implemented SMTPUTF8.
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  const first = strip(firstName);
  const last = strip(lastName);
  const base = first && last ? `${first[0]}.${last}` : first || last || "user";

  let candidate = `${base}@${domain}`;
  let suffix = 2;

  // Two people called Nkosi is ordinary, and the second one still needs an
  // address. Numbering is ugly and honest; silently reusing the first
  // person's would deliver one learner's mail to another.
  while (taken.has(candidate)) {
    candidate = `${base}${suffix}@${domain}`;
    suffix += 1;
  }

  return candidate;
}

export class MailboxError extends PeopleError {}

/**
 * Gives somebody a mailbox on the platform, or changes the one they have.
 *
 * Deliberately separate from updatePerson: an address that has received mail
 * is referred to by every message in the thread, so changing it is a decision
 * rather than a field edit.
 */
export async function setMailboxAddress(
  session: AuthenticatedSession,
  userId: string,
  address: string | null,
) {
  assertSessionCan(session, "user:invite");

  const normalised = address?.trim().toLowerCase() || null;

  if (normalised && !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(normalised)) {
    throw new PeopleError("That is not a valid email address.", "invalid_input");
  }

  await withTenant(session.organisationId, async (tx) => {
    const [person] = await tx
      .select({ id: users.id, mailboxAddress: users.mailboxAddress })
      .from(users)
      .where(eq(users.id, userId));

    if (!person) throw new PeopleError("Person not found.", "not_found");

    await tx
      .update(users)
      .set({ mailboxAddress: normalised, updatedAt: new Date() })
      .where(eq(users.id, userId));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "user.mailbox_changed",
      entityType: "user",
      entityId: userId,
      before: { mailboxAddress: person.mailboxAddress },
      after: { mailboxAddress: normalised },
    });
  });
}

/** Every mailbox address in use, so a proposal cannot collide with one. */
export async function takenMailboxAddresses(
  session: AuthenticatedSession,
): Promise<Set<string>> {
  assertSessionCan(session, "user:read");

  // Deliberately across every tenant: an address is a destination on the
  // internet and two tenants cannot both own one. Only the addresses are read,
  // never who holds them.
  const rows = await withPlatformScope(
    "checking a proposed mailbox address is not already in use on another tenant",
    (tx) =>
      tx
        .select({ mailboxAddress: users.mailboxAddress })
        .from(users)
        .where(isNotNull(users.mailboxAddress)),
  );

  return new Set(
    rows
      .map((row) => row.mailboxAddress)
      .filter((address): address is string => address !== null),
  );
}
