import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { qualifications } from "@/db/schema";
import { pageT, requirePermission, requireTenant } from "@/lib/request";
import { filedMap } from "@/lib/filed-map";
import { AppShell, Card } from "@/components/app-shell";
import { QualificationNav } from "@/components/qualification-nav";
import { CheckTheMap } from "@/app/imports/[id]/check-the-map";
import { BuildForm } from "../verify/verify-forms";
import { filedAnswerAction } from "./actions";

/**
 * The programme map of a qualification already built (job sheet D60 stage
 * 4): which unit each document is in, which guide each paper is read with,
 * and which other units a document covers, correctable here without removing
 * the qualification. Changes take effect when it is built again.
 */
export default async function ProgrammeMapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("qualification:manage");
  const t = await pageT();

  const [qualification] = await withTenant(session.organisationId, (tx) =>
    tx.select({ id: qualifications.id, title: qualifications.title }).from(qualifications).where(eq(qualifications.id, id)),
  );
  if (!qualification) notFound();

  const map = await filedMap(session, id);
  const mayBuild = session.permissions.includes("course:author") && session.permissions.includes("assessment:author");

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-4">
        <Link href={`/qualifications/${id}`} className="text-sm text-[var(--muted)] underline-offset-2 hover:underline">
          {t("verify.back")}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{t("filedMap.title")}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{qualification.title}</p>
      </div>

      <QualificationNav qualificationId={id} current="map" />

      <Card>
        <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">{t("filedMap.intro")}</p>
        <CheckTheMap map={map} live onAnswer={filedAnswerAction.bind(null, id)} afterBuild downloadHref={`/qualifications/${id}/map/download`} />
        {mayBuild ? (
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <p className="mb-2 text-sm">{t("filedMap.buildNote")}</p>
            <BuildForm qualificationId={id} again />
          </div>
        ) : null}
      </Card>
    </AppShell>
  );
}
