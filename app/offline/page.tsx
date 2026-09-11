import { notFound } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
import { awaitingResolution, capturedUnderRelaxedRule } from "@/lib/offline";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { HeldOnDevice } from "./held-on-device";

/**
 * What is held on this device, and what is waiting to go back.
 *
 * Reached two ways, and that is deliberate. A learner opens it to see what they
 * have downloaded and how much room it is taking. A coordinator opens it to see
 * what came back from the field and needs a person.
 *
 * It is also the page the service worker falls back to when a learner opens
 * something that is not held - so it has to work with no signal, which is why
 * the device half of it is rendered in the browser from the browser's own
 * storage rather than fetched.
 */
export default async function OfflinePage() {
  const tenant = await requireTenant();

  // A tenant that never asked for offline has no such page. Not a redirect to
  // "not permitted", because it is not a permission question - the feature
  // simply does not exist for them.
  if (!tenant.offlineEnabled) notFound();

  const session = await requireSession();

  const canSeeQueue = session.permissions.includes("enrolment:read_all");
  const [held, relaxed] = canSeeQueue
    ? await Promise.all([
        awaitingResolution(session),
        capturedUnderRelaxedRule(session),
      ])
    : [[], []];

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Working without a signal</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Download what you need before you go out. Anything you record while
          you are away is kept on this phone and sent back the next time you
          have a signal.
        </p>
      </div>

      <div className="mb-6">
        <HeldOnDevice />
      </div>

      {canSeeQueue && held.length > 0 ? (
        <div className="mb-6">
          <Card
            title={`${held.length} waiting for a decision`}
            description="Something changed while the learner was away. Nothing has been merged or overwritten — somebody has to choose."
          >
            <ul className="space-y-2">
              {held.map((row) => (
                <li key={row.id} className="text-sm">
                  <span className="font-medium">
                    {row.firstName} {row.lastName}
                  </span>
                  <span className="text-[var(--muted)]"> · {row.kind}</span>
                  <span className="block text-xs text-[var(--muted)]">
                    {row.heldReason}
                  </span>
                  {/*
                    Both dates, never one standing in for the other. A device
                    clock can be wrong by accident or set wrong on purpose, so
                    the reader is shown the gap rather than asked to trust it.
                  */}
                  <span className="block text-xs text-[var(--muted)]">
                    Recorded on the device{" "}
                    {row.capturedAt.toLocaleString("en-ZA")} · reached us{" "}
                    {row.receivedAt.toLocaleString("en-ZA")}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {canSeeQueue && relaxed.length > 0 ? (
        <div className="mb-6">
          <Card
            title={`${relaxed.length} captured under the looser rule`}
            description="Work recorded while this programme allowed summatives to be taken offline. If the programme is accredited later, that work does not become defensible retrospectively — this is the list, so it is a decision rather than a discovery at a monitoring visit."
          >
            <ul className="space-y-1">
              {relaxed.slice(0, 20).map((row) => (
                <li key={row.id} className="text-sm">
                  {row.firstName} {row.lastName}
                  <span className="text-[var(--muted)]">
                    {" "}
                    · {row.kind} · recorded{" "}
                    {row.capturedAt.toLocaleDateString("en-ZA")}
                  </span>
                </li>
              ))}
            </ul>
            {relaxed.length > 20 ? (
              <p className="mt-2 text-xs text-[var(--muted)]">
                and {relaxed.length - 20} more.
              </p>
            ) : null}
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
