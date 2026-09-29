import Link from "next/link";
import { redirect } from "next/navigation";
import { pageT, requireSession, requireTenant } from "@/lib/request";
import { canAny } from "@/lib/rbac";
import { listTemplates } from "@/lib/document-templates";
import { DOCUMENT_KINDS } from "@/lib/document-fields";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { TemplateForm } from "../settings/template-form";

/**
 * The documents this provider produces, and how each one reads.
 *
 * Roland, 15 September: a proper place for the templates "held inside the
 * system, but exported to clients, learners, other role-players".
 *
 * They were already editable, inside Settings, underneath the branding and the
 * clock. That is not where anybody looks for the layout of a Statement of
 * Results, and being reachable is not the same as being findable - which was
 * the substance of the concern.
 *
 * Its own screen, so each document can say what it is for, who receives it and
 * whether this provider has written their own version yet. The editor itself is
 * the same component Settings used, because the job has not changed - only
 * where somebody goes to do it.
 */
export default async function TemplatesPage() {
  const tenant = await requireTenant();
  const session = await requireSession();

  if (!canAny(session, ["tenant:manage_branding", "tenant:manage_settings"])) {
    redirect("/not-permitted");
  }

  const templates = await listTemplates(session);
  const t = await pageT();

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("templates.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          {t("templates.intro", { name: tenant.displayName })}
        </p>
      </div>

      {/* What exists, and whether this provider has taken it over yet. */}
      <div className="mb-6">
        <Card title={t("templates.produces")} description={t("templates.producesNote")}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="py-2 pr-4 font-medium">{t("templates.document")}</th>
                  <th className="py-2 pr-4 font-medium">{t("templates.who")}</th>
                  <th className="py-2 font-medium">{t("templates.layout")}</th>
                </tr>
              </thead>
              <tbody>
                {DOCUMENT_KINDS.map((kind) => {
                  const own = templates.find(
                    (row) => row.kind === kind && row.status === "active",
                  );

                  return (
                    <tr key={kind} className="border-b border-[var(--border)]">
                      <td className="py-2 pr-4">
                        <span className="font-medium">{t(`tmpl.kind.${kind}`)}</span>
                        <span className="block text-xs text-[var(--muted)]">{t(`tmpl.note.${kind}`)}</span>
                      </td>
                      <td className="py-2 pr-4 text-[var(--muted)]">{t(`templates.goesTo.${kind}`)}</td>
                      <td className="py-2">
                        {own ? (
                          <span style={{ color: "var(--success)" }}>{t("templates.yours")}</span>
                        ) : (
                          <span className="text-[var(--muted)]">{t("templates.platforms")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="mb-6">
        <Card title={t("templates.write")} description={t("templates.writeNote")}>
          <TemplateForm templates={templates} />
        </Card>
      </div>

      {/*
        The documents a provider supplies rather than lays out. Named here
        because somebody looking for "templates" will look here for all of
        them, and finding only half is worse than a signpost.
      */}
      <Card title={t("templates.supplied")} description={t("templates.suppliedNote")}>
        <ul className="space-y-2 text-sm">
          <li>
            <Link href="/records" className="underline underline-offset-2">
              {t("templates.policies")}
            </Link>
            <span className="text-[var(--muted)]">: {t("templates.policiesNote")}</span>
          </li>
          <li>
            <Link href="/fisa" className="underline underline-offset-2">
              {t("templates.fisa")}
            </Link>
            <span className="text-[var(--muted)]">: {t("templates.fisaNote")}</span>
          </li>
          <li>
            <Link href="/qualifications" className="underline underline-offset-2">
              {t("templates.curriculum")}
            </Link>
            <span className="text-[var(--muted)]">: {t("templates.curriculumNote")}</span>
          </li>
        </ul>
      </Card>
    </AppShell>
  );
}
