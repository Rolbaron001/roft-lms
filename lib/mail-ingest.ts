import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import { mailAttachments, mailMessages, users } from "@/db/schema";
import { detectMedia, SIZE_LIMITS } from "./media";
import { buildStorageKey, putObject } from "./storage";

/**
 * Taking delivery of a message.
 *
 * Kept apart from the SMTP server itself so it can be tested without opening a
 * socket, and so a future inbound webhook from a provider would use the same
 * path rather than a second, differently-behaved one.
 *
 * The rule that makes running a public MX tractable at this scale: mail is
 * accepted only for an address the platform actually issued. Everything else
 * is refused during the SMTP conversation, before a byte of body is read, so
 * the overwhelming majority of spam is never accepted in the first place —
 * which is a very different position from accepting everything and filtering
 * afterwards.
 */

export type ResolvedMailbox = {
  userId: string;
  organisationId: string;
  address: string;
};

/**
 * Looks up a recipient address across every tenant.
 *
 * Necessarily cross-tenant: a connecting mail server presents an address, and
 * nothing about the connection says which tenant it belongs to. Only the
 * address, the owning user and their tenant are read.
 */
export async function resolveMailbox(
  address: string,
): Promise<ResolvedMailbox | null> {
  const normalised = address.trim().toLowerCase();
  if (!normalised) return null;

  const rows = await withPlatformScope(
    "resolving an inbound recipient address to a mailbox",
    (tx) =>
      tx
        .select({
          userId: users.id,
          organisationId: users.organisationId,
          address: users.mailboxAddress,
          status: users.status,
        })
        .from(users)
        .where(eq(users.mailboxAddress, normalised)),
  );

  const found = rows[0];
  // A suspended or anonymised person still has an address on file, and mail to
  // them should be refused rather than silently filed where nobody will look.
  if (!found?.address || found.status !== "active") return null;

  return {
    userId: found.userId,
    organisationId: found.organisationId,
    address: found.address,
  };
}

export type IncomingMessage = {
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  fromAddress: string;
  fromName?: string | null;
  toAddresses: string;
  subject?: string | null;
  bodyText?: string | null;
  envelopeFrom?: string | null;
  remoteIp?: string | null;
  sizeBytes?: number | null;
  attachments?: {
    filename: string;
    bytes: Uint8Array;
  }[];
};

export type IngestResult = {
  messageId: string;
  attachmentsStored: number;
  attachmentsRejected: { filename: string; reason: string }[];
  duplicate: boolean;
};

/**
 * Files a received message against a mailbox.
 *
 * Attachments are hashed and stored the same way assessment evidence is, so an
 * attachment that turns out to be the evidence can be moved into a Portfolio
 * without being uploaded a second time by hand.
 *
 * An attachment the platform will not accept — an executable, something far
 * too large — does not sink the message. The mail is filed with a note saying
 * what was dropped and why, because losing a learner's covering message
 * because of the file they attached to it helps nobody.
 */
export async function ingestMessage(
  mailbox: ResolvedMailbox,
  message: IncomingMessage,
): Promise<IngestResult> {
  const stored: {
    filename: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  }[] = [];
  const rejected: { filename: string; reason: string }[] = [];

  for (const attachment of message.attachments ?? []) {
    const detected = detectMedia(attachment.bytes, attachment.filename);

    if (!detected.ok) {
      rejected.push({ filename: attachment.filename, reason: detected.reason });
      continue;
    }

    if (attachment.bytes.byteLength > SIZE_LIMITS[detected.kind]) {
      rejected.push({
        filename: attachment.filename,
        reason: "larger than the limit for that kind of file",
      });
      continue;
    }

    const key = buildStorageKey(
      mailbox.organisationId,
      `mail/${mailbox.userId}`,
      attachment.filename,
      "programme",
    );
    const object = await putObject(key, attachment.bytes);

    stored.push({
      filename: attachment.filename,
      storageKey: object.storageKey,
      mimeType: detected.mimeType,
      sizeBytes: object.sizeBytes,
      sha256: object.sha256,
    });
  }

  const notes = rejected.length
    ? `\n\n[The platform did not keep ${rejected.length} attachment(s): ${rejected
        .map((entry) => `${entry.filename} — ${entry.reason}`)
        .join("; ")}]`
    : "";

  return withTenant(mailbox.organisationId, async (tx) => {
    // A sending server that does not get our acknowledgement will try again,
    // and the same message must not be filed twice.
    if (message.messageId) {
      const [existing] = await tx
        .select({ id: mailMessages.id })
        .from(mailMessages)
        .where(eq(mailMessages.messageId, message.messageId));

      if (existing) {
        return {
          messageId: existing.id,
          attachmentsStored: 0,
          attachmentsRejected: rejected,
          duplicate: true,
        };
      }
    }

    const [created] = await tx
      .insert(mailMessages)
      .values({
        organisationId: mailbox.organisationId,
        mailboxUserId: mailbox.userId,
        direction: "inbound",
        messageId: message.messageId ?? null,
        inReplyTo: message.inReplyTo ?? null,
        references: message.references ?? null,
        fromAddress: message.fromAddress,
        fromName: message.fromName ?? null,
        toAddresses: message.toAddresses,
        subject: message.subject ?? null,
        bodyText: `${message.bodyText ?? ""}${notes}`,
        envelopeFrom: message.envelopeFrom ?? null,
        remoteIp: message.remoteIp ?? null,
        sizeBytes: message.sizeBytes ?? null,
      })
      .returning({ id: mailMessages.id });

    if (stored.length > 0) {
      await tx.insert(mailAttachments).values(
        stored.map((item) => ({
          organisationId: mailbox.organisationId,
          messageId: created.id,
          filename: item.filename,
          storageKey: item.storageKey,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          sha256: item.sha256,
        })),
      );
    }

    return {
      messageId: created.id,
      attachmentsStored: stored.length,
      attachmentsRejected: rejected,
      duplicate: false,
    };
  });
}
