/**
 * Whether a learner's place has been paid for.
 *
 * Curiosa's enrolment procedure opens with it: the process begins "once the
 * client has been invoiced and proof of payment has been received". The client,
 * note, not the learner - a company buys places for a group and one payment
 * covers the lot.
 *
 * Roland confirmed on 15 September that it can be either: a cohort the client
 * paid for, or a learner paying their own way. So both are asked and either
 * satisfies. Insisting on one shape would be telling a provider how to run its
 * commercial relationships, which is not the platform's business.
 *
 * Reported, never enforced. A coordinator may have good reason to enrol
 * somebody while a payment clears.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import {
  cohortMembers,
  cohorts,
  courses,
  enrolmentDocuments,
  organisations,
  userRoles,
  users,
} from "@/db/schema";
import {
  paymentStanding,
  recordCohortPayment,
} from "@/lib/enrolment-documents";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let inCohort: string;
let payingOwnWay: string;
let nobody: string;
let cohortId: string;

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "admin@example.test",
    firstName: "Test",
    lastName: "Admin",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

beforeAll(async () => {
  const slug = `payment-${Date.now()}`;

  const made = await withPlatformScope("payment fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Payment Test Provider",
        status: "active",
      })
      .returning({ id: organisations.id });

    const orgId = organisation.id;

    const [course] = await tx
      .insert(courses)
      .values({ organisationId: orgId, title: "A course", status: "published" })
      .returning({ id: courses.id });

    const [cohort] = await tx
      .insert(cohorts)
      .values({
        organisationId: orgId,
        courseId: course.id,
        name: "Client Intake",
        status: "running",
        startDate: "2026-03-02",
      })
      .returning({ id: cohorts.id });

    const people: Record<string, string> = {};
    for (const key of ["admin", "inCohort", "payingOwnWay", "nobody"]) {
      const [person] = await tx
        .insert(users)
        .values({
          organisationId: orgId,
          email: `${key}@payment.test`,
          firstName: "Payment",
          lastName: key,
          status: "active",
        })
        .returning({ id: users.id });
      await tx.insert(userRoles).values({
        organisationId: orgId,
        userId: person.id,
        role: key === "admin" ? "tenant_admin" : "learner",
      });
      people[key] = person.id;
    }

    // Only one of them is in the cohort the client will pay for.
    await tx.insert(cohortMembers).values({
      organisationId: orgId,
      cohortId: cohort.id,
      userId: people.inCohort,
    });

    return { orgId, people, cohort: cohort.id };
  });

  organisationId = made.orgId;
  admin = sessionFor(["tenant_admin"], made.people.admin);
  inCohort = made.people.inCohort;
  payingOwnWay = made.people.payingOwnWay;
  nobody = made.people.nobody;
  cohortId = made.cohort;
});

afterAll(async () => {
  await withPlatformScope("payment teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("nothing recorded at all", () => {
  it("names both ways it could have been settled", async () => {
    const standing = await paymentStanding(admin, nobody);

    expect(standing.settled).toBe(false);
    expect(standing.by).toBeNull();
    expect(standing.says).toContain("neither the cohort nor the learner");
  });
});

describe("a cohort the client pays for", () => {
  /**
   * Two dates rather than one flag. The gap between invoicing and payment is
   * exactly what a coordinator chases, and a single "paid" tick would throw it
   * away.
   */
  it("is not settled by an invoice alone, and says so", async () => {
    await recordCohortPayment(admin, cohortId, { invoicedOn: "2026-02-01" });

    const standing = await paymentStanding(admin, inCohort);

    expect(standing.settled).toBe(false);
    expect(standing.says).toContain("Client Intake has been invoiced");
    expect(standing.says).toContain("no payment is recorded");
  });

  it("is settled once the payment is recorded", async () => {
    await recordCohortPayment(admin, cohortId, {
      receivedOn: "2026-02-14",
      reference: "INV-2026-0041",
    });

    const standing = await paymentStanding(admin, inCohort);

    expect(standing.settled).toBe(true);
    expect(standing.by).toBe("cohort");
    expect(standing.cohortName).toBe("Client Intake");
    expect(standing.reference).toBe("INV-2026-0041");
    expect(standing.says).toContain("Paid for by the client");
  });

  it("covers only the learners actually in that cohort", async () => {
    // The other two are not members, so the client's payment says nothing
    // about them.
    expect((await paymentStanding(admin, payingOwnWay)).settled).toBe(false);
    expect((await paymentStanding(admin, nobody)).settled).toBe(false);
  });
});

describe("a learner paying their own way", () => {
  it("is not settled while their proof is unchecked", async () => {
    await withPlatformScope("own proof", (tx) =>
      tx.insert(enrolmentDocuments).values({
        organisationId,
        userId: payingOwnWay,
        kind: "proof_of_payment",
        filename: "eft.pdf",
        storageKey: `test/${Date.now()}`,
        mimeType: "application/pdf",
        sizeBytes: 1024,
        // The table records a digest of every file, so a fixture needs one.
        sha256: "0".repeat(64),
        uploadedById: admin.userId,
        verification: "pending",
      }),
    );

    const standing = await paymentStanding(admin, payingOwnWay);

    expect(standing.settled).toBe(false);
    expect(standing.says).toContain("not yet checked");
  });

  it("is settled once somebody has accepted it", async () => {
    await withPlatformScope("accept own proof", (tx) =>
      tx
        .update(enrolmentDocuments)
        .set({ verification: "accepted" })
        .where(eq(enrolmentDocuments.userId, payingOwnWay)),
    );

    const standing = await paymentStanding(admin, payingOwnWay);

    expect(standing.settled).toBe(true);
    expect(standing.by).toBe("learner");
    expect(standing.says).toContain("their own proof of payment");
  });

  it("is not settled when it was refused, and says that", async () => {
    await withPlatformScope("refuse own proof", (tx) =>
      tx
        .update(enrolmentDocuments)
        .set({ verification: "refused", refusedReason: "Wrong amount." })
        .where(eq(enrolmentDocuments.userId, payingOwnWay)),
    );

    const standing = await paymentStanding(admin, payingOwnWay);

    expect(standing.settled).toBe(false);
    expect(standing.says).toContain("refused");
  });
});

describe("who may record a payment", () => {
  it("keeps a learner out of it", async () => {
    const learner = sessionFor(["learner"], inCohort);

    await expect(
      recordCohortPayment(learner, cohortId, { receivedOn: "2026-02-14" }),
    ).rejects.toThrow();
  });
});
