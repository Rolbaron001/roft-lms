import Link from "next/link";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { qualifications } from "@/db/schema";
import { pageT, requireTenant, requireSession } from "@/lib/request";
import { canAny } from "@/lib/rbac";
import { redirect } from "next/navigation";
import { listInstruments } from "@/lib/fisa";
import { maybe } from "@/lib/i18n/maybe";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { CreateForm } from "./fisa-forms";

/**
 * Every FISA this provider sets, and their state.
 *
 * A FISA is the final integrated summative assessment for a skills programme,
 * and unlike an EISA the provider writes and moderates it themselves. That is
 * why the status matters more here than on any other list in the platform: a
 * paper that has not been pre-moderated cannot be sat at all.
 */
export default async function FisaPage() {
  const tenant = await requireTenant();
  const session = await requireSession();

  if (
    !canAny(session, [
      "assessment:author",
      "assessment:moderate",
      "assessment:assess",
    ])
  ) {
    redirect("/not-permitted");
  }
  const t = await pageT();

  const instruments = await listInstruments(session);
  const mayAuthor = session.permissions.includes("assessment:author");

  // Only skills programmes: a full or part qualification is assessed by the
  // Assessment Quality Partner, so the provider does not set that paper.
  const programmes = mayAuthor
    ? await withTenant(session.organisationId, (tx) =>
        tx
          .select({
            id: qualifications.id,
            title: qualifications.title,
            saqaId: qualifications.saqaId,
          })
          .from(qualifications)
          .where(eq(qualifications.kind, "skills_programme")),
      )
    : [];

  const waiting = instruments.filter((row) => row.status === "in_moderation");
  const usable = instruments.filter((row) => row.status === "approved");

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("fisa.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("fisa.intro")}</p>
      </div>

      {waiting.length > 0 ? (
        <div className="mb-6">
          <Card
            title={t("fisa.waiting", { count: waiting.length })}
            description={t("fisa.waitingIntro")}
          >
            <ul className="space-y-1">
              {waiting.map((row) => (
                <li key={row.id} className="text-sm">
                  <Link href={`/fisa/${row.id}`} className="underline underline-offset-2">
                    {row.title}
                  </Link>
                  <span className="text-[var(--muted)]"> · {row.programme}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      <div className="mb-6">
        <Card title={t("fisa.papers")} description={t("fisa.usable", { count: usable.length })}>
          {instruments.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("fisa.noneYet")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="py-2 pr-4 font-medium">{t("fisa.paper")}</th>
                    <th className="py-2 pr-4 font-medium">{t("fisa.programme")}</th>
                    <th className="py-2 pr-4 font-medium">{t("fisa.version")}</th>
                    <th className="py-2 font-medium">{t("fisa.state")}</th>
                  </tr>
                </thead>
                <tbody>
                  {instruments.map((row) => (
                    <tr key={row.id} className="border-b border-[var(--border)]">
                      <td className="py-2 pr-4">
                        <Link href={`/fisa/${row.id}`} className="underline underline-offset-2">
                          {row.title}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-[var(--muted)]">
                        {row.programme}
                        {row.saqaId ? ` · ${row.saqaId}` : ""}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">{row.version}</td>
                      <td
                        className={`py-2 ${row.status === "retired" ? "text-[var(--muted)]" : ""}`}
                        style={row.status === "approved" ? { color: "var(--success)" } : undefined}
                      >
                        {maybe(t, `fisa.state.${row.status}`) ?? row.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {mayAuthor ? (
        <Card title={t("fisa.setNew")} description={t("fisa.setNewIntro")}>
          <CreateForm programmes={programmes} />
        </Card>
      ) : null}
    </AppShell>
  );
}
