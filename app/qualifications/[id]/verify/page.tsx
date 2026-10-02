import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { qualifications } from "@/db/schema";
import { pageT, requirePermission, requireTenant, said } from "@/lib/request";
import { verificationOf, type Finding } from "@/lib/qualification-build";
import { AppShell, Card } from "@/components/app-shell";
import { QualificationNav } from "@/components/qualification-nav";
import { BuildForm, VerifyForm } from "./verify-forms";

/**
 * Checking a built qualification and making it live. Roland, 2 October 2026:
 * "I understand the need for user sign-off and verification, but this needs
 * to be a simple process... There can be one 'Verified' button on the
 * qualification page that once selected will publish (make active) the
 * qualification."
 *
 * One page: what each study unit holds, what is worth a look, what holds the
 * whole qualification back, each with a link straight to it, and one button.
 * The button refuses while anything holds it back (his choice: nothing goes
 * live in parts).
 */
export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("course:author");
  const t = await pageT();

  const [qualification] = await withTenant(session.organisationId, (tx) =>
    tx.select({ id: qualifications.id, title: qualifications.title }).from(qualifications).where(eq(qualifications.id, id)),
  );
  if (!qualification) notFound();

  const verification = await said(await verificationOf(session, id));
  const blocking = verification.units.reduce((sum, unit) => sum + unit.blocking.length, 0);
  const toCheck = verification.units.reduce((sum, unit) => sum + unit.toCheck.length, 0);
  const mayPublish = session.permissions.includes("course:publish");

  const finding = (item: Finding, index: number, tone: "danger" | "muted") => (
    <li key={index} className={tone === "danger" ? "text-[var(--danger)]" : "text-[var(--muted)]"}>
      {item.href ? (
        <Link href={item.href} className="underline-offset-2 hover:underline">
          {item.what}
        </Link>
      ) : (
        item.what
      )}
    </li>
  );

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-4">
        <Link href={`/qualifications/${id}`} className="text-sm text-[var(--muted)] underline-offset-2 hover:underline">
          {t("verify.back")}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{t("verify.title")}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{qualification.title}</p>
      </div>

      <QualificationNav qualificationId={id} current="verify" />

      <Card>
        <p className="text-sm font-medium">
          {verification.live
            ? t("verify.isLive")
            : !verification.built
              ? t("verify.notBuilt")
              : verification.ready
                ? t("verify.ready")
                : t("verify.holding", { count: blocking })}
        </p>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">{t("verify.intro")}</p>
        {toCheck > 0 ? <p className="mt-2 text-sm text-[var(--muted)]">{t("verify.toCheck", { count: toCheck })}</p> : null}
        <div className="mt-4 flex flex-wrap items-start gap-6">
          {!verification.live ? <BuildForm qualificationId={id} again={verification.built} /> : null}
          {verification.built && !verification.live && mayPublish ? (
            <VerifyForm qualificationId={id} ready={verification.ready} />
          ) : null}
          <Link href={`/qualifications/${id}/preview`} className="self-center text-sm underline underline-offset-2">
            {t("verify.seeAsLearner")}
          </Link>
        </div>
      </Card>

      <h2 id="assessments" className="mb-3 mt-8 scroll-mt-20 font-semibold">
        {t("verify.units")}
      </h2>
      <div className="space-y-4">
        {verification.units.map((unit) => (
          <Card key={unit.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-medium">
                {unit.courseId ? (
                  <Link href={`/courses/${unit.courseId}`} className="underline-offset-2 hover:underline">
                    {unit.code} {unit.title}
                  </Link>
                ) : (
                  `${unit.code} ${unit.title}`
                )}
              </h3>
              <span className="text-xs text-[var(--muted)]">
                {unit.live
                  ? t("verify.unitLive")
                  : unit.courseId
                    ? unit.steps === 1
                      ? t("verify.unitDraftOne")
                      : t("verify.unitDraft", { steps: unit.steps })
                    : t("verify.unitNotBuilt")}
              </span>
            </div>

            {unit.assessments.length > 0 ? (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-xs text-[var(--muted)]">
                  <tr>
                    <th className="pb-1 font-normal">{t("verify.assessment")}</th>
                    <th className="pb-1 font-normal">{t("verify.kind")}</th>
                    <th className="pb-1 font-normal">{t("verify.papers")}</th>
                  </tr>
                </thead>
                <tbody>
                  {unit.assessments.map((assessment) => (
                    <tr key={assessment.id} className="border-t border-[var(--border)]">
                      <td className="py-1.5">{assessment.title}</td>
                      <td className="py-1.5 text-[var(--muted)]">
                        {assessment.purpose === "summative" ? t("verify.summative") : t("verify.workbook")}
                      </td>
                      <td className="py-1.5 tabular-nums text-[var(--muted)]">
                        {t("verify.answerable", { answerable: assessment.answerable, papers: assessment.papers })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : unit.courseId ? (
              <p className="mt-2 text-sm text-[var(--muted)]">{t("verify.noAssessments")}</p>
            ) : null}

            {unit.blocking.length > 0 ? (
              <div className="mt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--danger)]">{t("verify.blocking")}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                  {unit.blocking.map((item, index) => finding(item, index, "danger"))}
                </ul>
              </div>
            ) : null}
            {unit.toCheck.length > 0 ? (
              <div className="mt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{t("verify.check")}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                  {unit.toCheck.map((item, index) => finding(item, index, "muted"))}
                </ul>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
