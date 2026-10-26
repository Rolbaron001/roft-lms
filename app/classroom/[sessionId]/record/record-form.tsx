"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { useT } from "@/components/i18n";
import { ask } from "../extras";

const BUTTON = "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium disabled:opacity-60";
const PRIMARY = "rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60";

type Line = { index: number; name: string; at: string; text: string };

/**
 * The transcript to correct, the summary to write or have drafted, and
 * Publish. Each correction saves as the facilitator leaves the line.
 */
export function RecordForm({
  sessionId,
  status,
  transcriptError,
  transcript,
  summary: initialSummary,
  canPublish,
  ended,
  publishedAt,
  voicesDeleted,
}: {
  sessionId: string;
  status: "none" | "waiting" | "working" | "done" | "failed";
  transcriptError: string | null;
  transcript: Line[];
  summary: string;
  canPublish: boolean;
  ended: boolean;
  publishedAt: string | null;
  voicesDeleted: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [summary, setSummary] = useState(initialSummary);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const act = async (what: string, work: () => Promise<void>) => {
    setBusy(what);
    setProblem(null);
    setNotice(null);
    try {
      await work();
    } catch (caught) {
      setProblem(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const statusLine =
    status === "waiting" || status === "working"
      ? t("record.working")
      : status === "failed"
        ? t("record.failed", { error: transcriptError ?? "" })
        : status === "none"
          ? t("record.none")
          : null;

  return (
    <>
      <Card title={t("record.transcript")} description={status === "done" ? t("record.transcriptNote") : undefined}>
        {statusLine ? <p className="text-sm text-[var(--muted)]">{statusLine}</p> : null}
        {transcript.length ? (
          <ol className="space-y-2 text-sm">
            {transcript.map((line) => (
              <li key={line.index} className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                <span className="text-[var(--muted)]">
                  <span className="tabular-nums">{line.at}</span> {line.name}
                </span>
                <textarea
                  defaultValue={line.text}
                  rows={Math.max(1, Math.ceil(line.text.length / 90))}
                  aria-label={t("record.lineLabel", { name: line.name, time: line.at })}
                  className="w-full rounded-md border border-transparent bg-transparent p-1 hover:border-[var(--border)] focus:border-[var(--brand-accent)]"
                  onBlur={(event) => {
                    if (event.target.value.trim() === line.text) return;
                    void act("line", () => ask(sessionId, { do: "transcript_correct", index: line.index, text: event.target.value }));
                  }}
                />
              </li>
            ))}
          </ol>
        ) : null}
      </Card>

      <Card title={t("record.summary")} description={t("record.summaryNote")}>
        <textarea
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          rows={14}
          aria-label={t("record.summary")}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-sm"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className={BUTTON}
            disabled={busy !== null}
            onClick={() =>
              act("draft", async () => {
                const answer = await ask(sessionId, { do: "summary_draft" });
                setSummary(answer.summary);
                setNotice(t("record.drafted"));
              })
            }
          >
            {busy === "draft" ? t("record.drafting") : t("record.draft")}
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={busy !== null}
            onClick={() =>
              act("save", async () => {
                await ask(sessionId, { do: "summary_save", summary });
                setNotice(t("record.saved"));
              })
            }
          >
            {t("record.save")}
          </button>
        </div>
      </Card>

      <Card title={t("record.publishTitle")} description={publishedAt ? undefined : t("record.publishNote")}>
        {publishedAt ? (
          <p className="text-sm">
            {t("record.published", { when: publishedAt })} {voicesDeleted ? t("record.voicesDeleted") : t("record.voicesKept")}
          </p>
        ) : null}
        {!ended ? <p className="text-sm text-[var(--muted)]">{t("record.notEnded")}</p> : null}
        {!publishedAt || !voicesDeleted ? (
          <button
            type="button"
            className={`${PRIMARY} mt-2`}
            style={{ background: "var(--brand-primary)" }}
            disabled={!canPublish || busy !== null}
            onClick={() =>
              act("publish", async () => {
                await ask(sessionId, { do: "summary_save", summary });
                const answer = await ask(sessionId, { do: "publish" });
                setNotice(answer.voicesDeleted ? t("record.publishDone") : t("record.voicesKept"));
                router.refresh();
              })
            }
          >
            {publishedAt ? t("record.deleteAgain") : t("record.publish")}
          </button>
        ) : null}
      </Card>

      {problem ? <p role="alert" className="text-sm text-[var(--danger)]">{problem}</p> : null}
      {notice ? <p role="status" className="text-sm text-[var(--success)]">{notice}</p> : null}
    </>
  );
}
