import Link from "next/link";
import { notFound } from "next/navigation";
import { pageLocale, requireCapability, requireSession } from "@/lib/request";
import { maybe } from "@/lib/i18n/maybe";
import { coachLearnerView, type CoachRecord } from "@/lib/coach";
import { dateInZone } from "@/lib/timezone";
import { AppShell, Card } from "@/components/app-shell";
import { CoachForms } from "./coach-forms";

/**
 * One learner, as their workplace coach sees them (job sheet D52 (7) to (10)).
 *
 * Their progress, what the coach has recorded about them, and the forms to
 * record more: an observation checklist drafted from the logbook's work
 * activities, a witness testimony, readiness feedback, and a message to the
 * learner's facilitator and assessor. The learner and their staff read the
 * same page without the forms.
 */
export default async function CoachLearnerPage({ params }: { params: Promise<{ learnerId: string }> }) {
  const tenant = await requireCapability("workplace_experience");
  const session = await requireSession();
  const { learnerId } = await params;
  const view = await coachLearnerView(session, learnerId);
  if (!view) notFound();
  const { t, day } = await pageLocale();
  const today = dateInZone(new Date(), tenant.timezone);

  return (
    <AppShell tenant={tenant} session={session}>
      <p className="mb-2 text-sm">
        <Link href="/workplace" className="text-[var(--muted)] underline-offset-2 hover:underline">
          {t("work.title")}
        </Link>
      </p>
      <h1 className="mb-6 text-xl font-semibold">{view.name}</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold">{t("coachView.logbooks")}</h2>
          {view.logbooks.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("coachView.noLogbooks")}</p>
          ) : (
            <ul className="space-y-3">
              {view.logbooks.map((book) => (
                <li key={book.id}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <Link href={`/workplace/${book.id}`} className="font-medium underline-offset-2 hover:underline">
                      {book.module}
                    </Link>
                    <span className="shrink-0 text-xs text-[var(--muted)]">
                      {maybe(t, `work.status.${book.status}`) ?? book.status}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-[var(--border)]">
                    <div
                      className="h-1.5 rounded-full bg-[var(--brand-primary)]"
                      style={{ width: `${book.total ? Math.round((book.done / book.total) * 100) : 0}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">{t("coachView.done", { done: book.done, total: book.total })}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-semibold">{t("coachView.courses")}</h2>
          {view.courses.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("coachView.noCourses")}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {view.courses.map((course, index) => (
                <li key={index} className="flex justify-between gap-3">
                  <span>{course.title}</span>
                  <span className="text-xs text-[var(--muted)]">{maybe(t, `enrolment.status.${course.status}`) ?? course.status.replaceAll("_", " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {view.isCoach ? (
        <div className="mt-6">
          <Card>
            <h2 className="mb-3 text-sm font-semibold">{t("coachView.record")}</h2>
            <CoachForms learnerId={learnerId} today={today} activities={view.activities} />
          </Card>
        </div>
      ) : null}

      <div className="mt-6">
        <Card>
          <h2 className="mb-3 text-sm font-semibold">{t("coachView.records")}</h2>
          {view.records.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("coachView.noRecords")}</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {view.records.map((record) => (
                <Record key={record.id} record={record} t={t} day={day} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

type Translate = Awaited<ReturnType<typeof pageLocale>>["t"];

function Record({ record, t, day }: { record: CoachRecord; t: Translate; day: (value: Date | string | null | undefined) => string }) {
  const details = (record.details ?? {}) as {
    items?: { label: string; observed: boolean; comment?: string }[];
    ratings?: Record<string, number>;
    recommendation?: string;
  };
  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          {t(`coachView.kind.${record.kind}`)}: {record.title}
        </p>
        <p className="text-xs text-[var(--muted)]">
          {record.signedAt
            ? t("coachView.signed", { coach: record.coach, date: day(record.signedAt) })
            : t("coachView.sent", { coach: record.coach, date: day(record.createdAt) })}
        </p>
      </div>
      {record.observedOn ? <p className="text-xs text-[var(--muted)]">{t("coachView.observedOn", { date: day(record.observedOn) })}</p> : null}
      {record.witnessName ? (
        <p className="text-xs text-[var(--muted)]">
          {record.witnessRole ? `${record.witnessName}, ${record.witnessRole}` : record.witnessName}
        </p>
      ) : null}
      {details.items ? (
        <ul className="mt-2 space-y-1">
          {details.items.map((item, index) => (
            <li key={index}>
              <span style={{ color: item.observed ? "var(--success)" : "var(--muted)" }}>{item.observed ? "✓" : "–"}</span> {item.label}
              {item.comment ? <span className="text-[var(--muted)]">: {item.comment}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {details.ratings ? (
        <div className="mt-2">
          <p>
            {t("coach.readiness.overall")}: <strong>{maybe(t, `coach.recommendation.${details.recommendation}`) ?? details.recommendation}</strong>
          </p>
          <ul className="mt-1 grid gap-x-6 sm:grid-cols-2">
            {Object.entries(details.ratings).map(([dimension, value]) => (
              <li key={dimension} className="flex justify-between gap-3">
                <span>{maybe(t, `coach.dimension.${dimension}`) ?? dimension}</span>
                <span className="text-[var(--muted)]">{maybe(t, `coach.rating.${value}`) ?? value}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {record.body ? <p className="mt-2 whitespace-pre-wrap">{record.body}</p> : null}
    </li>
  );
}
