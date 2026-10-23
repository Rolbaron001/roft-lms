import { markEmailFailed, markEmailSent, type PendingEmail } from "./notifications";
import { deliver } from "./mail";
import { sayer } from "./i18n/said";
import { localeFor } from "./i18n/locales";
import { calendarFor } from "./classroom-reminders";

/**
 * Sends queued email notifications. Shared by the hourly job
 * (scripts/notify.mts) and the classroom's five-minute run, so a message goes
 * out the same way whichever sends it: in the recipient's language, with the
 * link to act on, and with a class's calendar invitation where it has one.
 */
export async function deliverQueued(queued: PendingEmail[]): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (const message of queued) {
    const base = process.env.AUTH_URL ?? "";
    // Raised in English; sent in the recipient's language (D9 stage 5).
    const locale = localeFor({ defaultLocale: message.providerLocale }, { locale: message.locale });
    const say = sayer(locale);

    const result = await deliver({
      to: message.email,
      toName: message.firstName,
      subject: say(message.subject),
      body: say(message.body),
      linkUrl: message.linkPath ? `${base}${message.linkPath}` : null,
      locale,
      calendar: await calendarFor(message).catch(() => null),
    });

    if (result.ok) {
      await markEmailSent(message.id);
      sent += 1;
    } else {
      await markEmailFailed(message.id, result.error, {
        retryable: result.retryable,
      });
      failed += 1;
    }
  }

  return { sent, failed };
}
