import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { pageLocale, requireSession, requireTenant } from "@/lib/request";
import { ClassroomError } from "@/lib/classroom";
import { classNotes } from "@/lib/classroom-record";
import { transcriptText } from "@/lib/classroom-transcript";
import { maybe } from "@/lib/i18n/maybe";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

/**
 * A class's published notes (job sheet D41, phase C), for its learners and
 * staff: the summary, the facilitator's notes, the full transcript (Heidi, 23
 * October 2026), the polls and the chat. Prints, or saves as a PDF, for a
 * learner who wants it on their own device.
 */
export default async function ClassNotesPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();
  const { t, day, when } = await pageLocale();

  let notes;
  try {
    notes = await classNotes(session, sessionId);
  } catch (error) {
    if (error instanceof ClassroomError) {
      if (error.code === "not_permitted") redirect("/not-permitted");
      notFound();
    }
    throw error;
  }

  const name = notes.title ?? maybe(t, `session.kind.${notes.kind}`) ?? notes.kind;
  const heading = !notes.title && notes.sequence && notes.kind === "lecture" ? `${name} ${notes.sequence}` : name;
  const time = notes.startTime ? `, ${notes.startTime}${notes.endTime ? `–${notes.endTime}` : ""}` : "";
  // One speaker's consecutive lines read as one turn, as in the summariser's copy.
  const turns = transcriptText(notes.transcript)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf(": ");
      return { name: line.slice(0, at), words: line.slice(at + 2) };
    });

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-[var(--muted)]">{t("notes.eyebrow", { cohort: notes.cohortName })}</p>
          <h1 className="mt-1 text-xl font-semibold">{heading}</h1>
          <p className="text-sm text-[var(--muted)]">
            {[`${day(notes.scheduledDate)}${time}`, notes.facilitatorName].filter(Boolean).join(" · ")}
          </p>
          {notes.myAttendance ? (
            <p className="mt-1 text-sm">
              {t("notes.attendance", { status: maybe(t, `notes.mark.${notes.myAttendance.status}`) ?? notes.myAttendance.status })}
            </p>
          ) : null}
        </div>
        <PrintButton label={t("notes.print")} />
      </div>

      <div className="space-y-6">
        {notes.summary.trim() ? (
          <Card title={t("notes.summary")}>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{notes.summary}</div>
          </Card>
        ) : null}

        {notes.notes.trim() ? (
          <Card title={t("notes.facilitatorNotes")}>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{notes.notes}</div>
          </Card>
        ) : null}

        {notes.polls.length ? (
          <Card title={t("notes.polls")}>
            <ul className="space-y-3 text-sm">
              {notes.polls.map((poll, index) => (
                <li key={index}>
                  <p className="font-medium">{poll.question}</p>
                  <p className="text-[var(--muted)]">{poll.options.map((option, n) => `${option}: ${poll.counts[n]}`).join(" · ")}</p>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {turns.length ? (
          <Card title={t("notes.transcript")} description={t("notes.transcriptNote")}>
            <div className="space-y-2 text-sm leading-relaxed">
              {turns.map((turn, index) => (
                <p key={index}>
                  <span className="font-medium">{turn.name}:</span> {turn.words}
                </p>
              ))}
            </div>
          </Card>
        ) : null}

        {notes.chat.length ? (
          <Card title={t("notes.chat")}>
            <ul className="space-y-1 text-sm">
              {notes.chat.map((line, index) => (
                <li key={index}>
                  <span className="font-medium">{line.name}</span>: {line.body}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <p className="text-xs text-[var(--muted)]">{t("notes.published", { when: when(notes.publishedAt) })}</p>
        <Link href="/" className="text-sm text-[var(--muted)] hover:underline print:hidden">
          {t("notes.home")}
        </Link>
      </div>
    </AppShell>
  );
}
