import Link from "next/link";
import { notFound } from "next/navigation";
import { pageLocale, requirePermission, requireTenant } from "@/lib/request";
import { FacilitationPlanError, facilitationPlan } from "@/lib/facilitation-plan";
import { AppShell } from "@/components/app-shell";
import { PrintButton } from "@/components/print-button";
import { maybe } from "@/lib/i18n/maybe";

/**
 * A class session's facilitation plan (job sheet D20), printed or saved as
 * PDF for the cohort file. Laid out as Curiosa's own plan is: programme and
 * date, modules covered, agenda, apologies, learners in attendance,
 * resources, next lecture and proceedings.
 */
export default async function FacilitationPlanPage({ params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const { id, sessionId } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("enrolment:read_all");
  const { t, day } = await pageLocale();

  let plan;
  try {
    plan = await facilitationPlan(session, sessionId);
  } catch (error) {
    if (error instanceof FacilitationPlanError) notFound();
    throw error;
  }
  if (plan.cohort.id !== id) notFound();

  const kind = (value: string) => maybe(t, `session.kind.${value}`) ?? value;
  const sessionName = (row: { title: string | null; kind: string; sequence: number | null }) =>
    row.title || [kind(row.kind), row.sequence ? String(row.sequence) : null].filter(Boolean).join(" ");
  const when = (row: { date: string; startTime: string | null; endTime?: string | null }) =>
    `${day(row.date)}${row.startTime ? `, ${row.startTime}${row.endTime ? `–${row.endTime}` : ""}` : ""}`;
  const cell = "border border-[var(--border)] px-2 py-1.5 text-left align-top";
  const text = (value: string | null) =>
    value ? <p className="whitespace-pre-line">{value}</p> : <p className="text-[var(--muted)]">{t("plan.toWrite")}</p>;
  const list = (names: string[]) =>
    names.length ? <p>{names.join(", ")}</p> : <p className="text-[var(--muted)]">{t("plan.none")}</p>;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/cohorts/${id}/sessions/${sessionId}`} className="text-sm text-[var(--muted)] hover:underline">
          ← {sessionName(plan.session)}
        </Link>
        <PrintButton />
      </div>

      <article className="space-y-6 text-sm">
        <h1 className="text-xl font-semibold">
          {t("plan.heading")}: {sessionName(plan.session)}
        </h1>

        <table className="w-full border-collapse">
          <tbody>
            <tr><th className={cell}>{t("plan.programme")}</th><td className={cell}>{plan.programme}{plan.saqaId ? ` · SAQA ${plan.saqaId}` : ""}</td></tr>
            <tr><th className={cell}>{t("plan.cohort")}</th><td className={cell}>{plan.cohort.name}</td></tr>
            <tr><th className={cell}>{t("plan.date")}</th><td className={cell}>{when(plan.session)}</td></tr>
            <tr><th className={cell}>{t("plan.session")}</th><td className={cell}>{kind(plan.session.kind)}{plan.session.sequence ? ` ${plan.session.sequence}` : ""}</td></tr>
            <tr><th className={cell}>{t("plan.facilitator")}</th><td className={cell}>{plan.facilitator ?? "—"}</td></tr>
            <tr><th className={cell}>{t("plan.venue")}</th><td className={cell}>{plan.session.venue ?? plan.session.meetingUrl ?? "—"}</td></tr>
            <tr><th className={cell}>{t("plan.unit")}</th><td className={cell}>{plan.unit ? `${plan.unit.code} ${plan.unit.title}` : "—"}</td></tr>
            <tr>
              <th className={cell}>{t("plan.modules")}</th>
              <td className={cell}>{plan.modules.length ? plan.modules.map((module) => `${module.code} ${module.title}`).join("; ") : "—"}</td>
            </tr>
            <tr>
              <th className={cell}>{t("plan.workbooks")}</th>
              <td className={cell}>
                {plan.workbooks.length ? plan.workbooks.map((row) => `${row.title} (${t(`plan.workbook.${row.role as "handout"}`)})`).join("; ") : "—"}
              </td>
            </tr>
          </tbody>
        </table>

        <section>
          <h2 className="mb-1 font-semibold">{t("plan.agenda")}</h2>
          {text(plan.agenda)}
        </section>

        <section>
          <h2 className="mb-1 font-semibold">{t("plan.present")} ({plan.present.length})</h2>
          {list(plan.present)}
        </section>

        <section>
          <h2 className="mb-1 font-semibold">{t("plan.apologies")}</h2>
          {plan.apologies.length ? (
            <ul className="list-disc pl-5">
              {plan.apologies.map((row) => (
                <li key={row.name}>{row.name}{row.note ? `: ${row.note}` : ""}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[var(--muted)]">{t("plan.none")}</p>
          )}
        </section>

        {plan.absent.length ? (
          <section>
            <h2 className="mb-1 font-semibold">{t("plan.absent")}</h2>
            {list(plan.absent)}
          </section>
        ) : null}

        {plan.unmarked.length ? (
          <section className="print:hidden">
            <h2 className="mb-1 font-semibold">{t("plan.unmarked")}</h2>
            {list(plan.unmarked)}
          </section>
        ) : null}

        <section>
          <h2 className="mb-1 font-semibold">{t("plan.resources")}</h2>
          {text(plan.resources)}
        </section>

        <section>
          <h2 className="mb-1 font-semibold">{t("plan.next")}</h2>
          <p>{plan.next ? `${when(plan.next)} · ${sessionName(plan.next)}` : t("plan.none")}</p>
        </section>

        <section>
          <h2 className="mb-1 font-semibold">{t("plan.proceedings")}</h2>
          {text(plan.proceedings)}
        </section>

        <p className="text-xs text-[var(--muted)]">{t("plan.fromRecord")}</p>
      </article>
    </AppShell>
  );
}
