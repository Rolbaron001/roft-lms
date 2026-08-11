import { requirePermission, requireTenant } from "@/lib/request";
import { buildNlrdDataset, buildWspAtr } from "@/lib/statutory";
import { AppShell, Card } from "@/components/app-shell";

export default async function StatutoryPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("report:statutory");

  const [dataset, wspAtr] = await Promise.all([
    buildNlrdDataset(session),
    buildWspAtr(session),
  ]);

  const blocking = dataset.issues.filter((i) => i.severity === "blocking");
  const warnings = dataset.issues.filter((i) => i.severity === "warning");

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Statutory reporting</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          The SAQA National Learners&rsquo; Records Database return, and the
          Workplace Skills Plan and Annual Training Report. Everything is
          checked here before it goes anywhere, because a return rejected for a
          mistyped identity number costs a full cycle.
        </p>
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
            ? "Ready to submit"
            : `${blocking.length} ${blocking.length === 1 ? "problem" : "problems"} to fix first`}
        </h2>

        <dl className="mt-4 grid gap-3 sm:grid-cols-4">
          {[
            ["People", dataset.people.length],
            ["Enrolments", dataset.enrolments.length],
            ["Achievements", dataset.achievements.length],
            ["Warnings", warnings.length],
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
            {[
              ["person-record-27", "Person Record (27)"],
              ["enrolment-record-28", "Enrolment Record (28)"],
              ["achievement-record-29", "Achievement Record (29)"],
              ["provider-record-30", "Provider Record (30)"],
            ].map(([file, label]) => (
              <a
                key={file}
                href={`/statutory/export/${file}`}
                download
                className="rounded-md px-3 py-1.5 text-sm font-semibold text-white"
                style={{ background: "var(--brand-primary)" }}
              >
                {label}
              </a>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-[var(--muted)]">
            The files stay locked until the blocking problems below are fixed.
            Submitting a return that will be rejected wastes a cycle for every
            learner in it.
          </p>
        )}
      </section>

      {blocking.length > 0 ? (
        <section className="mt-6 rounded-lg border border-[var(--danger)]/30 bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--danger)]">
            Must be fixed before submitting
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
                  {issue.field} — {issue.message}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {warnings.length > 0 ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Worth fixing ({warnings.length})
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            These do not stop the return, but the NLRD flags incomplete
            demographic data and a SETA may query it.
          </p>
          <ul className="mt-4 space-y-1.5">
            {warnings.slice(0, 25).map((issue, index) => (
              <li key={index} className="text-sm">
                <span className="font-medium">{issue.subject}</span>{" "}
                <span className="text-[var(--muted)]">
                  — {issue.field}
                </span>
              </li>
            ))}
            {warnings.length > 25 ? (
              <li className="text-sm text-[var(--muted)]">
                and {warnings.length - 25} more.
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <div className="mt-6">
        <Card
          title="Workplace Skills Plan and Annual Training Report"
          description="Training activity by occupation, as a SETA return is organised."
        >
          <div className="mb-4">
            {/* A file download, not a navigation: <Link> would route this
                client-side and no file would ever be saved. */}
            <a
              href="/statutory/export/wsp-atr"
              download
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium"
            >
              Export CSV
            </a>
          </div>

          {wspAtr.missingOfoCodes.length > 0 ? (
            <p className="mb-4 rounded-md border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/10 px-4 py-3 text-sm">
              {wspAtr.missingOfoCodes.length}{" "}
              {wspAtr.missingOfoCodes.length === 1 ? "person has" : "people have"}{" "}
              no OFO code:{" "}
              {[...new Set(wspAtr.missingOfoCodes)].join(", ")}. They are still
              counted, but a SETA return groups by occupation.
            </p>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full min-w-lg text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="pb-2 pr-4 font-medium">OFO code</th>
                  <th className="pb-2 pr-4 font-medium">Role</th>
                  <th className="pb-2 pr-4 font-medium">Headcount</th>
                  <th className="pb-2 pr-4 font-medium">Trained</th>
                  <th className="pb-2 pr-4 font-medium">Completions</th>
                  <th className="pb-2 font-medium">Certificates</th>
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
                    <td className="py-2.5 pr-4">{row.jobTitle ?? "Unknown"}</td>
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

      <p className="mt-6 text-xs text-[var(--muted)]">
        Field mapping follows the accreditation framework (Person 27, Enrolment
        28, Achievement 29, Provider 30). Confirm the exact Edu.Dex file layout
        against the current SAQA specification before a live submission.
      </p>
    </AppShell>
  );
}
