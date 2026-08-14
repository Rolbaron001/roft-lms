/**
 * The scheduled notification job.
 *
 *   npx tsx scripts/notify.mts sweep    look for what people should be told
 *   npx tsx scripts/notify.mts send     deliver whatever is queued
 *   npx tsx scripts/notify.mts          both, which is what cron runs
 *   npx tsx scripts/notify.mts check    confirm the relay accepts our login
 *
 * Both are safe to run repeatedly. The sweep deduplicates, and sending only
 * touches messages still pending.
 *
 * Suggested cron, once a mail server exists:
 *
 *   0 7 * * *    sweep and send, 07:00 SAST
 *   0 * * * *    send only, hourly, to clear anything raised during the day
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const {
  markEmailFailed,
  markEmailSent,
  pendingEmails,
  sweepAllTenants,
} = await import("../lib/notifications");
const { deliver, mailIsConfigured, verifyRelay } = await import("../lib/mail");

const mode = process.argv[2] ?? "both";

function log(message: string) {
  console.log(`${new Date().toISOString()}  ${message}`);
}

async function sweep() {
  log("Looking for overdue and upcoming training...");
  const results = await sweepAllTenants();

  for (const { tenant, result } of results) {
    const total =
      result.dueSoon +
      result.overdue +
      result.awaitingAssessor +
      result.awaitingModerator;

    if (total === 0) {
      log(`  ${tenant}: nothing to raise.`);
      continue;
    }

    log(
      `  ${tenant}: ${result.overdue} overdue, ${result.dueSoon} due soon, ` +
        `${result.awaitingAssessor} assessor reminders, ` +
        `${result.awaitingModerator} moderator reminders.`,
    );
  }
}

async function send() {
  const queued = await pendingEmails();

  if (queued.length === 0) {
    log("Outbox empty.");
    return;
  }

  if (!mailIsConfigured()) {
    // Deliberately not an error. The messages are recorded and will go out
    // when a mail server exists; saying so plainly beats a stack trace on
    // every scheduled run.
    log(
      `${queued.length} email${queued.length === 1 ? "" : "s"} waiting, but no mail server is configured.`,
    );
    log("They stay queued. Set MAIL_HOST and MAIL_FROM to start sending.");
    return;
  }

  let sent = 0;
  let failed = 0;

  for (const message of queued) {
    const base = process.env.AUTH_URL ?? "";

    const result = await deliver({
      to: message.email,
      toName: message.firstName,
      subject: message.subject,
      body: message.body,
      linkUrl: message.linkPath ? `${base}${message.linkPath}` : null,
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

  log(`Sent ${sent}, failed ${failed}.`);
}

if (mode === "check") {
  // "Can we log in to the relay" and "did that message arrive" are different
  // questions. Being able to answer the first on its own turns a misconfigured
  // relay from a mystery into a one-line check.
  if (!mailIsConfigured()) {
    log("No mail server configured. Set MAIL_HOST and MAIL_FROM in .env.");
    process.exit(1);
  }

  log(`Connecting to ${process.env.MAIL_HOST}:${process.env.MAIL_PORT ?? 587}...`);
  const result = await verifyRelay();

  if (result.ok) {
    log(`Relay accepted the credentials. Mail will be sent as ${process.env.MAIL_FROM}.`);
    process.exit(0);
  }

  log(`Relay refused: ${result.error}`);
  process.exit(1);
} else if (mode === "sweep") {
  await sweep();
} else if (mode === "send") {
  await send();
} else {
  await sweep();
  await send();
}

process.exit(0);
