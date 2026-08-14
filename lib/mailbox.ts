import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { mailAttachments, mailMessages, users } from "@/db/schema";
import { deliver } from "./mail";
import { getObject } from "./storage";
import { recordAudit } from "./audit";
import { type AuthenticatedSession } from "./session";

/**
 * Reading and writing the mail the platform holds.
 *
 * One rule governs all of it: you read your own mailbox and nobody else's.
 *
 * That is stricter than it might need to be. An argument exists for letting a
 * moderator or external verifier read an exchange between a learner and their
 * assessor, since it is part of the assessment record. But reading somebody
 * else's correspondence is a decision with real consequences under POPIA, and
 * it should be taken deliberately, with its own permission and its own audit
 * trail — not arrive as a side effect of building an inbox. Until then, the
 * conservative rule holds.
 */

export class MailboxError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "not_permitted" | "no_mailbox",
  ) {
    super(message);
    this.name = "MailboxError";
  }
}

async function myMailbox(session: AuthenticatedSession) {
  const [me] = await withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: users.id,
        mailboxAddress: users.mailboxAddress,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(eq(users.id, session.userId)),
  );

  if (!me?.mailboxAddress) {
    throw new MailboxError(
      "You do not have a mailbox on the platform yet. An administrator sets one up on your People record.",
      "no_mailbox",
    );
  }

  return me;
}

export async function mailboxAddressOf(
  session: AuthenticatedSession,
): Promise<string | null> {
  const [me] = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ mailboxAddress: users.mailboxAddress })
      .from(users)
      .where(eq(users.id, session.userId)),
  );
  return me?.mailboxAddress ?? null;
}

export async function listMailbox(session: AuthenticatedSession) {
  const me = await myMailbox(session);

  return withTenant(session.organisationId, async (tx) => {
    const messages = await tx
      .select({
        id: mailMessages.id,
        direction: mailMessages.direction,
        fromAddress: mailMessages.fromAddress,
        fromName: mailMessages.fromName,
        toAddresses: mailMessages.toAddresses,
        subject: mailMessages.subject,
        bodyText: mailMessages.bodyText,
        readAt: mailMessages.readAt,
        receivedAt: mailMessages.receivedAt,
      })
      .from(mailMessages)
      .where(eq(mailMessages.mailboxUserId, me.id))
      .orderBy(desc(mailMessages.receivedAt));

    const attachmentCounts = await tx
      .select({
        messageId: mailAttachments.messageId,
        filename: mailAttachments.filename,
      })
      .from(mailAttachments);

    return {
      address: me.mailboxAddress,
      unread: messages.filter(
        (message) => message.direction === "inbound" && !message.readAt,
      ).length,
      messages: messages.map((message) => ({
        ...message,
        // A one-line taste of the message, so the list is scannable without
        // opening everything.
        preview: (message.bodyText ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 140),
        attachments: attachmentCounts.filter(
          (file) => file.messageId === message.id,
        ).length,
      })),
    };
  });
}

export async function getMailMessage(
  session: AuthenticatedSession,
  messageId: string,
) {
  const me = await myMailbox(session);

  return withTenant(session.organisationId, async (tx) => {
    const [message] = await tx
      .select()
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.id, messageId),
          // Scoped to this mailbox in the query itself, so a message belonging
          // to somebody else is not found rather than found-then-refused.
          eq(mailMessages.mailboxUserId, me.id),
        ),
      );

    if (!message) {
      throw new MailboxError("Message not found.", "not_found");
    }

    const attachments = await tx
      .select({
        id: mailAttachments.id,
        filename: mailAttachments.filename,
        mimeType: mailAttachments.mimeType,
        sizeBytes: mailAttachments.sizeBytes,
        sha256: mailAttachments.sha256,
      })
      .from(mailAttachments)
      .where(eq(mailAttachments.messageId, messageId));

    if (message.direction === "inbound" && !message.readAt) {
      await tx
        .update(mailMessages)
        .set({ readAt: new Date() })
        .where(eq(mailMessages.id, messageId));
    }

    return { message, attachments, address: me.mailboxAddress };
  });
}

export async function unreadMailCount(
  session: AuthenticatedSession,
): Promise<number> {
  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({ id: mailMessages.id })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.mailboxUserId, session.userId),
          eq(mailMessages.direction, "inbound"),
          isNull(mailMessages.readAt),
        ),
      );
    return rows.length;
  });
}

export const composeInput = z.object({
  to: z.string().trim().email(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(50_000),
  /** Set when replying, so the other party's client threads it. */
  inReplyToMessageId: z.string().uuid().optional(),
});

export type ComposeInput = z.input<typeof composeInput>;

/**
 * Sends a message from this person's platform mailbox, and files it.
 *
 * Filed only once the relay has accepted it. A "Sent" folder full of messages
 * that never left is worse than an error: the sender believes they have
 * written to someone.
 */
export async function sendFromMailbox(
  session: AuthenticatedSession,
  input: ComposeInput,
) {
  const me = await myMailbox(session);
  const parsed = composeInput.parse(input);

  let inReplyTo: string | null = null;
  let references: string | null = null;

  if (parsed.inReplyToMessageId) {
    const [parent] = await withTenant(session.organisationId, (tx) =>
      tx
        .select({
          messageId: mailMessages.messageId,
          references: mailMessages.references,
          mailboxUserId: mailMessages.mailboxUserId,
        })
        .from(mailMessages)
        .where(eq(mailMessages.id, parsed.inReplyToMessageId!)),
    );

    if (!parent || parent.mailboxUserId !== me.id) {
      throw new MailboxError("Message not found.", "not_found");
    }

    inReplyTo = parent.messageId;
    references = [parent.references, parent.messageId]
      .filter(Boolean)
      .join(" ")
      .trim() || null;
  }

  const result = await deliver({
    to: parsed.to,
    toName: parsed.to,
    subject: parsed.subject,
    body: parsed.body,
    inReplyTo,
    references,
  });

  if (!result.ok) {
    throw new MailboxError(
      `That could not be sent: ${result.error}`,
      "not_permitted",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [created] = await tx
      .insert(mailMessages)
      .values({
        organisationId: session.organisationId,
        mailboxUserId: me.id,
        direction: "outbound",
        messageId: result.messageId ?? null,
        inReplyTo,
        references,
        fromAddress: me.mailboxAddress!,
        fromName: `${me.firstName} ${me.lastName}`,
        toAddresses: parsed.to,
        subject: parsed.subject,
        bodyText: parsed.body,
        // Sent mail is read by definition; leaving it unread would inflate
        // the badge with the sender's own messages.
        readAt: new Date(),
      })
      .returning({ id: mailMessages.id });

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "mail.sent",
      entityType: "mail_message",
      entityId: created.id,
      after: { to: parsed.to, subject: parsed.subject },
    });

    return created.id;
  });
}

/** An attachment's bytes, for download. */
export async function readMailAttachment(
  session: AuthenticatedSession,
  attachmentId: string,
) {
  const me = await myMailbox(session);

  const attachment = await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({
        filename: mailAttachments.filename,
        mimeType: mailAttachments.mimeType,
        storageKey: mailAttachments.storageKey,
        mailboxUserId: mailMessages.mailboxUserId,
      })
      .from(mailAttachments)
      .innerJoin(
        mailMessages,
        eq(mailMessages.id, mailAttachments.messageId),
      )
      .where(eq(mailAttachments.id, attachmentId));
    return row;
  });

  if (!attachment || attachment.mailboxUserId !== me.id) {
    throw new MailboxError("Attachment not found.", "not_found");
  }

  return {
    bytes: await getObject(attachment.storageKey),
    filename: attachment.filename,
    mimeType: attachment.mimeType,
  };
}
