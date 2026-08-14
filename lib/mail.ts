import nodemailer, { type Transporter } from "nodemailer";

/**
 * Delivering email.
 *
 * Mail leaves this platform through an authenticated relay, and it has to:
 * Oracle blocks outbound port 25 on every instance, so this server can never
 * hand a message to a recipient's mail server directly. Port 587 to a relay is
 * open, which is the whole of the outbound story.
 *
 * That is not a compromise. A relay is a courier, not the sender. What makes a
 * message read as coming from ROFT is the address it is from and the SPF and
 * DKIM records on that domain — the relay appears nowhere a recipient looks.
 * Delivering directly from a new cloud IP with no sending history would in
 * fact be worse: the mail would land in spam or be refused outright.
 *
 * Which relay is one setting. Swapping Hostinger for Amazon SES or Postmark
 * later changes five lines of .env and nothing else.
 */

export type OutgoingEmail = {
  to: string;
  toName: string;
  subject: string;
  body: string;
  /** Appended as a link if present, so the message is actionable. */
  linkUrl?: string | null;
  /** Set when this is a reply, so mail clients thread it correctly. */
  inReplyTo?: string | null;
  references?: string | null;
};

export type DeliveryResult =
  | { ok: true; messageId?: string }
  | { ok: false; error: string; retryable: boolean };

/**
 * The domain a tenant's mailboxes live on.
 *
 * ROFT's own people sit on the mail domain itself; a client's sit on a
 * subdomain of it, so an address plainly belongs to that client and one
 * tenant's mailbox names cannot collide with another's by accident.
 *
 * Receiving at any of these needs an MX record, which is why it is a
 * predictable pattern rather than a free-text field per tenant.
 */
export function mailDomainFor(tenantSlug: string): string {
  const base = process.env.MAIL_DOMAIN ?? "lms.roftbusiness.org";
  const platform = process.env.PLATFORM_ORG_SLUG ?? "roft";
  return tenantSlug === platform ? base : `${tenantSlug}.${base}`;
}

export function mailIsConfigured(): boolean {
  return Boolean(process.env.MAIL_HOST && process.env.MAIL_FROM);
}

/** The plain-text body, assembled the same way regardless of transport. */
export function renderEmail(email: OutgoingEmail): string {
  const lines = [`Hello ${email.toName},`, "", email.body];

  if (email.linkUrl) {
    lines.push("", email.linkUrl);
  }

  lines.push(
    "",
    "—",
    "You are receiving this because you have a learning record on this system.",
  );

  return lines.join("\n");
}

/**
 * Whether a failure is worth trying again.
 *
 * SMTP says this itself: 4xx means "not now", 5xx means "not ever". Retrying a
 * 5xx forever fills the queue with mail to an address that does not exist,
 * and the pending count stops meaning anything.
 */
export function isRetryable(error: unknown): boolean {
  const code = (error as { responseCode?: number })?.responseCode;
  if (typeof code === "number") {
    return code >= 400 && code < 500;
  }

  // A connection that never opened, or timed out, is a transient network
  // problem rather than a rejected message.
  const name = (error as { code?: string })?.code;
  return (
    name === "ETIMEDOUT" ||
    name === "ECONNREFUSED" ||
    name === "ECONNRESET" ||
    name === "ESOCKET" ||
    name === "EDNS" ||
    name === undefined
  );
}

let transport: Transporter | undefined;

/**
 * Built once and reused, so a run that sends forty reminders opens one
 * connection rather than forty. Created lazily for the same reason the
 * database connection is: importing this file must not require credentials.
 */
function relay(): Transporter {
  if (!transport) {
    const port = Number(process.env.MAIL_PORT ?? 587);

    transport = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port,
      // 465 is TLS from the first byte; 587 opens plain and upgrades with
      // STARTTLS. Getting this the wrong way round is the usual reason a
      // correct username and password still cannot connect.
      secure: port === 465,
      requireTLS: port !== 465,
      auth: process.env.MAIL_USER
        ? {
            user: process.env.MAIL_USER,
            pass: process.env.MAIL_PASSWORD,
          }
        : undefined,
      pool: true,
      maxConnections: 2,
      // A relay that stops answering must not hold up the whole sweep.
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
  }

  return transport;
}

/** Drops the pooled connection, so a settings change takes effect. */
export function resetTransport(): void {
  transport?.close();
  transport = undefined;
}

/**
 * Confirms the relay accepts the credentials, without sending anything.
 *
 * Worth having separately: "can we log in" and "did that message arrive" are
 * different questions, and being able to answer the first on its own turns a
 * misconfigured relay from a mystery into a one-line check.
 */
export async function verifyRelay(): Promise<DeliveryResult> {
  if (!mailIsConfigured()) {
    return {
      ok: false,
      error: "No mail server is configured (MAIL_HOST and MAIL_FROM are unset).",
      retryable: true,
    };
  }

  try {
    await relay().verify();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      retryable: isRetryable(error),
    };
  }
}

export async function deliver(
  email: OutgoingEmail,
): Promise<DeliveryResult> {
  if (!mailIsConfigured()) {
    return {
      ok: false,
      error: "No mail server is configured (MAIL_HOST and MAIL_FROM are unset).",
      // Retryable: the message is not wrong, there is simply nowhere to send
      // it yet. It stays queued rather than being marked failed.
      retryable: true,
    };
  }

  try {
    const sent = await relay().sendMail({
      from: process.env.MAIL_FROM,
      to: { name: email.toName, address: email.to },
      subject: email.subject,
      text: renderEmail(email),
      // Replies come back to the platform rather than to a person's own
      // mailbox, so a conversation stays inside the record.
      replyTo: process.env.MAIL_REPLY_TO || undefined,
      inReplyTo: email.inReplyTo ?? undefined,
      references: email.references ?? undefined,
    });

    return { ok: true, messageId: sent.messageId };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      retryable: isRetryable(error),
    };
  }
}
