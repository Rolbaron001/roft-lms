import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { programmeDocuments } from "@/db/schema";
import { requireSession, requireTenant } from "@/lib/request";
import { AppShell } from "@/components/app-shell";
import { PageReader } from "@/components/page-reader";
import { BackLink } from "./back-link";

/**
 * A filed document, read in the page as its own pages (Roland, 19 November
 * 2026: any user "must be able to read a document comfortably from the app").
 * A PDF or Word file opens in the page reader; anything else downloads, as
 * before. Who may read it is still decided where the bytes are served
 * (app/api/programme-documents/[id]), so a marking memorandum stays with
 * assessors.
 */
const READABLE = /^application\/pdf$|wordprocessingml/;

export default async function DocumentReadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();
  const [document] = await withTenant(session.organisationId, (tx) =>
    tx.select({ title: programmeDocuments.title, mimeType: programmeDocuments.mimeType }).from(programmeDocuments).where(eq(programmeDocuments.id, id)),
  );
  if (!document) notFound();
  const src = `/api/programme-documents/${id}`;
  if (!READABLE.test(document.mimeType)) redirect(src);

  return (
    <AppShell tenant={tenant} session={session}>
      <BackLink />
      <h1 className="mb-4 mt-2 text-xl font-semibold">{document.title}</h1>
      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <PageReader src={src} downloadHref={src} kind={document.mimeType === "application/pdf" ? "pdf" : "word"} />
      </section>
    </AppShell>
  );
}
