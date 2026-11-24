import Link from "next/link";
import { notFound } from "next/navigation";
import { localeFor, requireSession, requireTenant } from "@/lib/request";
import { translator } from "@/lib/i18n";
import { programmeHandbooks } from "@/lib/learner-unit";
import { can } from "@/lib/rbac";
import { AppShell } from "@/components/app-shell";
import { PageReader } from "@/components/page-reader";

/**
 * A learner handbook filed for the whole programme, read in the page reader
 * (24 November 2026). Before the cohort releases the programme the page says
 * when it opens; the file itself is refused where it is served.
 */
export default async function ProgrammeHandbookPage({ params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();
  const t = translator(localeFor(tenant, session));
  const { items, open } = await programmeHandbooks(session, id);
  const handbook = items.find((one) => one.id === docId);
  if (!handbook) notFound();

  const src = `/api/learn/handbook/${handbook.id}`;
  const isPdf = handbook.hasPdf || handbook.mimeType === "application/pdf";
  const isWord = !handbook.hasPdf && /wordprocessingml/.test(handbook.mimeType);

  return (
    <AppShell tenant={tenant} session={session}>
      {/* Staff come here from the learner preview, and go back to it. */}
      <Link href={can(session, "course:author") ? `/qualifications/${id}/learner` : `/learn/qualification/${id}`} className="text-sm text-[var(--muted)] hover:underline">
        {t("learnQual.backToProgramme")}
      </Link>
      <h1 className="mb-4 mt-2 text-xl font-semibold">{handbook.title}</h1>
      {!open ? (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4 text-sm text-[var(--muted)]">{t("learnQual.handbookLater")}</p>
      ) : isPdf || isWord ? (
        <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <PageReader src={handbook.hasPdf ? `${src}?as=pdf` : src} downloadHref={`${src}?download`} kind={isPdf ? "pdf" : "word"} />
        </section>
      ) : (
        <a href={`${src}?download`} className="text-sm underline underline-offset-2">
          {t("learnUnit.download")}
        </a>
      )}
    </AppShell>
  );
}
