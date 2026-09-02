"use client";

import { useActionState, useSyncExternalStore } from "react";
import {
  admitCandidateAction,
  confirmCameraAction,
  recordDropOutAction,
  acknowledgeScriptAction,
  acceptDeclarationAction,
  recordIncidentAction,
  type CohortActionState,
} from "@/app/cohorts/actions";
import { ZonedTime } from "@/components/zoned-time";
import { clockInZone, viewerTimeZone, zoneLabel, zonedTimeToUtc } from "@/lib/timezone";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm";

export type SittingLine = {
  userId: string;
  name: string;
  outcome: "admitted" | "refused" | null;
  admittedAt: string | null;
  refusedReason: string | null;
  declarationAcceptedAt: string | null;
  cameraConfirmedAt: string | null;
  droppedOffAt: string | null;
  droppedOffReason: string | null;
  scriptReceivedAt: string | null;
  scriptReference: string | null;
};

export type SittingHeader = {
  id: string;
  status: string;
  assessmentTitle: string;
  scheduledDate: string;
  startTime: string | null;
  closesAfter: number;
  arriveBeforeMinutes: number;
  cameraRequired: number;
  permittedMaterials: string | null;
  declarationText: string | null;
  meetingUrl: string | null;
  venue: string | null;
  deliveryMode: string;
};


/**
 * The room, as the invigilator sees it.
 *
 * One page, because it is used with a cohort in front of you and there is no
 * time to navigate. The meeting link sits at the top: the sitting happens on
 * whatever platform the provider already uses for lectures, and this holds the
 * record of how it was supervised.
 */
export function Sitting({
  cohortId,
  zone,
  sitting,
  lines,
  incidents,
}: {
  cohortId: string;
  /** The provider's clock. Every time on this page is on it. */
  zone: string;
  sitting: SittingHeader;
  lines: SittingLine[];
  incidents: {
    id: string;
    userId: string | null;
    occurredAt: Date;
    description: string;
    actionTaken: string | null;
  }[];
}) {
  const [state, action] = useActionState<CohortActionState, FormData>(
    admitCandidateAction,
    {},
  );
  const [cameraState, cameraAction] = useActionState<CohortActionState, FormData>(
    confirmCameraAction,
    {},
  );
  const [dropState, dropAction] = useActionState<CohortActionState, FormData>(
    recordDropOutAction,
    {},
  );
  const [scriptState, scriptAction] = useActionState<CohortActionState, FormData>(
    acknowledgeScriptAction,
    {},
  );
  const [declState, declAction] = useActionState<CohortActionState, FormData>(
    acceptDeclarationAction,
    {},
  );
  const [incidentState, incidentAction, filing] = useActionState<
    CohortActionState,
    FormData
  >(recordIncidentAction, {});

  // The reader's own zone, only to show them the start time in their terms.
  // It decides nothing: the cut-off is judged on the provider's clock.
  const here = useSyncExternalStore(
    () => () => {},
    () => viewerTimeZone(),
    () => null,
  );
  const elsewhere = here && here !== zone ? here : null;

  const startsAt = zonedTimeToUtc(
    sitting.scheduledDate,
    sitting.startTime,
    zone,
  );
  const closesAt = new Date(startsAt.getTime() + sitting.closesAfter * 60_000);

  const admitted = lines.filter((line) => line.outcome === "admitted").length;
  const error =
    state.error ??
    cameraState.error ??
    dropState.error ??
    scriptState.error ??
    declState.error;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-[var(--border)] p-4">
        <p className="text-sm font-medium">
          {sitting.assessmentTitle} · {sitting.scheduledDate}
          {sitting.startTime ? (
            <>
              {" at "}
              {sitting.startTime} {zoneLabel(zone, startsAt)}
            </>
          ) : null}
        </p>

        {elsewhere && sitting.startTime ? (
          <p className="mt-1 text-sm text-[var(--muted)]">
            That is {clockInZone(startsAt, elsewhere)}{" "}
            {zoneLabel(elsewhere, startsAt)} where you are. Times recorded here
            are the provider&rsquo;s, which is what the record keeps.
          </p>
        ) : null}

        <p className="mt-1 text-sm text-[var(--muted)]">
          Candidates arrive {sitting.arriveBeforeMinutes} minutes before.
          Admission closes {sitting.closesAfter} minutes after the start
          {sitting.startTime ? (
            <>
              , at {clockInZone(closesAt, zone)} {zoneLabel(zone, closesAt)}
            </>
          ) : null}
          ; after that the platform refuses, because somebody admitted late has
          had longer with the paper than everybody else.
          {sitting.cameraRequired ? " Cameras stay on throughout." : ""}
        </p>

        {sitting.meetingUrl ? (
          <p className="mt-3">
            <a
              href={sitting.meetingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white"
            >
              Join the sitting
            </a>
            <span className="ml-3 text-xs text-[var(--muted)]">
              The meeting runs on the platform you already use. What is recorded
              here is how it was supervised.
            </span>
          </p>
        ) : sitting.venue ? (
          <p className="mt-2 text-sm">Venue: {sitting.venue}</p>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">
            No meeting link on this session yet. Add one on the roll-out so
            candidates know where to go.
          </p>
        )}

        {sitting.permittedMaterials ? (
          <p className="mt-3 text-sm">
            <span className="font-medium">Permitted: </span>
            {sitting.permittedMaterials}
          </p>
        ) : null}

        <p className="mt-3 text-sm tabular-nums">
          {admitted} of {lines.length} admitted
        </p>
      </div>

      {error ? (
        <p className="text-sm text-[var(--danger,#b00020)]">{error}</p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <th className="pb-2 pr-3">Candidate</th>
              <th className="pb-2 pr-3">Admission</th>
              <th className="pb-2 pr-3">Declaration</th>
              {sitting.cameraRequired ? (
                <th className="pb-2 pr-3">Camera</th>
              ) : null}
              <th className="pb-2">Script</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.userId} className="border-t border-[var(--border)]">
                <td className="py-2 pr-3 whitespace-nowrap">
                  {line.name}
                  {line.droppedOffAt ? (
                    <span className="ml-2 text-xs text-[var(--muted)]">
                      dropped out <ZonedTime at={line.droppedOffAt} zone={zone} showViewer={false} />
                      {line.droppedOffReason ? `: ${line.droppedOffReason}` : ""}
                    </span>
                  ) : null}
                </td>

                <td className="py-2 pr-3">
                  {line.outcome === "admitted" ? (
                    <span>
                      in at <ZonedTime at={line.admittedAt} zone={zone} showViewer={false} />
                    </span>
                  ) : line.outcome === "refused" ? (
                    <span className="text-[var(--muted)]">
                      refused: {line.refusedReason}
                    </span>
                  ) : (
                    <form action={action} className="flex flex-wrap gap-1">
                      <input type="hidden" name="cohortId" value={cohortId} />
                      <input type="hidden" name="sittingId" value={sitting.id} />
                      <input type="hidden" name="userId" value={line.userId} />
                      <input
                        name="reason"
                        placeholder="Reason, if refusing"
                        className={inputClass}
                      />
                      <button
                        type="submit"
                        name="outcome"
                        value="admitted"
                        className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                      >
                        Admit
                      </button>
                      <button
                        type="submit"
                        name="outcome"
                        value="refused"
                        className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                      >
                        Refuse
                      </button>
                    </form>
                  )}
                </td>

                <td className="py-2 pr-3">
                  {line.declarationAcceptedAt ? (
                    <ZonedTime at={line.declarationAcceptedAt} zone={zone} showViewer={false} />
                  ) : line.outcome === "admitted" ? (
                    <form action={declAction}>
                      <input type="hidden" name="cohortId" value={cohortId} />
                      <input type="hidden" name="sittingId" value={sitting.id} />
                      <input type="hidden" name="userId" value={line.userId} />
                      <button
                        type="submit"
                        className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                      >
                        Signed
                      </button>
                    </form>
                  ) : (
                    <span className="text-[var(--muted)]">—</span>
                  )}
                </td>

                {sitting.cameraRequired ? (
                  <td className="py-2 pr-3">
                    {line.cameraConfirmedAt ? (
                      <ZonedTime at={line.cameraConfirmedAt} zone={zone} showViewer={false} />
                    ) : line.outcome === "admitted" && !line.droppedOffAt ? (
                      <div className="flex flex-wrap gap-1">
                        <form action={cameraAction}>
                          <input type="hidden" name="cohortId" value={cohortId} />
                          <input type="hidden" name="sittingId" value={sitting.id} />
                          <input type="hidden" name="userId" value={line.userId} />
                          <button
                            type="submit"
                            className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                          >
                            On camera
                          </button>
                        </form>
                        <form action={dropAction}>
                          <input type="hidden" name="cohortId" value={cohortId} />
                          <input type="hidden" name="sittingId" value={sitting.id} />
                          <input type="hidden" name="userId" value={line.userId} />
                          <button
                            type="submit"
                            className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                          >
                            Dropped out
                          </button>
                        </form>
                      </div>
                    ) : (
                      <span className="text-[var(--muted)]">—</span>
                    )}
                  </td>
                ) : null}

                <td className="py-2">
                  {line.scriptReceivedAt ? (
                    <span>
                      <ZonedTime at={line.scriptReceivedAt} zone={zone} showViewer={false} />
                      {line.scriptReference ? ` · ${line.scriptReference}` : ""}
                    </span>
                  ) : line.outcome === "admitted" ? (
                    <form action={scriptAction} className="flex flex-wrap gap-1">
                      <input type="hidden" name="cohortId" value={cohortId} />
                      <input type="hidden" name="sittingId" value={sitting.id} />
                      <input type="hidden" name="userId" value={line.userId} />
                      <input
                        name="reference"
                        placeholder="Script no."
                        className={`${inputClass} w-24`}
                      />
                      <button
                        type="submit"
                        className="rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                      >
                        Received
                      </button>
                    </form>
                  ) : (
                    <span className="text-[var(--muted)]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-[var(--border)] pt-4">
        <h3 className="text-sm font-medium">Incidents</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Filed on the day. An account written weeks later is worth very
          little at an appeal, which is the only place it is ever read.
        </p>

        {incidents.length > 0 ? (
          <ul className="mt-3 space-y-2 text-sm">
            {incidents.map((incident) => (
              <li key={incident.id}>
                <span className="text-[var(--muted)]">
                  <ZonedTime at={incident.occurredAt} zone={zone} withDate showViewer={false} />
                </span>{" "}
                {incident.description}
                {incident.actionTaken ? (
                  <span className="text-[var(--muted)]">
                    {" "}
                    — {incident.actionTaken}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        <form action={incidentAction} className="mt-3 grid gap-2 sm:grid-cols-3">
          <input type="hidden" name="cohortId" value={cohortId} />
          <input type="hidden" name="sittingId" value={sitting.id} />
          <input
            name="description"
            placeholder="What happened"
            className={`${inputClass} sm:col-span-2`}
          />
          <input
            name="actionTaken"
            placeholder="What you did"
            className={inputClass}
          />
          <div className="sm:col-span-3">
            {incidentState.error ? (
              <p className="mb-2 text-sm text-[var(--danger,#b00020)]">
                {incidentState.error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={filing}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
            >
              {filing ? "Filing…" : "File an incident"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
