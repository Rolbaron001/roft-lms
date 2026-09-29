import { pageT, requireCapability, requirePermission, said } from "@/lib/request";
import type { MessageKey } from "@/lib/i18n";
import { buildNlrdDataset, buildWspAtr } from "@/lib/statutory";
import { AppShell, Card } from "@/components/app-shell";

export default async function StatutoryPage() {
  const tenant = await requireCapability("statutory_reporting");
  const session = await requirePermission("report:statutory");
  const t = await pageT();

  const [dataset, wspAtr] = await Promise.all([
    buildNlrdDataset(session),
    buildWspAtr(session),
  ]);

  // Only the problems are read; the dataset itself goes to the regulator as it is.
  const issues = await said(dataset.issues);
  const blocking = issues.filter((i) => i.severity === "blocking");
  const warnings = issues.filter((i) => i.severity === "warning");

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("statutory.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("statutory.intro")}</p>
      </div>

      <section
        className="rounded-lg border-2 bg-[var(--surface)] p-6"
        style={{
          borderColor: dataset.submittable
            ? "var(--success)"
            : "var(--danger)",
        }}
      >
        <h2
          className="font-semibold"
          style={{
            color: dataset.submittable ? "var(--success)" : "var(--danger)",
          }}
        >
          {dataset.submittable
            ? t("statutory.ready")
            : blocking.length === 1
              ? t("statutory.problemOne")
              : t("statutory.problems", { count: blocking.length })}
        </h2>

        <dl className="mt-4 grid gap-3 sm:grid-cols-4">
          {[
            [t("statutory.people"), dataset.people.length],
            [t("statutory.enrolments"), dataset.enrolments.length],
            [t("statutory.achievements"), dataset.achievements.length],
            [t("statutory.warnings"), warnings.length],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">
                {label}
              </dt>
              <dd className="text-xl font-semibold">{value}</dd>
            </div>
          ))}
        </dl>

        {dataset.submittable ? (
          <div className="mt-5 flex flex-wrap gap-2">
            {(
              [
                ["person-record-27", "statutory.file.person"],
                ["enrolment-record-28", "statutory.file.enrolment"],
                ["achievement-record-29", "statutory.file.achievement"],
                ["provider-record-30", "statutory.file.provider"],
              ] as [string, MessageKey][]
            ).map(([file, key]) => (
              <a
                key={file}
                href={`/statutory/export/${file}`}
                download
                className="rounded-md px-3 py-1.5 text-sm font-semibold text-white"
                style={{ background: "var(--brand-primary)" }}
              >
                {t(key)}
              </a>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-[var(--muted)]">{t("statutory.locked")}</p>
        )}
      </section>

      {blocking.length > 0 ? (
        <section className="mt-6 rounded-lg border border-[var(--danger)]/30 bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--danger)]">
            {t("statutory.mustFix")}
          </h2>
          <ul className="mt-4 space-y-2">
            {blocking.map((issue, index) => (
              <li
                key={index}
                className="rounded-md border border-[var(--border)] px-4 py-3 text-sm"
              >
                <p className="font-medium">{issue.subject}</p>
                <p className="mt-0.5 text-[var(--muted)]">
                  <span className="capitalize">{issue.entity}</span> ·{" "}
                  {issue.field}: {issue.message}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {warnings.length > 0 ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            {t("statutory.worthFixing", { count: warnings.length })}
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t("statutory.worthFixingNote")}</p>
          <ul className="mt-4 space-y-1.5">
            {warnings.slice(0, 25).map((issue, index) => (
              <li key={index} className="text-sm">
                <span className="font-medium">{issue.subject}</span>{" "}
                <span className="text-[var(--muted)]">· {issue.field}</span>
              </li>
            ))}
            {warnings.length > 25 ? (
              <li className="text-sm text-[var(--muted)]">
                {t("statutory.more", { count: warnings.length - 25 })}
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <div className="mt-6">
        <Card title={t("statutory.wsp")} description={t("statutory.wspNote")}>
          <div className="mb-4">
            {/* A file download, not a navigation: <Link> would route this
                client-side and no file would ever be saved. */}
            <a
              href="/statutory/export/wsp-atr"
              download
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium"
            >
              {t("statutory.export")}
            </a>
          </div>

          {wspAtr.missingOfoCodes.length > 0 ? (
            <p className="mb-4 rounded-md border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/10 px-4 py-3 text-sm">
              {wspAtr.missingOfoCodes.length === 1
                ? t("statutory.noOfoOne", { names: [...new Set(wspAtr.missingOfoCodes)].join(", ") })
                : t("statutory.noOfo", {
                    count: wspAtr.missingOfoCodes.length,
                    names: [...new Set(wspAtr.missingOfoCodes)].join(", "),
                  })}
            </p>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full min-w-lg text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="pb-2 pr-4 font-medium">{t("statutory.ofo")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("statutory.role")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("statutory.headcount")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("statutory.trained")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("statutory.completions")}</th>
                  <th className="pb-2 font-medium">{t("statutory.certificates")}</th>
                </tr>
              </thead>
              <tbody>
                {wspAtr.rows.map((row, index) => (
                  <tr
                    key={`${row.ofoCode ?? row.jobTitle}-${index}`}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="py-2.5 pr-4 font-mono text-xs">
                      {row.ofoCode ?? "—"}
                    </td>
                    <td className="py-2.5 pr-4">{row.jobTitle ?? t("statutory.unknownRole")}</td>
                    <td className="py-2.5 pr-4">{row.headcount}</td>
                    <td className="py-2.5 pr-4">{row.trainedCount}</td>
                    <td className="py-2.5 pr-4">{row.completions}</td>
                    <td className="py-2.5">{row.certificates}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <p className="mt-6 text-xs text-[var(--muted)]">{t("statutory.mapping")}</p>
    </AppShell>
  );
}
