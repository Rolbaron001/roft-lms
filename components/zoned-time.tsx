"use client";

import { useSyncExternalStore } from "react";
import { clockInZone, stampInZone, viewerTimeZone, zoneLabel } from "@/lib/timezone";

/**
 * The zone the person reading is in, or null while rendering on the server.
 *
 * `useSyncExternalStore` rather than state set from an effect: this is reading
 * a value that belongs to the browser, not synchronising anything, and the
 * server snapshot of null is what makes the markup match on hydration. It
 * never changes during a visit, so nothing subscribes.
 */
function useViewerZone(providerZone: string): string | null {
  const here = useSyncExternalStore(
    () => () => {},
    () => viewerTimeZone(),
    () => null,
  );
  return here && here !== providerZone ? here : null;
}

/**
 * A time, on the provider's clock, said once and labelled.
 *
 * The record keeps the provider's time and nothing else. An admission, a
 * declaration, a script received: an appeal reads those against the sitting of
 * "14 March at 09:00", and if a moderator in Cape Town and an administrator
 * abroad see different numbers for the same event the file is worthless. So
 * the provider's clock is what is rendered, never the reader's.
 *
 * What the reader gets in addition is their own local equivalent, in brackets,
 * and only when it differs. Showing a learner in London a bare "09:00" invites
 * them to read it as their morning and miss the sitting by two hours; making
 * them do the arithmetic themselves invites the same mistake more slowly. The
 * bracket is a courtesy and is never the recorded value.
 *
 * The viewer's zone is only known in the browser, so the local half appears
 * after hydration. The provider's half is rendered on the server and never
 * moves, which is the half that matters.
 */
export function ZonedTime({
  at,
  zone,
  withDate = false,
  showViewer = true,
}: {
  /** The instant, as an ISO string or a Date. */
  at: string | Date | null;
  /** The provider's IANA zone. */
  zone: string;
  withDate?: boolean;
  showViewer?: boolean;
}) {
  const viewer = useViewerZone(zone);

  if (!at) return <span className="text-[var(--muted)]">—</span>;

  const instant = typeof at === "string" ? new Date(at) : at;
  const provider = withDate
    ? stampInZone(instant, zone)
    : clockInZone(instant, zone);

  return (
    <span className="tabular-nums">
      {provider} {zoneLabel(zone, instant)}
      {showViewer && viewer ? (
        <span className="text-[var(--muted)]">
          {" "}
          ({withDate ? stampInZone(instant, viewer) : clockInZone(instant, viewer)}{" "}
          {zoneLabel(viewer, instant)} your time)
        </span>
      ) : null}
    </span>
  );
}

/**
 * One line saying whose clock a table of times is on.
 *
 * Cheaper than labelling every row, and it says the thing that actually needs
 * saying: a bare "18:30" on a timetable is only unambiguous to somebody who
 * already knows where the provider is. Anybody reading from elsewhere is told
 * so once, at the top, rather than being left to work it out per row.
 */
export function ProviderClockNote({ zone }: { zone: string }) {
  const viewer = useViewerZone(zone);
  const now = new Date();

  return (
    <p className="text-xs text-[var(--muted)]">
      Times are {zoneLabel(zone, now)}
      {viewer ? (
        <>
          , the provider&rsquo;s clock. You are reading this from{" "}
          {zoneLabel(viewer, now)}
        </>
      ) : null}
      .
    </p>
  );
}
