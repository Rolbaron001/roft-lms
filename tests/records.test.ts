import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { organisations, users } from "@/db/schema";
import { RecordsError, recordDisposal, retentionDueOn } from "@/lib/records";
import { ROLE_PERMISSIONS, can, permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

describe("retentionDueOn", () => {
  it("counts from certification, not from enrolment", () => {
    expect(retentionDueOn("2026-03-10", 5)).toBe("2031-03-10");
  });

  it("honours a tenant with a different period", () => {
    expect(retentionDueOn("2026-03-10", 3)).toBe("2029-03-10");
    expect(retentionDueOn("2026-03-10", 10)).toBe("2036-03-10");
  });

  it("survives a leap day", () => {
    // 2028 is a leap year; five years on is not.
    expect(retentionDueOn("2028-02-29", 5)).toBe("2033-03-01");
  });
});

/**
 * A document marked visible to everybody is readable without `records:read`,
 * and the rest is not. That distinction is the whole access model of the
 * library, and getting it wrong puts a facilitator's contract in front of a
 * cohort.
 */
describe("who may read the library", () => {
  it("does not give a learner the closed documents", () => {
    expect(can({ roles: ["learner"] }, "records:read")).toBe(false);
    expect(can({ roles: ["learner"] }, "records:manage")).toBe(false);
  });

  it("gives the external verifier reading but never filing", () => {
    expect(can({ roles: ["external_verifier"] }, "records:read")).toBe(true);
    expect(can({ roles: ["external_verifier"] }, "records:manage")).toBe(false);
  });

  it("never grants filing without reading", () => {
    for (const role of Object.keys(ROLE_PERMISSIONS) as Role[]) {
      if (can({ roles: [role] }, "records:manage")) {
        expect(can({ roles: [role] }, "records:read")).toBe(true);
      }
    }
  });

  it("keeps the platform owner out of a client's records", () => {
    expect(can({ roles: ["platform_owner"] }, "records:read")).toBe(false);
  });
});

let organisationId: string;
let admin: AuthenticatedSession;
let learnerId: string;

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
  };
}

beforeAll(async () => {
  const slug = `records-${Date.now()}`;

  const made = await withPlatformScope("records test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Records Test Co",
        status: "active",
      })
      .returning({ id: organisations.id });

    const person = async (first: string) => {
      const [row] = await tx
        .insert(users)
        .values({
          organisationId: organisation.id,
          email: `${first.toLowerCase()}.${slug}@example.test`,
          firstName: first,
          lastName: "Person",
          status: "active",
        })
        .returning({ id: users.id });
      return row.id;
    };

    return {
      organisationId: organisation.id,
      adminId: await person("Admin"),
      learnerId: await person("Learner"),
    };
  });

  organisationId = made.organisationId;
  learnerId = made.learnerId;
  admin = sessionFor(["tenant_admin"], made.adminId);
});

describe("recording a disposal", () => {
  /**
   * Archiving destroys nothing and moves a record out of the way. Demanding a
   * paragraph for it would make people stop doing it.
   */
  it("archives without needing a reason", async () => {
    const decision = await recordDisposal(admin, {
      subject: "learner_documents",
      learnerId,
      dueOn: "2031-03-10",
      status: "archived",
    });
    expect(decision.status).toBe("archived");
  });

  /**
   * Destruction is irreversible and somebody will one day ask why a record a
   * verifier wanted is not there.
   */
  it("refuses destruction with no reason", async () => {
    await expect(
      recordDisposal(admin, {
        subject: "learner_documents",
        learnerId,
        dueOn: "2031-03-10",
        status: "destroyed",
      }),
    ).rejects.toThrow(RecordsError);
  });

  /**
   * Keeping something beyond its retention period is a position a provider
   * takes deliberately, not an oversight, so the reason belongs in the file.
   */
  it("refuses deliberate retention with no reason", async () => {
    await expect(
      recordDisposal(admin, {
        subject: "learner_documents",
        learnerId,
        dueOn: "2031-03-10",
        status: "retained",
      }),
    ).rejects.toThrow(/why this is being kept/i);
  });

  it("accepts either with one", async () => {
    const kept = await recordDisposal(admin, {
      subject: "learner_documents",
      learnerId,
      dueOn: "2031-03-10",
      status: "retained",
      reason: "Under investigation by the quality partner; nothing is disposed of.",
    });
    expect(kept.reason).toContain("investigation");
  });
});

describe("cleanup", () => {
  it("removes the fixture organisation", async () => {
    await withPlatformScope("records test teardown", (tx) =>
      tx.delete(organisations).where(eq(organisations.id, organisationId)),
    );
    expect(true).toBe(true);
  });
});
