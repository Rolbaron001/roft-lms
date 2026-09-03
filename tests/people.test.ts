/**
 * User management, against a live database.
 *
 * The tests that matter most are the ones about locking yourself out. An
 * administrator who removes their own last admin role, or suspends the only
 * administrator, leaves a tenant that can only be repaired with direct
 * database access - a support call worth designing out rather than handling.
 *
 * The other is anonymisation: POPIA erasure of personal data must not destroy
 * the achievement records SAQA requires to be kept.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  auditLog,
  certificates,
  competencies,
  competencyFrameworks,
  organisations,
  users,
} from "@/db/schema";
import {
  addLesson,
  addSection,
  createCourse,
  publishCourse,
  tagCourseCompetency,
} from "@/lib/authoring";
import {
  enrolUser,
  getEnrolmentForDelivery,
  markLessonComplete,
} from "@/lib/enrolment";
import { verifyByReference } from "@/lib/certificates";
import {
  anonymisePerson,
  generateInitialPassword,
  getPerson,
  changeOwnPassword,
  invitePerson,
  listPeople,
  resetPassword,
  setPersonStatus,
  setRoles,
  updatePerson,
} from "@/lib/people";
import { resolveSession, signIn } from "@/lib/session";
import { WeakPasswordError } from "@/lib/password";
import { PermissionDeniedError, permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

const VALID_ID = "8001015009087";

let organisationId: string;
let competencyId: string;
let admin: AuthenticatedSession;
let secondAdmin: AuthenticatedSession;
let learner: AuthenticatedSession;

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "test@example.test",
    firstName: "Test",
    lastName: "User",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

function suffix() {
  return Math.random().toString(36).slice(2, 8);
}

beforeAll(async () => {
  const slug = `people-${Date.now()}`;

  const created = await withPlatformScope(
    "people test fixture setup",
    async (tx) => {
      const [organisation] = await tx
        .insert(organisations)
        .values({
          slug,
          legalName: `${slug} Ltd`,
          displayName: "People Test Co",
          status: "active",
        })
        .returning({ id: organisations.id });

      const [framework] = await tx
        .insert(competencyFrameworks)
        .values({ organisationId: organisation.id, name: "Framework" })
        .returning({ id: competencyFrameworks.id });

      const [competency] = await tx
        .insert(competencies)
        .values({
          organisationId: organisation.id,
          frameworkId: framework.id,
          code: "PPL-01",
          name: "Demonstrated capability",
        })
        .returning({ id: competencies.id });

      return { organisationId: organisation.id, competencyId: competency.id };
    },
  );

  organisationId = created.organisationId;
  competencyId = created.competencyId;

  // Bootstrap the first administrator directly; everyone else is invited
  // through the interface being tested.
  const bootstrapId = await withPlatformScope(
    "people test bootstrap",
    async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          organisationId,
          email: "admin@people.test",
          firstName: "First",
          lastName: "Administrator",
          status: "active",
        })
        .returning({ id: users.id });

      await tx
        .insert((await import("@/db/schema")).userRoles)
        .values({ organisationId, userId: user.id, role: "tenant_admin" });

      return user.id;
    },
  );

  admin = sessionFor(["tenant_admin"], bootstrapId);

  const second = await invitePerson(admin, {
    email: "second-admin@people.test",
    firstName: "Second",
    lastName: "Administrator",
    roles: ["tenant_admin"],
  });
  secondAdmin = sessionFor(["tenant_admin"], second.userId);

  const learnerInvite = await invitePerson(admin, {
    email: "learner@people.test",
    firstName: "Ordinary",
    lastName: "Learner",
    roles: ["learner"],
  });
  learner = sessionFor(["learner"], learnerInvite.userId);
});

afterAll(async () => {
  await withPlatformScope("people test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("inviting somebody", () => {
  it("creates them with a password that actually works", async () => {
    const email = `new-${suffix()}@people.test`;
    const { initialPassword } = await invitePerson(admin, {
      email,
      firstName: "Brand",
      lastName: "New",
      roles: ["learner"],
    });

    const result = await signIn(organisationId, email, initialPassword);
    expect(result.ok).toBe(true);
  });

  it("refuses a duplicate email address within the tenant", async () => {
    const email = `dupe-${suffix()}@people.test`;
    await invitePerson(admin, { email, firstName: "A", lastName: "Person" });

    await expect(
      invitePerson(admin, { email, firstName: "Another", lastName: "Person" }),
    ).rejects.toMatchObject({ code: "duplicate" });
  });

  it("stops a learner inviting anybody", async () => {
    await expect(
      invitePerson(learner, {
        email: `nope-${suffix()}@people.test`,
        firstName: "Should",
        lastName: "Fail",
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("never writes the initial password into the audit log", async () => {
    const email = `audit-${suffix()}@people.test`;
    const { userId, initialPassword } = await invitePerson(admin, {
      email,
      firstName: "Audited",
      lastName: "Person",
    });

    const entries = await withTenant(organisationId, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.entityId, userId)),
    );

    expect(JSON.stringify(entries)).not.toContain(initialPassword);
  });

  it("produces a different password each time", () => {
    const passwords = new Set(
      Array.from({ length: 200 }, generateInitialPassword),
    );
    expect(passwords.size).toBeGreaterThan(190);
  });
});

/**
 * A learner registered and then forgotten.
 *
 * Not a security matter — being a learner grants no access on its own, and an
 * unenrolled one sees an empty screen rather than somebody else's material.
 * The problem is that nothing else in the platform would ever mention them,
 * so they sit there wondering what to do while everybody assumes they are
 * getting on with it.
 */
describe("learners nobody enrolled", () => {
  it("flags a learner with nothing assigned", async () => {
    const { userId } = await invitePerson(admin, {
      email: `stranded-${suffix()}@people.test`,
      firstName: "Stranded",
      lastName: "Learner",
      roles: ["learner"],
    });

    const listed = (await listPeople(admin)).find((row) => row.id === userId)!;

    expect(listed.awaitingEnrolment).toBe(true);
  });

  it("stops flagging them once they are enrolled", async () => {
    const { userId } = await invitePerson(admin, {
      email: `enrolled-${suffix()}@people.test`,
      firstName: "Properly",
      lastName: "Enrolled",
      roles: ["learner"],
    });

    const course = await createCourse(admin, { title: `Course ${suffix()}` });
    const section = await addSection(admin, {
      courseId: course.id,
      title: "Section",
    });
    await addLesson(admin, { sectionId: section.id, title: "Lesson" });
    await tagCourseCompetency(admin, course.id, competencyId);
    const published = await publishCourse(admin, course.id);
    if (!published.ok) throw new Error(published.reasons.join(" "));

    await enrolUser(admin, { userId, courseId: course.id });

    const listed = (await listPeople(admin)).find((row) => row.id === userId)!;
    expect(listed.awaitingEnrolment).toBe(false);
  });

  /**
   * An assessor or a moderator is never enrolled on anything, and flagging
   * them would train whoever reads this list to ignore it.
   */
  it("says nothing about somebody who is not a learner", async () => {
    const { userId } = await invitePerson(admin, {
      email: `assessor-${suffix()}@people.test`,
      firstName: "An",
      lastName: "Assessor",
      roles: ["assessor"],
    });

    const listed = (await listPeople(admin)).find((row) => row.id === userId)!;

    expect(listed.awaitingEnrolment).toBe(false);
  });

  it("says nothing about a suspended learner, who is not waiting for anything", async () => {
    const { userId } = await invitePerson(admin, {
      email: `suspended-${suffix()}@people.test`,
      firstName: "Suspended",
      lastName: "Learner",
      roles: ["learner"],
    });
    await setPersonStatus(admin, userId, "suspended");

    const listed = (await listPeople(admin)).find((row) => row.id === userId)!;

    expect(listed.awaitingEnrolment).toBe(false);
  });
});

describe("identity numbers", () => {
  /** Catching this while the document is in front of you is the whole point. */
  it("refuses a mistyped identity number on invite", async () => {
    const wrong = VALID_ID.slice(0, 12) + ((Number(VALID_ID[12]) + 1) % 10);

    await expect(
      invitePerson(admin, {
        email: `badid-${suffix()}@people.test`,
        firstName: "Bad",
        lastName: "Identity",
        nationalId: wrong,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("accepts a valid one", async () => {
    const { userId } = await invitePerson(admin, {
      email: `goodid-${suffix()}@people.test`,
      firstName: "Good",
      lastName: "Identity",
      nationalId: VALID_ID,
    });

    const { person } = await getPerson(admin, userId);
    expect(person.nationalId).toBe(VALID_ID);
  });
});

describe("editing", () => {
  it("updates the fields the statutory return needs", async () => {
    const { userId } = await invitePerson(admin, {
      email: `edit-${suffix()}@people.test`,
      firstName: "Needs",
      lastName: "Details",
    });

    await updatePerson(admin, userId, {
      email: `edit-${suffix()}@people.test`,
      firstName: "Needs",
      lastName: "Details",
      nationalId: VALID_ID,
      equityCode: "AF",
      ofoCode: "2026-811201",
    });

    const { person } = await getPerson(admin, userId);
    expect(person.equityCode).toBe("AF");
    expect(person.ofoCode).toBe("2026-811201");
  });

  it("refuses to make somebody their own line manager", async () => {
    const { userId } = await invitePerson(admin, {
      email: `self-${suffix()}@people.test`,
      firstName: "Own",
      lastName: "Manager",
    });

    await expect(
      updatePerson(admin, userId, {
        email: `self-${suffix()}@people.test`,
        firstName: "Own",
        lastName: "Manager",
        lineManagerId: userId,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("flags what is still missing for a statutory return", async () => {
    const { userId } = await invitePerson(admin, {
      email: `missing-${suffix()}@people.test`,
      firstName: "Missing",
      lastName: "Fields",
    });

    const listed = (await listPeople(admin)).find((row) => row.id === userId)!;
    expect(listed.missingForStatutory).toContain("identity number");
    expect(listed.missingForStatutory).toContain("equity code");
    expect(listed.missingForStatutory).toContain("OFO code");
  });
});

describe("not locking yourself out", () => {
  it("stops you changing your own roles", async () => {
    await expect(
      setRoles(admin, admin.userId, ["learner"]),
    ).rejects.toMatchObject({ code: "not_permitted" });
  });

  it("stops you suspending your own account", async () => {
    await expect(
      setPersonStatus(admin, admin.userId, "suspended"),
    ).rejects.toMatchObject({ code: "not_permitted" });
  });

  it("stops you anonymising your own account", async () => {
    await expect(
      anonymisePerson(admin, admin.userId, "Testing the guard."),
    ).rejects.toMatchObject({ code: "not_permitted" });
  });

  /**
   * The one that would need ROFT with database access to repair.
   */
  it("refuses to remove the last administrator's role", async () => {
    const slug = `solo-${Date.now()}`;

    const { orgId, soloId, otherId } = await withPlatformScope(
      "single administrator fixture",
      async (tx) => {
        const [organisation] = await tx
          .insert(organisations)
          .values({
            slug,
            legalName: `${slug} Ltd`,
            displayName: "Solo Admin Co",
            status: "active",
          })
          .returning({ id: organisations.id });

        const { userRoles } = await import("@/db/schema");

        const [solo] = await tx
          .insert(users)
          .values({
            organisationId: organisation.id,
            email: "solo@solo.test",
            firstName: "Solo",
            lastName: "Administrator",
            status: "active",
          })
          .returning({ id: users.id });

        await tx.insert(userRoles).values({
          organisationId: organisation.id,
          userId: solo.id,
          role: "tenant_admin",
        });

        const [other] = await tx
          .insert(users)
          .values({
            organisationId: organisation.id,
            email: "other@solo.test",
            firstName: "Another",
            lastName: "Administrator",
            status: "active",
          })
          .returning({ id: users.id });

        await tx.insert(userRoles).values({
          organisationId: organisation.id,
          userId: other.id,
          role: "tenant_admin",
        });

        return { orgId: organisation.id, soloId: solo.id, otherId: other.id };
      },
    );

    const otherSession: AuthenticatedSession = {
      sessionId: "00000000-0000-0000-0000-000000000000",
      userId: otherId,
      organisationId: orgId,
      email: "other@solo.test",
      firstName: "Another",
      lastName: "Administrator",
      roles: ["tenant_admin"],
      permissions: permissionsFor({ roles: ["tenant_admin"] }),
      mustChangePassword: false,
      aiOn: false,
    };

    // Two administrators: removing one is fine.
    await setRoles(otherSession, soloId, ["learner"]);

    // Now `otherId` is the only one left, and a third party tries to demote
    // them. There is no third administrator, so this must be refused.
    const soloSession: AuthenticatedSession = {
      ...otherSession,
      userId: soloId,
      roles: ["tenant_admin"],
      permissions: permissionsFor({ roles: ["tenant_admin"] }),
      mustChangePassword: false,
      aiOn: false,
    };

    await expect(
      setRoles(soloSession, otherId, ["learner"]),
    ).rejects.toMatchObject({ code: "would_lock_out" });

    await withPlatformScope("single administrator teardown", (tx) =>
      tx.delete(organisations).where(eq(organisations.id, orgId)),
    );
  });

  it("allows removing an administrator while another remains", async () => {
    const { userId } = await invitePerson(admin, {
      email: `third-${suffix()}@people.test`,
      firstName: "Third",
      lastName: "Administrator",
      roles: ["tenant_admin"],
    });

    await expect(
      setRoles(secondAdmin, userId, ["learner"]),
    ).resolves.toEqual(["learner"]);
  });
});

describe("suspending", () => {
  it("ends every session immediately", async () => {
    const email = `suspend-${suffix()}@people.test`;
    const { userId, initialPassword } = await invitePerson(admin, {
      email,
      firstName: "To Be",
      lastName: "Suspended",
      roles: ["learner"],
    });

    const signedIn = await signIn(organisationId, email, initialPassword);
    if (!signedIn.ok) throw new Error("sign in failed");
    expect(await resolveSession(organisationId, signedIn.token)).not.toBeNull();

    await setPersonStatus(admin, userId, "suspended");

    expect(await resolveSession(organisationId, signedIn.token)).toBeNull();
    expect((await signIn(organisationId, email, initialPassword)).ok).toBe(
      false,
    );
  });

  it("lets them back in when reactivated", async () => {
    const email = `reactivate-${suffix()}@people.test`;
    const { userId, initialPassword } = await invitePerson(admin, {
      email,
      firstName: "Back",
      lastName: "Again",
      roles: ["learner"],
    });

    await setPersonStatus(admin, userId, "suspended");
    await setPersonStatus(admin, userId, "active");

    expect((await signIn(organisationId, email, initialPassword)).ok).toBe(true);
  });
});

describe("resetting a password", () => {
  it("issues a working password and ends existing sessions", async () => {
    const email = `reset-${suffix()}@people.test`;
    const { userId, initialPassword } = await invitePerson(admin, {
      email,
      firstName: "Forgot",
      lastName: "Password",
      roles: ["learner"],
    });

    const before = await signIn(organisationId, email, initialPassword);
    if (!before.ok) throw new Error("sign in failed");

    const fresh = await resetPassword(admin, userId);

    expect(await resolveSession(organisationId, before.token)).toBeNull();
    expect((await signIn(organisationId, email, initialPassword)).ok).toBe(
      false,
    );
    expect((await signIn(organisationId, email, fresh)).ok).toBe(true);
  });
});

describe("anonymising for POPIA", () => {
  /** Builds someone with a real, earned certificate. */
  async function personWithCertificate() {
    const email = `anon-${suffix()}@people.test`;
    const { userId } = await invitePerson(admin, {
      email,
      firstName: "Erasure",
      lastName: "Request",
      nationalId: VALID_ID,
      equityCode: "AF",
      roles: ["learner"],
    });

    const course = await createCourse(admin, { title: `Course ${suffix()}` });
    const section = await addSection(admin, {
      courseId: course.id,
      title: "Section",
    });
    await addLesson(admin, { sectionId: section.id, title: "Lesson" });
    await tagCourseCompetency(admin, course.id, competencyId);
    const published = await publishCourse(admin, course.id);
    if (!published.ok) throw new Error(published.reasons.join(" "));

    const theirSession = sessionFor(["learner"], userId);
    const enrolment = await enrolUser(admin, { userId, courseId: course.id });
    const delivery = await getEnrolmentForDelivery(theirSession, enrolment.id);
    for (const lesson of delivery.sections.flatMap((s) => s.lessons)) {
      await markLessonComplete(theirSession, enrolment.id, lesson.id);
    }

    const [certificate] = await withTenant(organisationId, (tx) =>
      tx.select().from(certificates).where(eq(certificates.userId, userId)),
    );

    return { userId, certificate };
  }

  it("clears the personal details", async () => {
    const { userId } = await personWithCertificate();
    await anonymisePerson(admin, userId, "Data subject requested erasure.");

    const { person } = await getPerson(admin, userId);
    expect(person.nationalId).toBeNull();
    expect(person.equityCode).toBeNull();
    expect(person.firstName).toBe("Anonymised");
    expect(person.status).toBe("anonymised");
    expect(person.email).not.toContain("anon-");
  });

  /**
   * The competing obligation: POPIA grants erasure, SAQA requires achievement
   * records to be kept. Both hold only if the two are separable.
   */
  it("keeps the achievement record and its verification", async () => {
    const { userId, certificate } = await personWithCertificate();
    await anonymisePerson(admin, userId, "Data subject requested erasure.");

    const verification = await verifyByReference(
      certificate.verificationReference,
    );

    expect(verification.found).toBe(true);
    expect(verification.valid).toBe(true);
    expect(verification.competencies?.[0].code).toBe("PPL-01");
  });

  it("stops them signing in afterwards", async () => {
    const { userId } = await personWithCertificate();
    const { person } = await getPerson(admin, userId);

    await anonymisePerson(admin, userId, "Data subject requested erasure.");

    expect((await signIn(organisationId, person.email, "anything")).ok).toBe(
      false,
    );
  });

  it("cannot be done twice", async () => {
    const { userId } = await personWithCertificate();
    await anonymisePerson(admin, userId, "Data subject requested erasure.");

    await expect(
      anonymisePerson(admin, userId, "Data subject requested erasure."),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("refuses to edit an anonymised record afterwards", async () => {
    const { userId } = await personWithCertificate();
    await anonymisePerson(admin, userId, "Data subject requested erasure.");

    await expect(
      updatePerson(admin, userId, {
        email: `revived-${suffix()}@people.test`,
        firstName: "Brought",
        lastName: "Back",
      }),
    ).rejects.toMatchObject({ code: "not_permitted" });
  });

  it("requires a reason, which the audit log keeps", async () => {
    const { userId } = await personWithCertificate();

    await expect(anonymisePerson(admin, userId, "no")).rejects.toMatchObject({
      code: "invalid_input",
    });

    await anonymisePerson(admin, userId, "Left the company and asked us to erase.");

    const entries = await withTenant(organisationId, (tx) =>
      tx
        .select({ action: auditLog.action, after: auditLog.after })
        .from(auditLog)
        .where(eq(auditLog.entityId, userId)),
    );

    const entry = entries.find((row) => row.action === "user.anonymised");
    expect(entry?.after).toMatchObject({ reason: expect.any(String) });
  });

  it("stops a learner anonymising anybody", async () => {
    const { userId } = await personWithCertificate();
    await expect(
      anonymisePerson(learner, userId, "Trying it on."),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("changing your own password", () => {
  async function invitedPerson() {
    const email = `pw-${suffix()}@people.test`;
    const { userId, initialPassword } = await invitePerson(admin, {
      email,
      firstName: "Temp",
      lastName: "Password",
      roles: ["learner"],
    });
    const result = await signIn(organisationId, email, initialPassword);
    if (!result.ok) throw new Error("could not sign in with initial password");
    return { email, userId, initialPassword, session: result.session };
  }

  it("marks an invited person as needing to choose their own", async () => {
    const { session } = await invitedPerson();
    expect(session.mustChangePassword).toBe(true);
  });

  it("clears the flag once they have chosen one", async () => {
    const { email, initialPassword, session } = await invitedPerson();
    await changeOwnPassword(session, initialPassword, "a-much-longer-passphrase");

    const again = await signIn(organisationId, email, "a-much-longer-passphrase");
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.session.mustChangePassword).toBe(false);
  });

  it("refuses without the current password", async () => {
    const { session } = await invitedPerson();
    await expect(
      changeOwnPassword(session, "not-the-password", "a-much-longer-passphrase"),
    ).rejects.toMatchObject({ code: "not_permitted" });
  });

  it("refuses a new password that is too weak to be worth setting", async () => {
    const { initialPassword, session } = await invitedPerson();
    await expect(
      changeOwnPassword(session, initialPassword, "short"),
    ).rejects.toBeInstanceOf(WeakPasswordError);
  });

  it("refuses reusing the password that was handed over", async () => {
    const { initialPassword, session } = await invitedPerson();
    await expect(
      changeOwnPassword(session, initialPassword, initialPassword),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("ends other sessions but not the one making the change", async () => {
    const { email, initialPassword, session } = await invitedPerson();

    // A second sign-in: whoever was given the password and used it.
    const other = await signIn(organisationId, email, initialPassword);
    if (!other.ok) throw new Error("second sign-in failed");

    await changeOwnPassword(session, initialPassword, "a-much-longer-passphrase");

    expect(await resolveSession(organisationId, other.token)).toBeNull();
  });

  it("makes an administrator reset require a fresh choice", async () => {
    const { email, userId } = await invitedPerson();
    const reset = await resetPassword(admin, userId);

    const result = await signIn(organisationId, email, reset);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.mustChangePassword).toBe(true);
  });
});
