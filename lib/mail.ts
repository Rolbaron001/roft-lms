/**
 * Delivering email.
 *
 * This is the one part of notifications that needs a mail server, and it is
 * deliberately the smallest part. Everything else — deciding who should be
 * told, writing the message down, showing it in the application — works now
 * and is tested now.
 *
 * Until SMTP is configured, `deliver` records the message and reports it as
 * undeliverable rather than pretending. The queued rows stay pending, so when
 * a mail server does arrive, everything waiting goes out.
 *
 * ---------------------------------------------------------------------------
 * WIRING IT UP LATER
 *
 * Set these, install nodemailer, and replace the marked block below:
 *
 *   MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASSWORD
 *   MAIL_FROM        e.g. "ROFT Learning <learning@roftbusiness.org>"
 *
 * Nothing else in the platform changes. That is the point of the seam.
 * ---------------------------------------------------------------------------
 */

export type OutgoingEmail = {
  to: string;
  toName: string;
  subject: string;
  body: string;
  /** Appended as a link if present, so the message is actionable. */
  linkUrl?: string | null;
};

export type DeliveryResult =
  | { ok: true }
  | { ok: false; error: string; retryable: boolean };

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

export async function deliver(
  // Unused until a transport is wired in below; named rather than dropped so
  // the signature is already the one the real implementation needs.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  // -------------------------------------------------------------------------
  // Replace this block when a mail server exists:
  //
  //   const transport = nodemailer.createTransport({ ... });
  //   await transport.sendMail({
  //     from: process.env.MAIL_FROM,
  //     to: `${email.toName} <${email.to}>`,
  //     subject: email.subject,
  //     text: renderEmail(email),
  //   });
  //   return { ok: true };
  // -------------------------------------------------------------------------

  return {
    ok: false,
    error:
      "Mail settings are present but no transport is implemented yet. See lib/mail.ts.",
    retryable: true,
  };
}
