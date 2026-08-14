import Link from "next/link";
import { requireSession, requireTenant } from "@/lib/request";
import { listMailbox, MailboxError } from "@/lib/mailbox";
import { mailIsConfigured } from "@/lib/mail";
import { AppShell, Card } from "@/components/app-shell";
import { Compose } from "./compose";

function when(value: Date): string {
  const now = Date.now();
  const days = Math.floor((now - value.getTime()) / 86_400_000);

  if (days === 0) {
    return value.toLocaleTimeString("en-ZA", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (days < 7) {
    return value.toLocaleDateString("en-ZA", { weekday: "short" });
  }
  return value.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

/**
 * The mailbox.
 *
 * Lives inside the tenant rather than on a hostname of its own. Tenancy here
 * is decided by hostname, so mail.lms.roftbusiness.org would resolve to a
 * tenant called "mail" and belong to nobody. What carries the ROFT identity is
 * the address a recipient sees — n.mahlangu@acme.lms.roftbusiness.org, signed
 * with the domain's own DKIM key — not the address of the screen it is read on.
 */
export default async function MailPage() {
  const tenant = await requireTenant();
  const session = await requireSession();

  let mailbox;
  try {
    mailbox = await listMailbox(session);
  } catch (error) {
    if (error instanceof MailboxError && error.code === "no_mailbox") {
      return (
        <AppShell tenant={tenant} session={session}>
          <h1 className="mb-4 text-xl font-semibold">Mail</h1>
          <Card>
            <p className="text-sm text-[var(--muted)]">{error.message}</p>
          </Card>
        </AppShell>
      );
    }
    throw error;
  }

  const canSend = mailIsConfigured();

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Mail</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            <span className="font-mono">{mailbox.address}</span>
            {mailbox.unread > 0 ? ` · ${mailbox.unread} unread` : ""}
          </p>
        </div>
        <Compose canSend={canSend} />
      </div>

      {mailbox.messages.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            Nothing here yet. Anything sent to{" "}
            <span className="font-mono">{mailbox.address}</span> arrives in this
            list, with attachments stored the same way assessment evidence is.
          </p>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <ul>
            {mailbox.messages.map((message) => {
              const unread = message.direction === "inbound" && !message.readAt;
              return (
                <li
                  key={message.id}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <Link
                    href={`/mail/${message.id}`}
                    className="block px-4 py-3 transition hover:bg-[var(--border)]/20"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className={unread ? "font-semibold" : ""}>
                        {message.direction === "outbound"
                          ? `To ${message.toAddresses}`
                          : (message.fromName ?? message.fromAddress)}
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        {message.attachments > 0
                          ? `📎 ${message.attachments} · `
                          : ""}
                        {when(message.receivedAt)}
                      </p>
                    </div>
                    <p className={`text-sm ${unread ? "font-medium" : ""}`}>
                      {message.subject ?? "(no subject)"}
                    </p>
                    <p className="truncate text-sm text-[var(--muted)]">
                      {message.preview}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </AppShell>
  );
}
