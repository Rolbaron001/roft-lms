import { pageT, requirePermission, requireTenant } from "@/lib/request";
import { linkableUnits, listLibrary } from "@/lib/library";
import { describeSize } from "@/lib/media";
import { AppShell, Card } from "@/components/app-shell";
import { LinkMaterial, RemoveMaterial, UnlinkMaterial, UploadMaterial } from "./material-forms";

/**
 * The provider's learning material: videos, diagrams and other files, kept
 * once and used by as many study units as need them (Roland, 5 October
 * 2026). Learners never see this page; they meet each item on the page of a
 * study unit they are on, once their cohort has released it.
 */
export default async function MaterialPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("course:author");
  const t = await pageT();
  const [items, units] = await Promise.all([listLibrary(session), linkableUnits(session)]);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("material.heading")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">{t("material.intro")}</p>
      </div>

      <Card title={t("material.addTitle")}>
        <UploadMaterial units={units} />
      </Card>

      <h2 className="mb-3 mt-8 font-semibold">{t("material.listTitle", { count: items.length })}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{t("material.empty")}</p>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <Card key={item.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <a href={`/api/material/${item.id}`} className="font-medium underline-offset-2 hover:underline">
                    {item.title}
                  </a>
                  <span className="ml-2 text-xs text-[var(--muted)]">
                    {item.kind} · {describeSize(item.sizeBytes)} · {item.filename}
                  </span>
                  {item.description ? <p className="mt-1 text-sm text-[var(--muted)]">{item.description}</p> : null}
                </div>
                {item.links.length === 0 ? <RemoveMaterial itemId={item.id} /> : null}
              </div>
              {item.links.length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm">
                  {item.links.map((link) => (
                    <li key={link.id} className="flex flex-wrap items-baseline gap-2">
                      <span>
                        {link.qualificationTitle} · {link.studyUnitCode} {link.studyUnitTitle}
                      </span>
                      <span className="text-xs text-[var(--muted)]">
                        {link.releaseWithTitle ? t("material.releasedWith", { step: link.releaseWithTitle }) : t("material.releasedWithUnit")}
                      </span>
                      <UnlinkMaterial linkId={link.id} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-[var(--muted)]">{t("material.unused")}</p>
              )}
              <LinkMaterial itemId={item.id} units={units} />
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
