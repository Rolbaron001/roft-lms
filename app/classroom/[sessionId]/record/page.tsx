import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { pageLocale, requireSession, requireTenant } from "@/lib/request";
import { ClassroomError } from "@/lib/classroom";
import { getClassRecord } from "@/lib/classroom-record";
import { maybe } from "@/lib/i18n/maybe";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { RecordForm } from "./record-form";

/**
 * The facilitator's one check of a class (job sheet D41, phase B): the
 * transcript, the summary, the notes, the polls, the chat and the register,
 * with Publish at the foot. Publishing deletes the class's voices.
 */
export default async function ClassRecordPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();
  const { t, day, when } = await pageLocale();

  let record;
  try {
    record = await getClassRecord(session, sessionId);
  } catch (error) {
    if (error instanceof ClassroomError) {
      if (error.code === "not_permitted") redirect("/not-permitted");
      notFound();
    }
    throw error;
  }

  const name = record.title ?? maybe(t, `session.kind.${record.kind}`) ?? record.kind;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-4">
        <Link href={`/cohorts/${record.cohortId}/sessions/${sessionId}`} className="text-sm text-[var(--muted)] hover:underline">
          ← {t("record.back")}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{t("record.title", { name })}</h1>
        <p className="text-sm text-[var(--muted)]">
          {day(record.scheduledDate)} · {t("record.register", record.register)}
        </p>
      </div>

      <div className="space-y-6">
        <RecordForm
          sessionId={sessionId}
          status={record.status}
          transcriptError={record.transcriptError}
          transcript={record.transcript.map((line) => ({ ...line, at: new Date(line.startedAt).toTimeString().slice(0, 5) }))}
          summary={record.summary}
          canPublish={record.canPublish}
          ended={record.ended}
          publishedAt={record.publishedAt ? when(record.publishedAt) : null}
          voicesDeleted={Boolean(record.voiceDeletedAt)}
        />

        {record.notes.trim() ? (
          <Card title={t("record.notes")}>
            <p className="whitespace-pre-wrap text-sm">{record.notes}</p>
          </Card>
        ) : null}

        {record.polls.length ? (
          <Card title={t("record.polls")}>
            <ul className="space-y-3 text-sm">
              {record.polls.map((poll, index) => (
                <li key={index}>
                  <p className="font-medium">{poll.question}</p>
                  <p className="text-[var(--muted)]">{poll.options.map((option, n) => `${option}: ${poll.counts[n]}`).join(" · ")}</p>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {record.chat.length ? (
          <Card title={t("record.chat")}>
            <ul className="space-y-1 text-sm">
              {record.chat.map((line, index) => (
                <li key={index}>
                  <span className="font-medium">{line.name}</span>: {line.body}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
