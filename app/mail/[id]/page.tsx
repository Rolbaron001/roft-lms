import Link from "next/link";
import { notFound } from "next/navigation";
import { pageLocale, requireSession, requireTenant } from "@/lib/request";
import { Rich } from "@/components/rich-text";
import { getMailMessage, MailboxError } from "@/lib/mailbox";
import { mailIsConfigured } from "@/lib/mail";
import { describeSize } from "@/lib/media";
import { AppShell, Card } from "@/components/app-shell";
import { Compose } from "../compose";

export default async function MailMessagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();
  const { t, dates } = await pageLocale();

  let view;
  try {
    view = await getMailMessage(session, id);
  } catch (error) {
    if (error instanceof MailboxError) notFound();
    throw error;
  }

  const { message, attachments } = view;
  const inbound = message.direction === "inbound";

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-4">
        <Link
          href="/mail"
          className="text-sm text-[var(--muted)] underline-offset-2 hover:underline"
        >
          {t("mailbox.back")}
        </Link>
      </div>

      <Card>
        <h1 className="text-lg font-semibold">
          {message.subject ?? t("mailbox.noSubject")}
        </h1>

        <div className="mt-2 text-sm text-[var(--muted)]">
          <p>
            <span className="font-medium">{t("mailbox.from")}</span>{" "}
            {message.fromName ? `${message.fromName} ` : ""}
            <span className="font-mono">{message.fromAddress}</span>
          </p>
          <p>
            <span className="font-medium">{t("mailbox.toLabel")}</span>{" "}
            <span className="font-mono">{message.toAddresses}</span>
          </p>
          <p>
            {message.receivedAt.toLocaleString(dates, {
              dateStyle: "full",
              timeStyle: "short",
            })}
          </p>
        </div>

        {inbound && message.envelopeFrom &&
        message.envelopeFrom !== message.fromAddress ? (
          <p className="mt-3 rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
            <Rich
              text={t("mailbox.envelope")}
              parts={{ address: <span className="font-mono">{message.envelopeFrom}</span> }}
            />
          </p>
        ) : null}

        <pre className="mt-4 whitespace-pre-wrap font-sans text-sm">
          {message.bodyText ?? t("mailbox.noText")}
        </pre>

        {attachments.length > 0 ? (
          <div className="mt-6 border-t border-[var(--border)] pt-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
              {t("mailbox.attachments")}
            </h2>
            <ul className="mt-2 space-y-2">
              {attachments.map((file) => (
                <li key={file.id} className="text-sm">
                  <a
                    href={`/api/mail-attachments/${file.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    📎 {file.filename}
                  </a>{" "}
                  <span className="text-[var(--muted)]">
                    {describeSize(file.sizeBytes)}
                  </span>
                  <p className="break-all font-mono text-[11px] text-[var(--muted)]">
                    {/* Shown because this is the same hash a moderator can
                        check the file against. */}
                    sha256 {file.sha256}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {inbound ? (
        <div className="mt-6">
          <Compose
            canSend={mailIsConfigured()}
            replyTo={message.fromAddress}
            replySubject={message.subject ?? ""}
            inReplyToMessageId={message.id}
          />
        </div>
      ) : null}
    </AppShell>
  );
}
