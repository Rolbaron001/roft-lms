/**
 * Taking delivery of inbound mail, against a live database.
 *
 * Running a public MX is only reasonable because of one rule: mail is accepted
 * for an address the platform issued and for nothing else. These tests hold
 * that rule, and the two that follow from it — a retried delivery must not
 * file the same message twice, and a refused attachment must not take the
 * message down with it.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import { mailAttachments, mailMessages, organisations, users } from "@/db/schema";
import { ingestMessage, resolveMailbox } from "@/lib/mail-ingest";

let organisationId: string;
let learnerId: string;
let suspendedId: string;

const stamp = Date.now();
const learnerAddress = `s.mokoena${stamp}@acme.lms.test`;
const suspendedAddress = `x.gone${stamp}@acme.lms.test`;

beforeAll(async () => {
  const created = await withPlatformScope("mail ingest test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug: `mail-${stamp}`,
        legalName: "Mail Test Ltd",
        displayName: "Mail Test Co",
        status: "active",
      })
      .returning({ id: organisations.id });

    const [learner] = await tx
      .insert(users)
      .values({
        organisationId: organisation.id,
        email: `learner${stamp}@mail.test`,
        mailboxAddress: learnerAddress,
        firstName: "Sam",
        lastName: "Mokoena",
        status: "active",
      })
      .returning({ id: users.id });

    const [suspended] = await tx
      .insert(users)
      .values({
        organisationId: organisation.id,
        email: `gone${stamp}@mail.test`,
        mailboxAddress: suspendedAddress,
        firstName: "Ex",
        lastName: "Employee",
        status: "suspended",
      })
      .returning({ id: users.id });

    return {
      organisationId: organisation.id,
      learnerId: learner.id,
      suspendedId: suspended.id,
    };
  });

  organisationId = created.organisationId;
  learnerId = created.learnerId;
  suspendedId = created.suspendedId;
});

afterAll(async () => {
  await withPlatformScope("mail ingest test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

function message(overrides: Partial<Parameters<typeof ingestMessage>[1]> = {}) {
  return {
    messageId: `<${Math.random().toString(36).slice(2)}@sender.test>`,
    fromAddress: "coach@employer.test",
    fromName: "Nomsa Dube",
    toAddresses: learnerAddress,
    subject: "Your logbook",
    bodyText: "Please send the signed report.",
    envelopeFrom: "coach@employer.test",
    remoteIp: "203.0.113.7",
    ...overrides,
  };
}

describe("deciding whether to accept a recipient", () => {
  it("accepts an address the platform issued", async () => {
    const mailbox = await resolveMailbox(learnerAddress);
    expect(mailbox).toMatchObject({ userId: learnerId, organisationId });
  });

  it("is not case sensitive, because sending servers are not", async () => {
    const mailbox = await resolveMailbox(learnerAddress.toUpperCase());
    expect(mailbox?.userId).toBe(learnerId);
  });

  it("refuses an address nobody holds", async () => {
    // This is the whole spam defence: refused at RCPT TO, before a body is
    // ever read, so guessing addresses costs the sender everything and us
    // nothing.
    expect(await resolveMailbox(`nobody${stamp}@acme.lms.test`)).toBeNull();
  });

  it("refuses mail to somebody who is no longer active", async () => {
    // The address is still on file. Filing mail against a suspended account
    // would put it somewhere nobody is looking.
    expect(suspendedId).toBeTruthy();
    expect(await resolveMailbox(suspendedAddress)).toBeNull();
  });

  it("refuses an empty address rather than matching something", async () => {
    expect(await resolveMailbox("")).toBeNull();
    expect(await resolveMailbox("   ")).toBeNull();
  });
});

describe("filing a message", () => {
  it("records who it was from and which mailbox it reached", async () => {
    const mailbox = (await resolveMailbox(learnerAddress))!;
    const result = await ingestMessage(mailbox, message());

    const [stored] = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.id, result.messageId)),
    );

    expect(stored.direction).toBe("inbound");
    expect(stored.fromAddress).toBe("coach@employer.test");
    expect(stored.mailboxUserId).toBe(learnerId);
    expect(stored.subject).toBe("Your logbook");
    expect(stored.remoteIp).toBe("203.0.113.7");
  });

  it("does not file the same message twice when a sender retries", async () => {
    const mailbox = (await resolveMailbox(learnerAddress))!;
    const identical = message({ messageId: `<retry-${stamp}@sender.test>` });

    const first = await ingestMessage(mailbox, identical);
    const second = await ingestMessage(mailbox, identical);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.messageId).toBe(first.messageId);
  });

  it("stores an attachment the way evidence is stored", async () => {
    const mailbox = (await resolveMailbox(learnerAddress))!;
    const result = await ingestMessage(
      mailbox,
      message({
        attachments: [
          {
            filename: "report.txt",
            bytes: new TextEncoder().encode("A performance report."),
          },
        ],
      }),
    );

    expect(result.attachmentsStored).toBe(1);

    const files = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(mailAttachments)
        .where(eq(mailAttachments.messageId, result.messageId)),
    );

    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe("report.txt");
    // Hashed on arrival, like every other artefact, so a moderator asking
    // whether the file is the one that was sent gets a check rather than an
    // assurance.
    expect(files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps the message when an attachment is refused, and says so", async () => {
    const mailbox = (await resolveMailbox(learnerAddress))!;

    // An HTML attachment can carry script and is refused by lib/media. Losing
    // the learner's covering message because of what they attached to it would
    // help nobody.
    const result = await ingestMessage(
      mailbox,
      message({
        bodyText: "Here is my evidence.",
        attachments: [
          {
            filename: "evil.html",
            bytes: new TextEncoder().encode("<script>alert(1)</script>"),
          },
        ],
      }),
    );

    expect(result.attachmentsStored).toBe(0);
    expect(result.attachmentsRejected).toHaveLength(1);

    const [stored] = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.id, result.messageId)),
    );

    expect(stored.bodyText).toContain("Here is my evidence.");
    expect(stored.bodyText).toContain("did not keep");
    expect(stored.bodyText).toContain("evil.html");
  });

  it("keeps the threading headers exactly as the sender wrote them", async () => {
    const mailbox = (await resolveMailbox(learnerAddress))!;
    const result = await ingestMessage(
      mailbox,
      message({
        messageId: `<thread-${stamp}@sender.test>`,
        inReplyTo: "<original@lms.test>",
        references: "<first@lms.test> <original@lms.test>",
      }),
    );

    const [stored] = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(mailMessages)
        .where(eq(mailMessages.id, result.messageId)),
    );

    // Rewriting these breaks threading in whichever mail client the other
    // party happens to use.
    expect(stored.inReplyTo).toBe("<original@lms.test>");
    expect(stored.references).toBe("<first@lms.test> <original@lms.test>");
  });
});
