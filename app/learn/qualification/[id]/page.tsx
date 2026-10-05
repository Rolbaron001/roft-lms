import Link from "next/link";
import { notFound } from "next/navigation";
import { localeFor, requireSession, requireTenant } from "@/lib/request";
import { translator } from "@/lib/i18n";
import { learnerQualifications, type LearnerUnit } from "@/lib/learner-qualification";
import { AppShell } from "@/components/app-shell";

/**
 * A learner's qualification: an introduction, then every study unit they
 * must complete, each saying whether it is open and, if not, what it waits
 * for (Roland, 5 October 2026). Always visible to an enrolled learner, so
 * they can see what they are signed up for before any of it is released.
 */
export default async function LearnerQualificationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();
  const t = translator(localeFor(tenant, session));
  const qualification = (await learnerQualifications(session)).find((one) => one.id === id);
  if (!qualification) notFound();

  const completed = qualification.units.filter((unit) => unit.state === "completed").length;
  const facts = [
    qualification.saqaId ? t("learnQual.saqa", { id: qualification.saqaId }) : null,
    qualification.nqfLevel ? t("learnQual.nqf", { level: qualification.nqfLevel }) : null,
    qualification.totalCredits ? t("learnQual.credits", { credits: qualification.totalCredits }) : null,
  ].filter(Boolean);

  return (
    <AppShell tenant={tenant} session={session}>
      <section className="mb-6 grid gap-6 rounded-2xl p-7 text-white md:grid-cols-3" style={{ background: "var(--brand-primary)" }}>
        <div className="md:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-85">{t("learnUnit.qualification")}</p>
          <h1 className="mt-2 text-2xl font-bold leading-tight">{qualification.title}</h1>
          {facts.length > 0 ? <p className="mt-2 text-sm opacity-90">{facts.join(" · ")}</p> : null}
          {qualification.description ? <p className="mt-3 leading-relaxed opacity-95">{qualification.description}</p> : null}
        </div>
        <div className="rounded-xl bg-white/10 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-85">{t("learnQual.cohort")}</p>
          <p className="mt-2 text-lg font-semibold">{qualification.cohortName ?? t("learnQual.noCohort")}</p>
          <div className="mt-4 h-2 rounded-full bg-white/25">
            <div className="h-2 rounded-full bg-white" style={{ width: `${qualification.units.length ? Math.round((completed / qualification.units.length) * 100) : 0}%` }} />
          </div>
          <p className="mt-2 text-sm opacity-90">{t("learnQual.unitsDone", { done: completed, total: qualification.units.length })}</p>
        </div>
      </section>

      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{t("learnQual.units")}</h2>
        <span className="text-sm text-[var(--muted)]">{t("learnQual.unitsHint")}</span>
      </div>
      <ol className="space-y-3">
        {qualification.units.map((unit) => (
          <li key={unit.id}>
            <UnitRow unit={unit} t={t} />
          </li>
        ))}
      </ol>
    </AppShell>
  );
}

function UnitRow({ unit, t }: { unit: LearnerUnit; t: ReturnType<typeof translator> }) {
  const href = unit.enrolmentId ? `/learn/${unit.enrolmentId}` : `/learn/unit/${unit.id}`;
  const active = unit.state === "in_progress" || unit.state === "open";
  const status =
    unit.state === "completed"
      ? t("learnQual.state.completed")
      : unit.state === "in_progress"
        ? t("learnQual.state.inProgress", { done: unit.done, total: unit.total })
        : unit.state === "open"
          ? t("learnQual.state.open")
          : unit.state === "waiting_cohort"
            ? t("learnQual.state.waitingCohort")
            : unit.state === "waiting_release"
              ? (unit.waiting ?? t("learnQual.state.waitingRelease"))
              : t("learnQual.state.notEnrolled");
  return (
    <Link
      href={href}
      className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-[var(--surface)] px-5 py-4 transition hover:border-[var(--brand-accent)] ${active ? "border-2 border-[var(--brand-accent)]" : "border-[var(--border)]"}`}
    >
      <div className="flex items-center gap-4">
        <span
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${active ? "text-white" : "bg-[var(--background)]"}`}
          style={active ? { background: "var(--brand-primary)" } : undefined}
        >
          {unit.code}
        </span>
        <div className="min-w-0">
          <p className="font-semibold">{unit.title}</p>
          <p className="text-sm text-[var(--muted)]">{status}</p>
        </div>
      </div>
      <span
        className={`rounded-md px-4 py-2 text-sm font-medium ${active ? "text-white" : "border border-[var(--border)]"}`}
        style={active ? { background: "var(--brand-primary)" } : undefined}
      >
        {active ? t("learnQual.continue") : unit.state === "completed" && unit.enrolmentId ? t("learnQual.openAgain") : t("learnQual.look")}
      </span>
    </Link>
  );
}
