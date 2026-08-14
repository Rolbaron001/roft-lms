/**
 * The inbound mail server.
 *
 *   npx tsx scripts/mail-receiver.mts
 *
 * Listens on port 25 and accepts mail addressed to a mailbox the platform has
 * actually issued. Everything else is refused during the SMTP conversation,
 * before the body is read.
 *
 * That single rule is what makes running a public MX reasonable here. The
 * usual objection — "you will drown in spam" — assumes accepting everything
 * and filtering afterwards. This accepts almost nothing: the valid address
 * list is small, known, and checked at RCPT TO, so a spammer guessing
 * addresses is refused at the door and never gets to send a body.
 *
 * Runs as its own container so that a bug in mail handling cannot take the
 * application down, and so the process facing the internet on port 25 holds no
 * more than it needs.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import { config } from "dotenv";

config({ path: ".env.local" });

const { resolveMailbox, ingestMessage } = await import("../lib/mail-ingest");

const PORT = Number(process.env.MAIL_RECEIVER_PORT ?? 25);

/**
 * 25 MB. Large enough for the video and slide decks a learner sends as
 * evidence, small enough that a single message cannot fill the disk. Refused
 * with a 552 during the conversation, so the sender is told rather than left
 * assuming it arrived.
 */
const MAX_MESSAGE_BYTES = Number(
  process.env.MAIL_MAX_BYTES ?? 25 * 1024 * 1024,
);

function log(...parts: unknown[]) {
  console.log(new Date().toISOString(), ...parts);
}

/**
 * The real certificate, borrowed from Caddy.
 *
 * A sending server that offers STARTTLS and receives a self-signed
 * certificate will usually deliver anyway — opportunistic TLS does not verify
 * — but "usually" is not a property to rely on, and smtp-server's built-in
 * certificate has a publicly known private key, which makes the encryption
 * decorative.
 *
 * Caddy already holds a valid certificate for this hostname on the same
 * machine, renewed automatically. Its volume is mounted here read-only and the
 * files are found by searching rather than by a hard-coded path, because the
 * directory is named after whichever authority issued it and that changes if
 * Caddy ever falls back to a different one.
 */
function certificateFor(hostname: string): { key: string; cert: string } | null {
  const root = process.env.MAIL_TLS_ROOT ?? "/caddy/caddy/certificates";
  if (!existsSync(root)) return null;

  for (const issuer of readdirSync(root)) {
    const directory = join(root, issuer, hostname);
    const cert = join(directory, `${hostname}.crt`);
    const key = join(directory, `${hostname}.key`);

    if (existsSync(cert) && existsSync(key)) {
      try {
        return {
          cert: readFileSync(cert, "utf8"),
          key: readFileSync(key, "utf8"),
        };
      } catch (error) {
        log(`found a certificate for ${hostname} but could not read it:`, error);
        return null;
      }
    }
  }

  return null;
}

const MAIL_HOSTNAME = process.env.MAIL_DOMAIN ?? "lms.roftbusiness.org";
const certificate = certificateFor(MAIL_HOSTNAME);

const server = new SMTPServer({
  // A public MX accepts mail from strangers; that is what an MX is. There is
  // nothing to authenticate against, so authentication is disabled rather than
  // left half-configured.
  authOptional: true,
  disabledCommands: ["AUTH"],
  size: MAX_MESSAGE_BYTES,
  banner: "ROFT Learning Management System",
  ...(certificate ? { key: certificate.key, cert: certificate.cert } : {}),

  onRcptTo(address, session, callback) {
    void resolveMailbox(address.address)
      .then((mailbox) => {
        if (!mailbox) {
          // 550 is permanent: a legitimate sender is told at once that the
          // address is wrong rather than having their server retry for days,
          // and a spammer learns nothing they could not learn by guessing.
          return callback(
            Object.assign(new Error("Mailbox not found"), { responseCode: 550 }),
          );
        }

        // Stashed so onData does not look it up a second time.
        const recipients = (session as unknown as { roftMailboxes?: unknown[] })
          .roftMailboxes ?? [];
        recipients.push(mailbox);
        (session as unknown as { roftMailboxes: unknown[] }).roftMailboxes =
          recipients;

        callback();
      })
      .catch((error: unknown) => {
        log("recipient lookup failed:", error);
        // 451 is temporary: the address may well be fine and the database
        // momentarily is not. The sender retries rather than giving up.
        callback(
          Object.assign(new Error("Try again later"), { responseCode: 451 }),
        );
      });
  },

  onData(stream, session, callback) {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;

    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_MESSAGE_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });

    stream.on("end", () => {
      if (tooLarge) {
        return callback(
          Object.assign(new Error("Message too large"), { responseCode: 552 }),
        );
      }

      void (async () => {
        try {
          const parsed = await simpleParser(Buffer.concat(chunks));

          const mailboxes = ((
            session as unknown as { roftMailboxes?: unknown[] }
          ).roftMailboxes ?? []) as {
            userId: string;
            organisationId: string;
            address: string;
          }[];

          const attachments = (parsed.attachments ?? [])
            .filter((item) => item.content)
            .map((item) => ({
              filename: item.filename ?? "attachment",
              bytes: new Uint8Array(item.content),
            }));

          const from = parsed.from?.value?.[0];
          const envelopeFrom = session.envelope.mailFrom
            ? session.envelope.mailFrom.address
            : null;

          // The From header is what a person wrote and can say anything; the
          // envelope sender is what the connecting server actually claimed.
          // Prefer the header because it is what the recipient will reply to,
          // and fall back rather than filing a message from nobody.
          const fromAddress = from?.address ?? envelopeFrom ?? "unknown";

          for (const mailbox of mailboxes) {
            const result = await ingestMessage(mailbox, {
              messageId: parsed.messageId ?? null,
              inReplyTo: parsed.inReplyTo ?? null,
              references: Array.isArray(parsed.references)
                ? parsed.references.join(" ")
                : (parsed.references ?? null),
              fromAddress,
              fromName: from?.name ?? null,
              toAddresses: mailbox.address,
              subject: parsed.subject ?? null,
              bodyText: parsed.text ?? null,
              envelopeFrom,
              remoteIp: session.remoteAddress ?? null,
              sizeBytes: size,
              attachments,
            });

            log(
              result.duplicate ? "duplicate" : "accepted",
              `→ ${mailbox.address}`,
              `from ${from?.address ?? "unknown"}`,
              `(${result.attachmentsStored} attachment(s)${
                result.attachmentsRejected.length
                  ? `, ${result.attachmentsRejected.length} refused`
                  : ""
              })`,
            );
          }

          callback();
        } catch (error) {
          log("could not file message:", error);
          // The message is not wrong; we failed to file it. Temporary, so the
          // sender tries again rather than the mail being lost.
          callback(
            Object.assign(new Error("Try again later"), { responseCode: 451 }),
          );
        }
      })();
    });

    stream.on("error", (error: unknown) => {
      log("stream error:", error);
      callback(
        Object.assign(new Error("Try again later"), { responseCode: 451 }),
      );
    });
  },
});

server.on("error", (error) => {
  log("server error:", error);
});

server.listen(PORT, "0.0.0.0", () => {
  log(`Inbound mail server listening on port ${PORT}.`);
  log(
    "Accepting mail only for addresses issued by the platform; everything else is refused with 550.",
  );
  log(
    certificate
      ? `STARTTLS using the certificate for ${MAIL_HOSTNAME}.`
      : `No certificate found for ${MAIL_HOSTNAME}; STARTTLS will offer an untrusted one. Mail will still be delivered by most senders, but the encryption is not verifiable.`,
  );
});

// Docker sends SIGTERM on stop. Closing cleanly means a message being received
// at that moment is finished rather than cut off mid-delivery.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log(`${signal} received, closing.`);
    server.close(() => process.exit(0));
  });
}
