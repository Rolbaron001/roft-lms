import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { libraryItems } from "@/db/schema";
import { localeFor, requireSession, requireTenant } from "@/lib/request";
import { translator } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { PdfViewer } from "@/components/document-viewer";

/**
 * A PDF from a study unit's material, read in the page with the same viewer
 * as the theory guide. A browser's own PDF viewer is not relied on: stored
 * files are served sandboxed, and some browsers will not show a PDF that way.
 * Who may read it is checked where the bytes are served.
 */
export default async function MaterialViewPage({ params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();
  const t = translator(localeFor(tenant, session));
  const [item] = await withTenant(session.organisationId, (tx) =>
    tx.select({ title: libraryItems.title, mimeType: libraryItems.mimeType }).from(libraryItems).where(eq(libraryItems.id, itemId)),
  );
  if (!item) notFound();
  const src = `/api/learn/${id}/material/${itemId}`;

  return (
    <AppShell tenant={tenant} session={session}>
      <Link href={`/learn/${id}#material`} className="text-sm text-[var(--muted)] hover:underline">
        {t("learnUnit.backToUnit")}
      </Link>
      <h1 className="mb-4 mt-2 text-xl font-semibold">{item.title}</h1>
      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <PdfViewer src={src} downloadHref={`${src}?download`} />
      </section>
    </AppShell>
  );
}
