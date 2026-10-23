"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import Link from "next/link";
import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrackPublication,
  type TrackPublication,
} from "livekit-client";
import { useT } from "@/components/i18n";

/**
 * The LMS classroom (job sheet D41, phase A), in the browser.
 *
 * Voice for everybody; the facilitator's shared screen, or their camera, on
 * the stage; other cameras, where the provider allows them, beneath it. A
 * learner's microphone and camera start off, which saves their data and keeps
 * a room of thirty quiet. Low data drops every picture and keeps the voice.
 *
 * The page redraws from the room itself whenever the room reports a change,
 * rather than copying its state into React piece by piece: the room is the
 * truth, and a copy is a second truth that can disagree with it.
 */

export type ChatLine = { id: string; userId?: string; name: string; body: string; sentAt: string; mine?: boolean };

type Props = {
  sessionId: string;
  cohortId: string;
  facilitatorName: string | null;
  role: "host" | "staff" | "learner";
  initialState: "early" | "lobby" | "open" | "ended" | "cancelled";
  opensAtClock: string;
  cameras: boolean;
  configured: boolean;
  chat: ChatLine[];
  notes: string | null;
};

type Phase =
  | { kind: "waiting"; state: "early" | "lobby" }
  | { kind: "ready" }
  | { kind: "connecting" }
  | { kind: "in" }
  | { kind: "ended" }
  | { kind: "removed" }
  | { kind: "cancelled" };

const BUTTON = "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium disabled:opacity-60";
const PRIMARY = "rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60";

async function ask(sessionId: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/classroom/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : response.statusText);
  return data;
}

/** One track, attached to its own media element for as long as it is shown. */
function TrackView({ publication, kind, className }: { publication: TrackPublication; kind: "video" | "audio"; className?: string }) {
  const element = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const track = publication.track;
  useEffect(() => {
    const target = element.current;
    if (!track || !target) return;
    track.attach(target);
    return () => {
      track.detach(target);
    };
  }, [track]);
  if (kind === "audio") return <audio ref={element} autoPlay />;
  return <video ref={element} autoPlay playsInline muted className={className} />;
}

function nameOf(participant: Participant): string {
  return participant.name || participant.identity;
}

function isHost(participant: Participant): boolean {
  return participant.attributes.role === "host";
}

export function Classroom(props: Props) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>(() =>
    props.initialState === "open"
      ? { kind: "ready" }
      : props.initialState === "ended"
        ? { kind: "ended" }
        : props.initialState === "cancelled"
          ? { kind: "cancelled" }
          : { kind: "waiting", state: props.initialState },
  );
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const [lowData, setLowData] = useState(false);
  const [panel, setPanel] = useState<"people" | "chat" | "notes">("people");
  const [chat, setChat] = useState<ChatLine[]>(props.chat);
  const host = props.role === "host";

  // The lobby asks every ten seconds whether the facilitator has opened the class.
  useEffect(() => {
    if (phase.kind !== "waiting" || host) return;
    const timer = setInterval(async () => {
      try {
        const answer = await ask(props.sessionId, { do: "pass" });
        if (answer.token) setPhase({ kind: "ready" });
        else if (answer.waiting === "ended") setPhase({ kind: "ended" });
        else if (answer.waiting === "cancelled") setPhase({ kind: "cancelled" });
        else if (answer.waiting === "lobby" || answer.waiting === "early") setPhase({ kind: "waiting", state: answer.waiting });
      } catch {
        // Tried again on the next tick.
      }
    }, 10_000);
    return () => clearInterval(timer);
  }, [phase.kind, host, props.sessionId]);

  // Leaving the page leaves the class.
  useEffect(() => {
    return () => {
      void room?.disconnect();
    };
  }, [room]);

  const join = useCallback(async () => {
    setError(null);
    setPhase({ kind: "connecting" });
    try {
      const answer = await ask(props.sessionId, { do: "pass" });
      if (!answer.token) {
        setPhase(answer.waiting === "ended" ? { kind: "ended" } : { kind: "waiting", state: answer.waiting === "early" ? "early" : "lobby" });
        return;
      }
      const next = new Room({ adaptiveStream: true, dynacast: true });
      const events = [
        RoomEvent.ParticipantConnected,
        RoomEvent.ParticipantDisconnected,
        RoomEvent.TrackSubscribed,
        RoomEvent.TrackUnsubscribed,
        RoomEvent.TrackPublished,
        RoomEvent.TrackUnpublished,
        RoomEvent.TrackMuted,
        RoomEvent.TrackUnmuted,
        RoomEvent.LocalTrackPublished,
        RoomEvent.LocalTrackUnpublished,
        RoomEvent.ActiveSpeakersChanged,
        RoomEvent.ParticipantAttributesChanged,
        RoomEvent.ConnectionStateChanged,
      ] as const;
      for (const event of events) next.on(event, () => redraw());
      next.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        if (topic !== "chat") return;
        try {
          const line = JSON.parse(new TextDecoder().decode(payload)) as ChatLine;
          setChat((lines) => (lines.some((one) => one.id === line.id) ? lines : [...lines, line]));
        } catch {
          // Not a chat line.
        }
      });
      next.on(RoomEvent.Disconnected, (reason) => {
        setRoom(null);
        if (reason === DisconnectReason.ROOM_DELETED) setPhase({ kind: "ended" });
        else if (reason === DisconnectReason.PARTICIPANT_REMOVED) setPhase({ kind: "removed" });
        else setPhase({ kind: "ready" });
      });
      await next.connect(answer.url, answer.token);
      await next.startAudio();
      // The facilitator is heard from the start; a learner unmutes to speak.
      if (host) await next.localParticipant.setMicrophoneEnabled(true).catch(() => setError(t("class.noMicrophone")));
      setRoom(next);
      setPhase({ kind: "in" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setPhase({ kind: "ready" });
    }
  }, [props.sessionId, host, t]);

  // Low data: no pictures received, and none sent.
  useEffect(() => {
    if (!room) return;
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.kind === Track.Kind.Video) (publication as RemoteTrackPublication).setSubscribed(!lowData);
      }
    }
    if (lowData) void room.localParticipant.setCameraEnabled(false);
  }, [room, lowData]);

  if (!props.configured) {
    return <Notice title={t("class.notSetUp")} body={t("class.notSetUpNote")} />;
  }
  if (phase.kind === "cancelled") return <Notice title={t("class.cancelled")} />;
  if (phase.kind === "removed") return <Notice title={t("class.removed")} />;
  if (phase.kind === "ended") {
    return (
      <Notice title={t("class.ended")} body={host ? t("class.endedHost") : t("class.endedLearner")}>
        {host ? (
          <Link href={`/cohorts/${props.cohortId}/sessions/${props.sessionId}`} className={PRIMARY} style={{ background: "var(--brand-primary)" }}>
            {t("class.checkRegister")}
          </Link>
        ) : null}
      </Notice>
    );
  }

  if (phase.kind === "waiting" && !host) {
    return (
      <Notice
        title={phase.state === "early" ? t("class.early", { time: props.opensAtClock }) : t("class.lobby")}
        body={phase.state === "early" ? t("class.earlyNote") : t("class.lobbyNote", { name: props.facilitatorName ?? t("class.theFacilitator") })}
      />
    );
  }

  if (!room || phase.kind !== "in") {
    return (
      <Notice
        title={host && phase.kind === "waiting" ? t("class.openTitle") : t("class.readyTitle")}
        body={host && phase.kind === "waiting" ? t("class.openNote") : t("class.readyNote")}
      >
        {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
        <button type="button" onClick={join} disabled={phase.kind === "connecting"} className={PRIMARY} style={{ background: "var(--brand-primary)" }}>
          {phase.kind === "connecting" ? t("class.joining") : host && phase.kind === "waiting" ? t("class.open") : t("class.join")}
        </button>
      </Notice>
    );
  }

  return (
    <InClass
      room={room}
      props={props}
      lowData={lowData}
      setLowData={setLowData}
      panel={panel}
      setPanel={setPanel}
      chat={chat}
      setChat={setChat}
      error={error}
      setError={setError}
      onEnded={() => {
        void room.disconnect();
        setPhase({ kind: "ended" });
      }}
    />
  );
}

function Notice({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      {body ? <p className="mt-2 text-sm text-[var(--muted)]">{body}</p> : null}
      {children ? <div className="mt-4 flex flex-col items-center gap-3">{children}</div> : null}
    </div>
  );
}

function InClass({
  room,
  props,
  lowData,
  setLowData,
  panel,
  setPanel,
  chat,
  setChat,
  error,
  setError,
  onEnded,
}: {
  room: Room;
  props: Props;
  lowData: boolean;
  setLowData: (value: boolean) => void;
  panel: "people" | "chat" | "notes";
  setPanel: (value: "people" | "chat" | "notes") => void;
  chat: ChatLine[];
  setChat: React.Dispatch<React.SetStateAction<ChatLine[]>>;
  error: string | null;
  setError: (value: string | null) => void;
  onEnded: () => void;
}) {
  const t = useT();
  const host = props.role === "host";
  const me = room.localParticipant;
  const everyone: Participant[] = [me, ...room.remoteParticipants.values()];
  const speaking = new Set(room.activeSpeakers.map((one) => one.identity));
  const handUp = (participant: Participant) => Boolean(participant.attributes.hand);

  const screen = everyone.map((one) => one.getTrackPublication(Track.Source.ScreenShare)).find((pub) => pub?.track && !pub.isMuted);
  const hostCamera = everyone
    .filter(isHost)
    .map((one) => one.getTrackPublication(Track.Source.Camera))
    .find((pub) => pub?.track && !pub.isMuted);
  const stage = lowData ? undefined : (screen ?? hostCamera);
  const tiles = lowData
    ? []
    : everyone
        .map((one) => ({ one, pub: one.getTrackPublication(Track.Source.Camera) }))
        .filter(({ pub }) => pub?.track && !pub.isMuted && pub !== stage);
  const voices: TrackPublication[] = [];
  for (const one of room.remoteParticipants.values()) {
    const pub = one.getTrackPublication(Track.Source.Microphone);
    if (pub?.track) voices.push(pub);
  }

  const micOn = me.isMicrophoneEnabled;
  const cameraOn = me.isCameraEnabled;
  const sharing = me.isScreenShareEnabled;

  const attempt = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const control = (body: Record<string, unknown>) => attempt(() => ask(props.sessionId, { do: "control", control: body }));

  return (
    <div className="space-y-3">
      {voices.map((pub) => (
        <TrackView key={pub.trackSid} publication={pub} kind="audio" />
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--muted)]">{t("class.inCount", { count: everyone.length })}</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={lowData} onChange={(event) => setLowData(event.target.checked)} />
            {t("class.lowData")}
          </label>
          {host ? (
            <button
              type="button"
              className={PRIMARY}
              style={{ background: "var(--danger)" }}
              onClick={() => {
                if (!window.confirm(t("class.endConfirm"))) return;
                void attempt(async () => {
                  await ask(props.sessionId, { do: "end" });
                  onEnded();
                });
              }}
            >
              {t("class.end")}
            </button>
          ) : (
            <button type="button" className={BUTTON} onClick={() => void room.disconnect()}>
              {t("class.leave")}
            </button>
          )}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-[#111] text-sm text-white/80">
            {stage ? (
              <TrackView publication={stage} kind="video" className="h-full w-full object-contain" />
            ) : (
              <div className="p-4 text-center">
                <p>{lowData ? t("class.lowDataStage") : t("class.nothingShared")}</p>
                <p className="mt-2">
                  {everyone.filter((one) => speaking.has(one.identity)).map(nameOf).join(", ") || t("class.nobodySpeaking")}
                </p>
              </div>
            )}
          </div>

          {tiles.length ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {tiles.map(({ one, pub }) => (
                <div key={one.identity} className="relative overflow-hidden rounded-md bg-[#111]">
                  <TrackView publication={pub!} kind="video" className="aspect-video w-full object-cover" />
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-xs text-white">{nameOf(one)}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON} onClick={() => void attempt(() => me.setMicrophoneEnabled(!micOn))}>
              {micOn ? t("class.muteMe") : t("class.unmuteMe")}
            </button>
            {props.cameras && !lowData ? (
              <button type="button" className={BUTTON} onClick={() => void attempt(() => me.setCameraEnabled(!cameraOn))}>
                {cameraOn ? t("class.cameraOff") : t("class.cameraOn")}
              </button>
            ) : null}
            {host ? (
              <button type="button" className={BUTTON} onClick={() => void attempt(() => me.setScreenShareEnabled(!sharing))}>
                {sharing ? t("class.stopSharing") : t("class.share")}
              </button>
            ) : (
              <button
                type="button"
                className={BUTTON}
                onClick={() => void attempt(() => me.setAttributes({ hand: handUp(me) ? "" : new Date().toISOString() }))}
              >
                {handUp(me) ? t("class.lowerHand") : t("class.raiseHand")}
              </button>
            )}
          </div>
        </div>

        <aside className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex border-b border-[var(--border)] text-sm" role="tablist">
            {(["people", "chat", ...(host ? (["notes"] as const) : [])] as const).map((one) => (
              <button
                key={one}
                type="button"
                role="tab"
                aria-selected={panel === one}
                onClick={() => setPanel(one)}
                className={`flex-1 px-3 py-2 ${panel === one ? "border-b-2 border-[var(--brand-accent)] font-semibold" : "text-[var(--muted)]"}`}
              >
                {one === "people" ? t("class.people", { count: everyone.length }) : one === "chat" ? t("class.chat") : t("class.notes")}
              </button>
            ))}
          </div>
          <div className="p-3">
            {panel === "people" ? (
              <People
                everyone={everyone}
                me={me}
                host={host}
                speaking={speaking}
                handUp={handUp}
                onMute={(one) => {
                  const mic = one.getTrackPublication(Track.Source.Microphone);
                  if (mic?.trackSid) void control({ action: "mute", identity: one.identity, trackSid: mic.trackSid });
                }}
                onMuteAll={() => void control({ action: "mute_all" })}
                onLower={(one) => void control({ action: "lower_hand", identity: one.identity })}
                onRemove={(one) => {
                  if (window.confirm(t("class.removeConfirm", { name: nameOf(one) }))) void control({ action: "remove", identity: one.identity });
                }}
              />
            ) : panel === "chat" ? (
              <Chat sessionId={props.sessionId} lines={chat} setLines={setChat} />
            ) : (
              <Notes sessionId={props.sessionId} initial={props.notes ?? ""} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function People({
  everyone,
  me,
  host,
  speaking,
  handUp,
  onMute,
  onMuteAll,
  onLower,
  onRemove,
}: {
  everyone: Participant[];
  me: Participant;
  host: boolean;
  speaking: Set<string>;
  handUp: (one: Participant) => boolean;
  onMute: (one: Participant) => void;
  onMuteAll: () => void;
  onLower: (one: Participant) => void;
  onRemove: (one: Participant) => void;
}) {
  const t = useT();
  // Raised hands first, in the order they went up; then everybody else by name.
  const ordered = [...everyone].sort((a, b) => {
    const ha = a.attributes.hand || "";
    const hb = b.attributes.hand || "";
    if (ha && hb) return ha.localeCompare(hb);
    if (ha || hb) return ha ? -1 : 1;
    return nameOf(a).localeCompare(nameOf(b));
  });
  return (
    <div className="space-y-2">
      {host ? (
        <button type="button" className={BUTTON} onClick={onMuteAll}>
          {t("class.muteAll")}
        </button>
      ) : null}
      <ul className="space-y-1.5 text-sm">
        {ordered.map((one) => {
          const micOn = one.isMicrophoneEnabled;
          return (
            <li key={one.identity} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                aria-hidden
                className={`inline-block h-2 w-2 rounded-full ${speaking.has(one.identity) ? "bg-[var(--success)]" : "bg-[var(--border)]"}`}
              />
              <span className="font-medium">{nameOf(one)}</span>
              {one === me ? <span className="text-xs text-[var(--muted)]">{t("class.you")}</span> : null}
              {isHost(one) ? <span className="text-xs text-[var(--brand-accent)]">{t("class.facilitator")}</span> : null}
              {handUp(one) ? <span className="text-xs font-semibold text-[var(--warning)]">{t("class.handUp")}</span> : null}
              <span className="text-xs text-[var(--muted)]">{micOn ? t("class.micOn") : t("class.micOff")}</span>
              {host && one !== me ? (
                <span className="ml-auto flex gap-2 text-xs">
                  {micOn ? (
                    <button type="button" className="underline" onClick={() => onMute(one)}>
                      {t("class.mute")}
                    </button>
                  ) : null}
                  {handUp(one) ? (
                    <button type="button" className="underline" onClick={() => onLower(one)}>
                      {t("class.lower")}
                    </button>
                  ) : null}
                  <button type="button" className="text-[var(--danger)] underline" onClick={() => onRemove(one)}>
                    {t("class.remove")}
                  </button>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Chat({
  sessionId,
  lines,
  setLines,
}: {
  sessionId: string;
  lines: ChatLine[];
  setLines: React.Dispatch<React.SetStateAction<ChatLine[]>>;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [lines.length]);

  return (
    <div className="flex h-80 flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto text-sm">
        {lines.length === 0 ? <p className="text-[var(--muted)]">{t("class.chatEmpty")}</p> : null}
        {lines.map((line) => (
          <p key={line.id}>
            <span className="font-medium">{line.name}</span>{" "}
            <span className="text-xs text-[var(--muted)]">{new Date(line.sentAt).toTimeString().slice(0, 5)}</span>
            <br />
            {line.body}
          </p>
        ))}
        <div ref={end} />
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!draft.trim()) return;
          setSending(true);
          setProblem(null);
          try {
            const answer = await ask(sessionId, { do: "chat", body: draft });
            setLines((all) => (all.some((one) => one.id === answer.line.id) ? all : [...all, answer.line]));
            setDraft("");
          } catch (caught) {
            setProblem(caught instanceof Error ? caught.message : String(caught));
          } finally {
            setSending(false);
          }
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={2000}
          aria-label={t("class.chatLabel")}
          className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
        />
        <button type="submit" disabled={sending} className={BUTTON}>
          {t("class.send")}
        </button>
      </form>
      {problem ? <p role="alert" className="mt-1 text-xs text-[var(--danger)]">{problem}</p> : null}
    </div>
  );
}

/** The facilitator's notes, saved two seconds after they stop typing. */
function Notes({ sessionId, initial }: { sessionId: string; initial: string }) {
  const t = useT();
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const answer = await ask(sessionId, { do: "notes", body: value });
        setSaved(new Date(answer.savedAt).toTimeString().slice(0, 5));
        setProblem(null);
      } catch (caught) {
        setProblem(caught instanceof Error ? caught.message : String(caught));
      }
    }, 2000);
  };

  return (
    <div>
      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          save(event.target.value);
        }}
        rows={14}
        aria-label={t("class.notes")}
        placeholder={t("class.notesHint")}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-sm"
      />
      <p className="mt-1 text-xs text-[var(--muted)]">{saved ? t("class.notesSaved", { time: saved }) : t("class.notesAuto")}</p>
      {problem ? <p role="alert" className="text-xs text-[var(--danger)]">{problem}</p> : null}
    </div>
  );
}
