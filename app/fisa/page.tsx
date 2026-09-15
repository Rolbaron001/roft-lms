import Link from "next/link";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { qualifications } from "@/db/schema";
import { requireTenant, requireSession } from "@/lib/request";
import { canAny } from "@/lib/rbac";
import { redirect } from "next/navigation";
import { listInstruments } from "@/lib/fisa";
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
        <h1 className="text-xl font-semibold">
          Final integrated summative assessment
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          The paper this provider sets for its own skills programme. Unlike an
          external assessment, you write it and you moderate it — so the
          moderation happens <em>before</em> anybody sits it, and a paper that
          has not been signed off as fit for purpose cannot be used.
        </p>
      </div>

      {waiting.length > 0 ? (
        <div className="mb-6">
          <Card
            title={`${waiting.length} waiting for pre-moderation`}
            description="Nobody can sit these until a moderator signs them off."
          >
            <ul className="space-y-1">
              {waiting.map((row) => (
                <li key={row.id} className="text-sm">
                  <Link
                    href={`/fisa/${row.id}`}
                    className="underline underline-offset-2"
                  >
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
        <Card
          title="Papers"
          description={`${usable.length} signed off and usable.`}
        >
          {instruments.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              None yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="py-2 pr-4 font-medium">Paper</th>
                    <th className="py-2 pr-4 font-medium">Programme</th>
                    <th className="py-2 pr-4 font-medium">Version</th>
                    <th className="py-2 font-medium">State</th>
                  </tr>
                </thead>
                <tbody>
                  {instruments.map((row) => (
                    <tr key={row.id} className="border-b border-[var(--border)]">
                      <td className="py-2 pr-4">
                        <Link
                          href={`/fisa/${row.id}`}
                          className="underline underline-offset-2"
                        >
                          {row.title}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-[var(--muted)]">
                        {row.programme}
                        {row.saqaId ? ` · ${row.saqaId}` : ""}
                      </td>
                      <td className="py-2 pr-4 tabular-nums">{row.version}</td>
                      <td className="py-2">
                        {row.status === "approved" ? (
                          <span style={{ color: "var(--success)" }}>
                            Fit for purpose
                          </span>
                        ) : row.status === "in_moderation" ? (
                          "With the moderator"
                        ) : row.status === "retired" ? (
                          <span className="text-[var(--muted)]">Withdrawn</span>
                        ) : (
                          "Being written"
                        )}
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
        <Card
          title="Set a new one"
          description="Against a skills programme. A full or part qualification is assessed externally."
        >
          <CreateForm programmes={programmes} />
        </Card>
      ) : null}
    </AppShell>
  );
}
