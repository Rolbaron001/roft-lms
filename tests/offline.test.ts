/**
 * Offline work, and the rules that keep it defensible.
 *
 * The ranger programme is the reason this exists: learners in the field, a
 * fortnight between connections. Three of these tests guard decisions that
 * could have gone the other way and would have been wrong - the default being
 * strict, the two clocks, and a conflict being held rather than merged.
 *
 * The first test in the file is the most important one and is about absence:
 * a tenant that has not asked for offline must be untouched by all of it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { organisations, qualifications, userRoles, users } from "@/db/schema";
import {
  ALWAYS_OFFLINE,
  awaitingResolution,
  capturedUnderRelaxedRule,
  clockGapHours,
  holdForResolution,
  NEVER_OFFLINE,
  offlineAllows,
  offlineEnabledFor,
  receiveSubmission,
  setOfflineSummatives,
} from "@/lib/offline";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let offlineOrg: string;
let plainOrg: string;
let admin: AuthenticatedSession;
let plainAdmin: AuthenticatedSession;
let learner: AuthenticatedSession;
let strictQualification: string;
let relaxedQualification: string;

function sessionFor(
  roles: Role[],
  userId: string,
  organisationId: string,
): AuthenticatedSession {
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

beforeAll(async () => {
  const stamp = Date.now();

  const made = await withPlatformScope("offline fixture", async (tx) => {
    // One tenant with offline switched on, and one without - because the
    // constraint Roland set is about the second one.
    const [on] = await tx
      .insert(organisations)
      .values({
        slug: `offline-on-${stamp}`,
        legalName: "Offline On Ltd",
        displayName: "Rangers Provider",
        status: "active",
        offlineEnabled: true,
      })
      .returning({ id: organisations.id });

    const [off] = await tx
      .insert(organisations)
      .values({
        slug: `offline-off-${stamp}`,
        legalName: "Offline Off Ltd",
        displayName: "Ordinary Provider",
        status: "active",
      })
      .returning({ id: organisations.id });

    const people: Record<string, string> = {};
    for (const [key, orgId, email, role] of [
      ["admin", on.id, "admin@offline.test", "tenant_admin"],
      ["learner", on.id, "ranger@offline.test", "learner"],
      ["plainAdmin", off.id, "admin@plain.test", "tenant_admin"],
    ] as const) {
      const [person] = await tx
        .insert(users)
        .values({
          organisationId: orgId,
          email,
          firstName: "Offline",
          lastName: "Tester",
          status: "active",
        })
        .returning({ id: users.id });
      await tx
        .insert(userRoles)
        .values({ organisationId: orgId, userId: person.id, role });
      people[key] = person.id;
    }

    const [strict] = await tx
      .insert(qualifications)
      .values({
        organisationId: on.id,
        title: "Accredited Programme",
        kind: "full",
        saqaId: "111111",
      })
      .returning({ id: qualifications.id });

    const [relaxed] = await tx
      .insert(qualifications)
      .values({
        organisationId: on.id,
        title: "Ranger Programme",
        kind: "skills_programme",
        saqaId: "222222",
      })
      .returning({ id: qualifications.id });

    return { on: on.id, off: off.id, people, strict: strict.id, relaxed: relaxed.id };
  });

  offlineOrg = made.on;
  plainOrg = made.off;
  admin = sessionFor(["tenant_admin"], made.people.admin, offlineOrg);
  learner = sessionFor(["learner"], made.people.learner, offlineOrg);
  plainAdmin = sessionFor(["tenant_admin"], made.people.plainAdmin, plainOrg);
  strictQualification = made.strict;
  relaxedQualification = made.relaxed;
});

afterAll(async () => {
  await withPlatformScope("offline teardown", (tx) =>
    tx.delete(organisations).where(inArray(organisations.id, [offlineOrg, plainOrg])),
  );
});

describe("a tenant that never asked for offline", () => {
  /**
   * Roland, 10 September: "the platform works as it is and must not change.
   * Offline is additional functionality for tenants that need it - off by
   * default, invisible to every tenant that does not turn it on."
   */
  it("has it switched off without anybody choosing that", async () => {
    expect(await offlineEnabledFor(plainOrg)).toBe(false);
  });

  it("cannot have work submitted against it at all", async () => {
    await expect(
      receiveSubmission(plainAdmin, {
        kind: "formative_answer",
        targetType: "assessment",
        targetId: strictQualification,
        payload: { answer: "anything" },
        deviceKey: "plain-device-key-1",
        capturedAt: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ reason: "not_enabled" });
  });
});

describe("what may be done with no signal", () => {
  it("allows reading, formative work and workplace evidence on any programme", () => {
    for (const kind of ALWAYS_OFFLINE) {
      expect(
        offlineAllows(kind, { offlineSummativesAllowed: false }),
      ).toMatchObject({ allowed: true });
    }
  });

  it("never allows anything needing a second person", () => {
    for (const kind of NEVER_OFFLINE) {
      const verdict = offlineAllows(kind, { offlineSummativesAllowed: true });
      expect(verdict.allowed).toBe(false);
      // Even where the programme is at its most permissive.
      if (!verdict.allowed) {
        expect(verdict.why).toContain("second person");
      }
    }
  });

  /**
   * The default that matters most. A programme is treated as accredited unless
   * somebody deliberately says otherwise: getting this the wrong way round
   * means the permissive setting arrives by accident.
   */
  it("refuses a summative unless the programme says otherwise", () => {
    const verdict = offlineAllows("summative_answer", {
      offlineSummativesAllowed: false,
    });

    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.why).toContain("not defensible");
    }
  });

  it("allows one where a provider has deliberately said so", () => {
    expect(
      offlineAllows("summative_answer", { offlineSummativesAllowed: true }),
    ).toEqual({ allowed: true, underRelaxedRule: true });
  });
});

describe("taking work from a device", () => {
  it("keeps both clocks, and never lets one stand in for the other", async () => {
    // A fortnight in the field: the device captured this long before the
    // server heard about it.
    const captured = new Date(Date.now() - 14 * 86_400_000);

    const saved = await receiveSubmission(learner, {
      kind: "workplace_evidence",
      targetType: "workplace_logbook",
      targetId: relaxedQualification,
      payload: { note: "Fence line inspected." },
      deviceKey: "ranger-device-key-1",
      capturedAt: captured.toISOString(),
    });

    expect(saved.capturedAt.toISOString()).toBe(captured.toISOString());
    expect(saved.receivedAt.getTime()).toBeGreaterThan(
      saved.capturedAt.getTime(),
    );
    expect(clockGapHours(saved)).toBeGreaterThan(300);
  });

  /**
   * A phone that uploads, loses signal before hearing the reply, and retries
   * must not create the work twice - and must not move the date the server
   * first heard.
   */
  it("takes the same work twice without duplicating it", async () => {
    const capturedAt = new Date(Date.now() - 3600_000).toISOString();
    const once = await receiveSubmission(learner, {
      kind: "formative_answer",
      targetType: "assessment",
      targetId: relaxedQualification,
      payload: { answer: "42" },
      deviceKey: "ranger-device-key-retry",
      capturedAt,
    });

    const twice = await receiveSubmission(learner, {
      kind: "formative_answer",
      targetType: "assessment",
      targetId: relaxedQualification,
      payload: { answer: "42" },
      deviceKey: "ranger-device-key-retry",
      capturedAt,
    });

    expect(twice.id).toBe(once.id);
    expect(twice.receivedAt.toISOString()).toBe(once.receivedAt.toISOString());
  });

  it("refuses a summative on a programme that has not allowed it", async () => {
    await expect(
      receiveSubmission(learner, {
        kind: "summative_answer",
        targetType: "assessment",
        targetId: strictQualification,
        qualificationId: strictQualification,
        payload: { answer: "b" },
        deviceKey: "ranger-device-key-summative",
        capturedAt: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ reason: "not_allowed" });
  });
});

describe("relaxing the rule, and living with having relaxed it", () => {
  it("is a deliberate act and is recorded", async () => {
    const updated = await setOfflineSummatives(admin, relaxedQualification, true);

    expect(updated.offlineSummativesAllowed).toBe(true);
    expect(updated.offlineSummativesAllowedAt).not.toBeNull();
  });

  it("then accepts a summative, and marks what it was captured under", async () => {
    const saved = await receiveSubmission(learner, {
      kind: "summative_answer",
      targetType: "assessment",
      targetId: relaxedQualification,
      qualificationId: relaxedQualification,
      payload: { answer: "c" },
      deviceKey: "ranger-device-key-summative-ok",
      capturedAt: new Date().toISOString(),
    });

    expect(saved.underRelaxedRule).toBe(true);
  });

  /**
   * The thing the 10 September notes flagged as the one that would bite.
   * Accreditation arrives partway through, and work done under the looser rule
   * does not retrospectively become defensible. Whether it needs re-assessing
   * is Heidi's call; the platform owes her the list.
   */
  it("can still show what was captured once the rule is tightened again", async () => {
    await setOfflineSummatives(admin, relaxedQualification, false);

    const list = await capturedUnderRelaxedRule(admin);

    expect(list.length).toBeGreaterThan(0);
    expect(list.some((row) => row.kind === "summative_answer")).toBe(true);
    // Named, so somebody can act on it rather than read a count.
    expect(list[0].firstName).toBeTruthy();
  });

  it("leaves work captured under the strict rule out of that list", async () => {
    const list = await capturedUnderRelaxedRule(admin);
    expect(list.every((row) => row.kind !== "workplace_evidence")).toBe(true);
  });
});

describe("a conflict", () => {
  /**
   * Last-write-wins discards somebody's work without telling anyone, which is
   * the one outcome assessment evidence cannot tolerate.
   */
  it("is held for a person rather than merged", async () => {
    const saved = await receiveSubmission(learner, {
      kind: "formative_answer",
      targetType: "assessment",
      targetId: relaxedQualification,
      payload: { answer: "late" },
      deviceKey: "ranger-device-key-conflict",
      capturedAt: new Date(Date.now() - 86_400_000).toISOString(),
    });

    await holdForResolution(
      admin,
      saved.id,
      "This was answered on the platform while the learner was out of signal.",
    );

    const waiting = await awaitingResolution(admin);
    const mine = waiting.find((row) => row.id === saved.id);

    expect(mine).toBeTruthy();
    expect(mine?.heldReason).toContain("while the learner was out of signal");
    // Both dates are on the screen, so a person can see the gap themselves.
    expect(mine?.capturedAt).toBeTruthy();
    expect(mine?.receivedAt).toBeTruthy();
  });
});

describe("who may do what", () => {
  it("does not let a learner read the whole queue", async () => {
    await expect(awaitingResolution(learner)).rejects.toThrow();
  });

  it("does not let a learner relax the rule", async () => {
    await expect(
      setOfflineSummatives(learner, strictQualification, true),
    ).rejects.toThrow();
  });
});
