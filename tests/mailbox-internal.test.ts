/**
 * Platform mail stays inside the platform.
 *
 * This is the rule the whole design now rests on, and it replaced the opposite
 * behaviour: every message used to be handed to the outbound SMTP relay, so a
 * mailbox described as internal could in fact write to any address on the
 * internet, through the provider's own mail server and carrying its
 * reputation.
 *
 * Three things follow, and all three are held here:
 *
 *   1. A message to somebody at this provider is filed into their mailbox.
 *   2. A message to anywhere else is refused, not quietly relayed.
 *   3. Nothing in this path touches SMTP at all.
 *
 * If a change makes one of these fail, the change is wrong: the failure mode
 * is a learner's private correspondence leaving the platform without anybody
 * intending it to.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import { mailMessages, organisations, userRoles, users } from "@/db/schema";
import { listMailbox, sendFromMailbox, MailboxError } from "@/lib/mailbox";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

const stamp = Date.now();
const SLUG = `mbox-${stamp}`;

let organisationId: string;
let assessorId: string;
let learnerId: string;
let assessor: AuthenticatedSession;
let learner: AuthenticatedSession;

const assessorAddress = `a.dube${stamp}@lms.internal`;
const learnerAddress = `s.mokoena${stamp}@lms.internal`;

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

beforeAll(async () => {
  const made = await withPlatformScope("mailbox internal setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug: SLUG,
        legalName: "Mailbox Test Ltd",
        displayName: "Mailbox Test",
        status: "active",
      })
      .returning({ id: organisations.id });

    const people = await tx
      .insert(users)
      .values([
        {
          organisationId: organisation.id,
          email: `assessor${stamp}@mail.test`,
          passwordHash: "x",
          firstName: "Ayanda",
          lastName: "Dube",
          status: "active",
          mailboxAddress: assessorAddress,
        },
        {
          organisationId: organisation.id,
          email: `learner${stamp}@mail.test`,
          passwordHash: "x",
          firstName: "Sipho",
          lastName: "Mokoena",
          status: "active",
          mailboxAddress: learnerAddress,
        },
      ])
      .returning({ id: users.id });

    await tx.insert(userRoles).values([
      { organisationId: organisation.id, userId: people[0].id, role: "assessor" },
      { organisationId: organisation.id, userId: people[1].id, role: "learner" },
    ]);

    return {
      organisationId: organisation.id,
      assessorId: people[0].id,
      learnerId: people[1].id,
    };
  });

  organisationId = made.organisationId;
  assessorId = made.assessorId;
  learnerId = made.learnerId;
  assessor = sessionFor(["assessor"], assessorId);
  learner = sessionFor(["learner"], learnerId);
});

afterAll(async () => {
  await withPlatformScope("mailbox internal teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("writing to somebody at this provider", () => {
  it("files the message into their mailbox", async () => {
    await sendFromMailbox(assessor, {
      to: learnerAddress,
      subject: "Your workbook",
      body: "Please upload the signed logbook before Friday.",
    });

    const theirs = await listMailbox(learner);
    const received = theirs.messages.find((row) => row.subject === "Your workbook");

    expect(received).toBeDefined();
    expect(received?.direction).toBe("inbound");
    expect(received?.fromAddress).toBe(assessorAddress);
    // Unread, because they have not read it.
    expect(received?.readAt).toBeNull();
  });

  it("keeps the sender a copy, already read", async () => {
    const mine = await listMailbox(assessor);
    const sent = mine.messages.find((row) => row.subject === "Your workbook");

    expect(sent?.direction).toBe("outbound");
    expect(sent?.readAt).not.toBeNull();
  });

  /**
   * Both copies carry the same message identifier, so a reply threads against
   * the original the way it would for mail that came from outside.
   */
  it("threads the two copies together", async () => {
    const rows = await withTenant(organisationId, (tx) =>
      tx
        .select({ messageId: mailMessages.messageId })
        .from(mailMessages)
        .where(eq(mailMessages.subject, "Your workbook")),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].messageId).toBe(rows[1].messageId);
    expect(rows[0].messageId).not.toBeNull();
  });
});

describe("writing anywhere else", () => {
  /**
   * The behaviour this replaced. An address outside the platform used to be
   * relayed out through the provider's mail server; now it is refused, and the
   * refusal says where that correspondence belongs instead.
   */
  it("refuses an address the platform does not hold", async () => {
    await expect(
      sendFromMailbox(assessor, {
        to: "somebody@gmail.com",
        subject: "Hello",
        body: "This should not leave the platform.",
      }),
    ).rejects.toBeInstanceOf(MailboxError);
  });

  it("says what to do instead", async () => {
    await expect(
      sendFromMailbox(assessor, {
        to: "somebody@gmail.com",
        subject: "Hello",
        body: "This should not leave the platform.",
      }),
    ).rejects.toThrow(/use your own email/i);
  });

  it("writes nothing when it refuses", async () => {
    const before = await withTenant(organisationId, (tx) =>
      tx.select({ id: mailMessages.id }).from(mailMessages),
    );

    await expect(
      sendFromMailbox(assessor, {
        to: "somebody@gmail.com",
        subject: "Nothing should be filed",
        body: "Not a word of this should be stored.",
      }),
    ).rejects.toBeInstanceOf(MailboxError);

    const after = await withTenant(organisationId, (tx) =>
      tx.select({ id: mailMessages.id }).from(mailMessages),
    );

    expect(after.length).toBe(before.length);
  });

  /**
   * A mailbox at another provider is as much "outside" as Gmail is. Tenant
   * isolation means the lookup cannot even see it, which is the correct
   * outcome for the correct reason.
   */
  it("refuses a mailbox belonging to a different provider", async () => {
    await expect(
      sendFromMailbox(assessor, {
        to: "someone@other-provider.lms.internal",
        subject: "Across the boundary",
        body: "This must not be deliverable.",
      }),
    ).rejects.toBeInstanceOf(MailboxError);
  });
});

describe("the mailbox module", () => {
  /**
   * The structural guarantee behind all of the above: this module no longer
   * imports the outbound mail transport at all, so no future edit can quietly
   * relay a message by calling it.
   */
  it("does not import the outbound transport", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/mailbox.ts", "utf8");

    expect(source).not.toMatch(/from "\.\/mail"/);
    expect(source).not.toMatch(/\bdeliver\s*\(/);
  });
});
