import Link from "next/link";
import { notFound } from "next/navigation";
import { pageLocale, requirePermission, requireTenant } from "@/lib/request";
import { CohortFileError, cohortFileView, type FolderItem } from "@/lib/cohort-file";
import { AppShell, Card } from "@/components/app-shell";
import { Guide } from "@/components/ui";
import { CohortNav } from "@/components/cohort-nav";
import { maybe } from "@/lib/i18n/maybe";
import { FileUpload, RemoveFile } from "./file-forms";

/**
 * The cohort's file (job sheet D20), organised as the provider's own cohort
 * folder is: one section per folder, each showing what is held, what is
 * missing, and where it is worked on. Heidi's example folder of 8 October
 * 2026 set the folders and their order.
 */
export default async function CohortFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("enrolment:read_all");
  const { t, day } = await pageLocale();
  const canManage = session.permissions.includes("enrolment:manage");

  let view;
  try {
    view = await cohortFileView(session, id);
  } catch (error) {
    if (error instanceof CohortFileError) notFound();
    throw error;
  }

  // The view speaks in codes so that the words stay in the phrase catalogue.
  const dated = (label: string) => label.replace(/^(\d{4}-\d{2}-\d{2})/, (date) => day(date, { short: true }));
  const note = (text?: string) => {
    if (!text) return "";
    const [code, a, b] = text.split(":");
    if (code === "register") return t("cohortFile.note.register", { marked: a.split("/")[0], expected: a.split("/")[1] });
    if (code === "documents") return t("cohortFile.note.documents", { count: a });
    if (code === "evidence") return t("cohortFile.note.evidence", { count: a, learners: b });
    if (code === "logbooks") return t("cohortFile.note.logbooks", { count: a, signed: b });
    if (code === "generated") return t("cohortFile.note.generated");
    return maybe(t, `enrolNotify.status.${text}`) ?? text;
  };
  const missing = (text: string) => {
    const [code, ...rest] = text.split(":");
    const detail = dated(rest.join(":"));
    switch (code) {
      case "doc":
        return t("cohortFile.missing.doc", { kind: maybe(t, `docKind.${detail}`) ?? detail });
      case "guide":
        return t("cohortFile.missing.guide", { unit: detail });
      case "leisa":
        return t("cohortFile.missing.leisa");
      case "inductionSession":
        return t("cohortFile.missing.inductionSession");
      case "inductionPack":
        return t("cohortFile.missing.inductionPack");
      case "nodocs":
        return t("cohortFile.missing.nodocs", { learner: detail });
      case "register":
        return t("cohortFile.missing.register", { session: detail });
      case "plan":
        return t("cohortFile.missing.plan", { session: detail });
      default:
        return text;
    }
  };
  const label = (item: FolderItem) => (item.label.startsWith("feedback:") ? t("cohortFile.feedbackRequests", { count: item.label.split(":")[1] }) : dated(item.label));

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-4">
        <Link href={`/cohorts/${id}`} className="text-sm text-[var(--muted)] hover:underline">
          ← {view.cohort.name}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{t("cohortFile.title", { cohort: view.cohort.name })}</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">{t("cohortFile.intro")}</p>
        <p className="mt-3">
          <a
            href={`/api/cohort-files/download/${id}`}
            className="inline-flex items-center rounded-md px-4 py-2 text-sm font-semibold text-white"
            style={{ background: "var(--brand-primary)" }}
          >
            {t("cohortFile.download")}
          </a>
          <span className="ml-3 text-xs text-[var(--muted)]">{t("cohortFile.downloadNote")}</span>
        </p>
      </div>

      <CohortNav cohortId={id} current="overview" sections />

      <div className="space-y-6">
        {view.folders.map((folder) => (
          <Card
            key={folder.key}
            section={{ id: folder.key, label: t(`cohortFile.folder.${folder.key}`) }}
            title={`${t(`cohortFile.folder.${folder.key}`)} (${folder.count})`}
            description={t(`cohortFile.about.${folder.key}`)}
          >
            {folder.items.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{t("cohortFile.empty")}</p>
            ) : (
              <ul className="divide-y divide-[var(--border)] text-sm">
                {folder.items.map((item, index) => (
                  <li key={`${item.label}-${index}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span>
                      {item.href ? (
                        <a href={item.href} className="font-medium underline-offset-2 hover:underline">
                          {label(item)}
                        </a>
                      ) : (
                        <span className="font-medium">{label(item)}</span>
                      )}
                      {item.note ? <span className="ml-2 text-[var(--muted)]">{dated(note(item.note))}</span> : null}
                    </span>
                    {canManage && item.fileId ? <RemoveFile cohortId={id} fileId={item.fileId} label={item.label} /> : null}
                  </li>
                ))}
              </ul>
            )}
            {folder.missing.length > 0 ? (
              <div className="mt-3 rounded-md border border-[#b7791f]/40 bg-[#fbefd9] px-3 py-2 text-sm text-[#7a4f10]">
                <p className="font-medium">{t("cohortFile.stillMissing")}</p>
                <ul className="mt-1 list-disc pl-5">
                  {folder.missing.slice(0, 12).map((text) => (
                    <li key={text}>{missing(text)}</li>
                  ))}
                </ul>
                {folder.missing.length > 12 ? <p className="mt-1">{t("cohortFile.andMore", { count: folder.missing.length - 12 })}</p> : null}
              </div>
            ) : null}
          </Card>
        ))}

        {canManage ? (
          <Card
            section={{ id: "add", label: t("cohortFile.add") }}
            title={t("cohortFile.add")}
            description={t("cohortFile.addIntro")}
            guide={<Guide label={t("guide.how")} points={[t("cohortFile.guide.1"), t("cohortFile.guide.2"), t("cohortFile.guide.3")]} />}
          >
            <FileUpload cohortId={id} sessions={view.sessions.map((row) => ({ ...row, label: dated(row.label) }))} units={view.units} />
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
