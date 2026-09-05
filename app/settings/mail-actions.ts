"use server";

import { requireSession } from "@/lib/request";
import { assertSessionCan } from "@/lib/session";
import { mailIsConfigured, verifyRelay } from "@/lib/mail";
import { PermissionDeniedError } from "@/lib/rbac";

export type MailTestState = {
  ok?: boolean;
  message?: string;
  /** What the mail server itself said, where it said anything. */
  detail?: string;
  error?: string;
};

/**
 * Testing that the platform can actually reach its mail server.
 *
 * It opens a connection and authenticates, and sends nothing to anybody. That
 * is what makes it safe to press: the alternative way of finding out - register
 * a learner and see whether the email arrives - creates a person and a message
 * in order to answer a question about configuration.
 *
 * This existed as `verifyRelay()` from the day the mail layer was written, and
 * nothing ever called it. Answering "can my learners receive their password?"
 * took an SSH session and a hand-written SMTP conversation, which is not a
 * thing an administrator can do. A capability with no button is a capability
 * the people who need it do not have.
 *
 * The server's own refusal is passed through rather than replaced with
 * something tidier. "535 Incorrect authentication data" tells an administrator
 * to check the password; "mail is not working" tells them nothing they can act
 * on, and they are the one who has to relay it to whoever runs the server.
 */
export async function testMailAction(): Promise<MailTestState> {
  const session = await requireSession();

  try {
    assertSessionCan(session, "tenant:manage_settings");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return { error: "Your role does not include testing the mail server." };
    }
    throw error;
  }

  if (!mailIsConfigured()) {
    return {
      ok: false,
      message:
        "No mail server is set up on this deployment, so nothing can be sent yet.",
      detail:
        "Whoever maintains the platform needs to set MAIL_HOST and MAIL_FROM.",
    };
  }

  const result = await verifyRelay();

  if (result.ok) {
    return {
      ok: true,
      message:
        "The mail server accepted the connection. Learners can be sent their sign-in details and notifications.",
    };
  }

  return {
    ok: false,
    message: result.retryable
      ? "The mail server could not be reached just now. This may be temporary — try again shortly."
      : "The mail server refused the connection, so nothing can be sent.",
    detail: result.error,
  };
}
