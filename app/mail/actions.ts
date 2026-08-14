"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import { sendFromMailbox, MailboxError } from "@/lib/mailbox";

export type MailState = { error?: string; message?: string };

export async function sendMailAction(
  _previous: MailState,
  formData: FormData,
): Promise<MailState> {
  const session = await requireSession();

  const to = String(formData.get("to") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const inReplyToMessageId =
    String(formData.get("inReplyToMessageId") ?? "").trim() || undefined;

  if (!to || !subject || !body) {
    return { error: "Fill in the address, a subject and a message." };
  }

  try {
    await sendFromMailbox(session, { to, subject, body, inReplyToMessageId });
    revalidatePath("/mail");
    return { message: `Sent to ${to}.` };
  } catch (error) {
    if (error instanceof MailboxError) {
      return { error: error.message };
    }
    if (error instanceof Error && error.name === "ZodError") {
      return { error: "That does not look like a valid email address." };
    }
    throw error;
  }
}
