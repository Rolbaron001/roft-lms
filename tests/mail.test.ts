/**
 * Outbound mail, and the addresses the platform hands out.
 *
 * No network here. What is worth testing is the reasoning around delivery:
 * which failures are worth retrying, and whether a generated address can ever
 * collide — because two learners sharing a mailbox means one of them reads the
 * other's assessment correspondence.
 */
import { describe, expect, it } from "vitest";
import {
  isRetryable,
  renderEmail,
  mailIsConfigured,
  verifyRelay,
} from "@/lib/mail";
import { proposeMailboxAddress } from "@/lib/people";

describe("deciding whether to try again", () => {
  it("retries a 4xx, which means not now", () => {
    expect(isRetryable({ responseCode: 421 })).toBe(true);
    expect(isRetryable({ responseCode: 450 })).toBe(true);
  });

  it("gives up on a 5xx, which means not ever", () => {
    // A mailbox that does not exist will not start existing because we asked
    // five more times. Retrying it only makes the pending count meaningless.
    expect(isRetryable({ responseCode: 550 })).toBe(false);
    expect(isRetryable({ responseCode: 553 })).toBe(false);
  });

  it("retries a connection that never opened", () => {
    expect(isRetryable({ code: "ETIMEDOUT" })).toBe(true);
    expect(isRetryable({ code: "ECONNREFUSED" })).toBe(true);
  });

  it("treats an unrecognised failure as worth retrying", () => {
    // Erring towards retrying keeps a message alive for a human to look at;
    // erring the other way loses it silently.
    expect(isRetryable(new Error("something odd"))).toBe(true);
  });
});

describe("the message body", () => {
  it("includes the link when there is one to act on", () => {
    const text = renderEmail({
      to: "learner@example.test",
      toName: "Sam",
      subject: "Training due",
      body: "Your induction is due on Friday.",
      linkUrl: "https://lms.roftbusiness.org/learn/1",
    });

    expect(text).toContain("Hello Sam,");
    expect(text).toContain("Your induction is due on Friday.");
    expect(text).toContain("https://lms.roftbusiness.org/learn/1");
  });

  it("says why the person is receiving it", () => {
    const text = renderEmail({
      to: "learner@example.test",
      toName: "Sam",
      subject: "Training due",
      body: "Body.",
    });

    expect(text).toContain("learning record");
  });
});

describe("knowing whether mail can be sent at all", () => {
  it("is false without a host and a from address", () => {
    const host = process.env.MAIL_HOST;
    const from = process.env.MAIL_FROM;
    delete process.env.MAIL_HOST;
    delete process.env.MAIL_FROM;

    expect(mailIsConfigured()).toBe(false);

    if (host) process.env.MAIL_HOST = host;
    if (from) process.env.MAIL_FROM = from;
  });

  /**
   * The settings page offers a button that checks this, so the unconfigured
   * answer has to be a plain result rather than a thrown error - otherwise an
   * administrator pressing it on a deployment with no mail server set up gets
   * a crash instead of "no mail server is set up".
   *
   * It also has to answer without touching the network, or the test suite
   * would depend on a mail server being reachable from wherever it runs.
   */
  it("reports rather than throws when nothing is configured", async () => {
    const host = process.env.MAIL_HOST;
    const from = process.env.MAIL_FROM;
    delete process.env.MAIL_HOST;
    delete process.env.MAIL_FROM;

    const result = await verifyRelay();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("MAIL_HOST");
      // Retryable, because the answer changes the moment somebody sets it.
      expect(result.retryable).toBe(true);
    }

    if (host) process.env.MAIL_HOST = host;
    if (from) process.env.MAIL_FROM = from;
  });
});

describe("proposing a mailbox address", () => {
  const domain = "lms.roftbusiness.org";

  it("builds one from the person's name", () => {
    expect(proposeMailboxAddress("Naledi", "Mahlangu", domain)).toBe(
      "n.mahlangu@lms.roftbusiness.org",
    );
  });

  it("strips accents rather than making two mailboxes of one name", () => {
    // Nkosi and Nkösi are the same person's surname typed twice, and an
    // accented local part is refused by servers that never implemented
    // SMTPUTF8.
    expect(proposeMailboxAddress("Thandi", "Nkösi", domain)).toBe(
      "t.nkosi@lms.roftbusiness.org",
    );
  });

  it("removes spaces and punctuation from a compound surname", () => {
    expect(proposeMailboxAddress("Pieter", "van Wyk", domain)).toBe(
      "p.vanwyk@lms.roftbusiness.org",
    );
    expect(proposeMailboxAddress("Anne", "O'Brien-Smith", domain)).toBe(
      "a.obriensmith@lms.roftbusiness.org",
    );
  });

  it("numbers the second person of the same name rather than reusing the first", () => {
    // Delivering one learner's assessment correspondence to another is the
    // failure this exists to prevent.
    const taken = new Set(["t.nkosi@lms.roftbusiness.org"]);
    expect(proposeMailboxAddress("Thabo", "Nkosi", domain, taken)).toBe(
      "t.nkosi2@lms.roftbusiness.org",
    );

    taken.add("t.nkosi2@lms.roftbusiness.org");
    expect(proposeMailboxAddress("Tumelo", "Nkosi", domain, taken)).toBe(
      "t.nkosi3@lms.roftbusiness.org",
    );
  });

  it("still produces something usable from a single name", () => {
    expect(proposeMailboxAddress("Madonna", "", domain)).toBe(
      "madonna@lms.roftbusiness.org",
    );
  });

  it("uses the tenant's own domain when they have one", () => {
    expect(
      proposeMailboxAddress("Elsa", "Fourie", "learning.harbourtraining.co.za"),
    ).toBe("e.fourie@learning.harbourtraining.co.za");
  });
});
