"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RoomEvent, type Participant, type Room } from "livekit-client";
import { useT } from "@/components/i18n";

/**
 * The classroom's extras (Heidi, 23 October 2026: breakout rooms, a
 * whiteboard and polls from the start).
 */

export type PollView = {
  id: string;
  question: string;
  options: string[];
  closed: boolean;
  counts: number[] | null;
  mine: number | null;
};

export type GroupMember = { userId: string; name: string };

const BUTTON = "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium disabled:opacity-60";
const FIELD = "w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

/**
 * Whether a participant runs the class. Read from what the media server lets
 * them do (only a host may share a screen), which a participant cannot change,
 * rather than from an attribute they could.
 */
export function hostsTheClass(participant: Participant): boolean {
  // 3 is the screen-share source in the media server's own numbering.
  return Boolean(participant.permissions?.canPublishSources?.includes(3));
}

export async function ask(sessionId: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/classroom/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : response.statusText);
  return data;
}

function Results({ poll }: { poll: PollView }) {
  const total = (poll.counts ?? []).reduce((sum, n) => sum + n, 0);
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {poll.options.map((option, index) => {
        const count = poll.counts?.[index] ?? 0;
        const share = total ? Math.round((count * 100) / total) : 0;
        return (
          <li key={index}>
            <div className="flex justify-between gap-2">
              <span>
                {option}
                {poll.mine === index ? " ✓" : ""}
              </span>
              <span className="tabular-nums text-[var(--muted)]">
                {count} · {share}%
              </span>
            </div>
            <div className="h-1.5 rounded bg-[var(--border)]">
              <div className="h-1.5 rounded bg-[var(--brand-accent)]" style={{ width: `${share}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** What a learner sees: the open question to answer, and results once a poll closes. */
export function LearnerPoll({ sessionId, polls, setPolls }: { sessionId: string; polls: PollView[]; setPolls: (update: (all: PollView[]) => PollView[]) => void }) {
  const t = useT();
  const [problem, setProblem] = useState<string | null>(null);
  const latest = polls.at(-1);
  if (!latest) return null;

  return (
    <div className="rounded-lg border border-[var(--brand-accent)] bg-[var(--surface)] p-3">
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{latest.closed ? t("class.pollResults") : t("class.pollOpen")}</p>
      <p className="mt-1 font-medium">{latest.question}</p>
      {latest.closed ? (
        <Results poll={latest} />
      ) : latest.mine !== null ? (
        <p className="mt-2 text-sm text-[var(--muted)]">{t("class.pollSent", { answer: latest.options[latest.mine] })}</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {latest.options.map((option, index) => (
            <button
              key={index}
              type="button"
              className={BUTTON}
              onClick={async () => {
                setProblem(null);
                try {
                  await ask(sessionId, { do: "poll_answer", pollId: latest.id, choice: index });
                  setPolls((all) => all.map((one) => (one.id === latest.id ? { ...one, mine: index } : one)));
                } catch (caught) {
                  setProblem(caught instanceof Error ? caught.message : String(caught));
                }
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
      {problem ? <p role="alert" className="mt-1 text-xs text-[var(--danger)]">{problem}</p> : null}
    </div>
  );
}

/** The facilitator's polls: ask one, watch the answers come in, close it. */
export function HostPolls({ sessionId, polls, setPolls }: { sessionId: string; polls: PollView[]; setPolls: (update: (all: PollView[]) => PollView[]) => void }) {
  const t = useT();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const open = polls.some((poll) => !poll.closed);

  // The answers, every three seconds while a poll is open.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(async () => {
      try {
        const answer = await ask(sessionId, { do: "polls" });
        setPolls(() => answer.polls);
      } catch {
        // Tried again on the next tick.
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [open, sessionId, setPolls]);

  return (
    <div className="space-y-3 text-sm">
      <form
        className="space-y-2"
        onSubmit={async (event) => {
          event.preventDefault();
          setProblem(null);
          try {
            const answer = await ask(sessionId, { do: "poll_start", question, options: options.split("\n") });
            // The server's own announcement of it may have arrived first.
            setPolls((all) => [...all.filter((one) => one.id !== answer.poll.id), answer.poll]);
            setQuestion("");
            setOptions("");
          } catch (caught) {
            setProblem(caught instanceof Error ? caught.message : String(caught));
          }
        }}
      >
        <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={t("class.pollQuestion")} aria-label={t("class.pollQuestion")} className={FIELD} />
        <textarea value={options} onChange={(event) => setOptions(event.target.value)} rows={4} placeholder={t("class.pollOptions")} aria-label={t("class.pollOptions")} className={FIELD} />
        <button type="submit" className={BUTTON}>
          {t("class.pollAsk")}
        </button>
        {problem ? <p role="alert" className="text-xs text-[var(--danger)]">{problem}</p> : null}
      </form>
      {[...polls].reverse().map((poll) => (
        <div key={poll.id} className="border-t border-[var(--border)] pt-2">
          <p className="font-medium">{poll.question}</p>
          <Results poll={poll} />
          {poll.closed ? (
            <p className="mt-1 text-xs text-[var(--muted)]">{t("class.pollClosed")}</p>
          ) : (
            <button
              type="button"
              className={`${BUTTON} mt-2`}
              onClick={async () => {
                try {
                  const answer = await ask(sessionId, { do: "poll_close", pollId: poll.id });
                  setPolls((all) => all.map((one) => (one.id === poll.id ? answer.poll : one)));
                } catch (caught) {
                  setProblem(caught instanceof Error ? caught.message : String(caught));
                }
              }}
            >
              {t("class.pollClose")}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** The facilitator's breakout groups: start them, visit one, bring everyone back. */
export function HostGroups({
  sessionId,
  groups,
  setGroups,
  visiting,
  onVisit,
}: {
  sessionId: string;
  groups: GroupMember[][] | null;
  setGroups: (groups: GroupMember[][] | null) => void;
  visiting: number | null;
  onVisit: (group: number | null) => void;
}) {
  const t = useT();
  const [count, setCount] = useState(3);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  if (!groups) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-[var(--muted)]">{t("class.groupsNote")}</p>
        <label className="flex items-center gap-2">
          <span>{t("class.groupsCount")}</span>
          <input type="number" min={2} max={20} value={count} onChange={(event) => setCount(Number(event.target.value))} className="w-16 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1" />
        </label>
        <button
          type="button"
          disabled={busy}
          className={BUTTON}
          onClick={() =>
            act(async () => {
              await ask(sessionId, { do: "breakout_start", count });
              const answer = await ask(sessionId, { do: "groups" });
              setGroups(answer.breakout);
            })
          }
        >
          {t("class.groupsStart")}
        </button>
        {problem ? <p role="alert" className="text-xs text-[var(--danger)]">{problem}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      {groups.map((group, index) => (
        <div key={index} className="rounded-md border border-[var(--border)] p-2">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">{t("class.groupName", { number: index + 1 })}</p>
            {visiting === index + 1 ? (
              <span className="text-xs text-[var(--brand-accent)]">{t("class.groupHere")}</span>
            ) : (
              <button type="button" disabled={busy} className="text-xs underline" onClick={() => onVisit(index + 1)}>
                {t("class.groupVisit")}
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">{group.map((member) => member.name).join(", ")}</p>
        </div>
      ))}
      {visiting ? (
        <button type="button" disabled={busy} className={BUTTON} onClick={() => onVisit(null)}>
          {t("class.groupLeave")}
        </button>
      ) : null}
      <button
        type="button"
        disabled={busy}
        className={BUTTON}
        onClick={() =>
          act(async () => {
            await ask(sessionId, { do: "breakout_end" });
            setGroups(null);
            if (visiting) onVisit(null);
          })
        }
      >
        {t("class.groupsEnd")}
      </button>
      {problem ? <p role="alert" className="text-xs text-[var(--danger)]">{problem}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The whiteboard
// ---------------------------------------------------------------------------

type Stroke = { id: string; colour: string; points: [number, number][] };
type BoardMessage =
  | { type: "stroke"; stroke: Stroke }
  | { type: "clear" }
  | { type: "state"; open: boolean; learnersDraw: boolean; strokes?: Stroke[] }
  | { type: "sync_request" };

const COLOURS = ["#1f2933", "#c0392b", "#1e6fb8", "#2e7d32"];

/**
 * A shared drawing board. Strokes go from browser to browser through the
 * media server; the facilitator's browser holds the board and gives it to
 * anybody who joins late. Nothing of it is stored once the class ends.
 */
export function useBoard(room: Room, host: boolean) {
  const [open, setOpen] = useState(false);
  const [learnersDraw, setLearnersDraw] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const state = useRef({ open, learnersDraw, strokes });
  useEffect(() => {
    state.current = { open, learnersDraw, strokes };
  }, [open, learnersDraw, strokes]);

  const send = useCallback(
    (message: BoardMessage, to?: string[]) =>
      room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(message)), { reliable: true, topic: "board", destinationIdentities: to }),
    [room],
  );

  useEffect(() => {
    const onData = (payload: Uint8Array, participant?: Participant, _kind?: unknown, topic?: string) => {
      if (topic !== "board" || !participant) return;
      let message: BoardMessage;
      try {
        message = JSON.parse(new TextDecoder().decode(payload));
      } catch {
        return;
      }
      const fromHost = hostsTheClass(participant);
      if (message.type === "sync_request") {
        if (host) void send({ type: "state", ...state.current }, [participant.identity]);
      } else if (message.type === "state" && fromHost) {
        setOpen(message.open);
        setLearnersDraw(message.learnersDraw);
        if (message.strokes) setStrokes(message.strokes);
      } else if (message.type === "clear" && fromHost) {
        setStrokes([]);
      } else if (message.type === "stroke" && (fromHost || state.current.learnersDraw)) {
        setStrokes((all) => [...all, message.stroke]);
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    // Somebody arriving late asks the facilitator for the board as it stands.
    if (!host) void send({ type: "sync_request" });
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room, host, send]);

  const setBoard = (next: { open?: boolean; learnersDraw?: boolean }) => {
    const value = { open: next.open ?? open, learnersDraw: next.learnersDraw ?? learnersDraw };
    setOpen(value.open);
    setLearnersDraw(value.learnersDraw);
    void send({ type: "state", ...value, strokes });
  };

  return {
    open,
    learnersDraw,
    strokes,
    canDraw: host || learnersDraw,
    setBoard,
    clear: () => {
      setStrokes([]);
      void send({ type: "clear" });
    },
    draw: (stroke: Stroke) => {
      setStrokes((all) => [...all, stroke]);
      void send({ type: "stroke", stroke });
    },
  };
}

export function Whiteboard({ board }: { board: ReturnType<typeof useBoard> }) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [colour, setColour] = useState(COLOURS[0]);
  const current = useRef<Stroke | null>(null);

  // Redrawn whenever the strokes change; points are kept as fractions of the board.
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    context.clearRect(0, 0, element.width, element.height);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 3;
    for (const stroke of board.strokes) {
      context.strokeStyle = stroke.colour;
      context.beginPath();
      stroke.points.forEach(([x, y], index) => (index ? context.lineTo(x * element.width, y * element.height) : context.moveTo(x * element.width, y * element.height)));
      context.stroke();
    }
  }, [board.strokes]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const box = event.currentTarget.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), Math.min(1, Math.max(0, (event.clientY - box.top) / box.height))];
  };

  return (
    <div className="relative h-full w-full bg-white">
      <canvas
        ref={canvas}
        width={1280}
        height={720}
        aria-label={t("class.board")}
        className={`h-full w-full touch-none ${board.canDraw ? "cursor-crosshair" : ""}`}
        onPointerDown={(event) => {
          if (!board.canDraw) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          current.current = { id: `${Date.now()}-${Math.random()}`, colour, points: [point(event)] };
        }}
        onPointerMove={(event) => {
          const stroke = current.current;
          const element = canvas.current;
          const context = element?.getContext("2d");
          if (!stroke || !element || !context) return;
          const [x, y] = point(event);
          const [px, py] = stroke.points.at(-1)!;
          stroke.points.push([x, y]);
          context.strokeStyle = stroke.colour;
          context.lineWidth = 3;
          context.lineCap = "round";
          context.beginPath();
          context.moveTo(px * element.width, py * element.height);
          context.lineTo(x * element.width, y * element.height);
          context.stroke();
        }}
        onPointerUp={() => {
          if (current.current && current.current.points.length > 1) board.draw(current.current);
          current.current = null;
        }}
      />
      {board.canDraw ? (
        <div className="absolute left-2 top-2 flex gap-1 rounded bg-white/90 p-1 shadow">
          {COLOURS.map((one) => (
            <button
              key={one}
              type="button"
              aria-label={t("class.boardColour")}
              onClick={() => setColour(one)}
              className={`h-6 w-6 rounded-full border-2 ${colour === one ? "border-[var(--brand-accent)]" : "border-transparent"}`}
              style={{ background: one }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
