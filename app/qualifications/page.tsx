import { requirePermission, requireTenant } from "@/lib/request";
import { listCurriculumModules, listQualifications } from "@/lib/authoring";
import { AppShell } from "@/components/app-shell";
import { QualificationsManager } from "./qualifications-manager";
import { FromDocument } from "./from-document";
import { FromFolder } from "./from-folder";
import { extensionState } from "@/lib/extensions";

export default async function QualificationsPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("qualification:manage");

  // Folder import is ordinary functionality and is shown to everybody who can
  // manage a qualification. The extension state is read only so the form can
  // say what an extension would add, not to decide whether to offer it.
  const extension = await extensionState(session);
  const mayUseExtension = session.permissions.includes("extension:use");

  const qualifications = await listQualifications(session);
  const withModules = await Promise.all(
    qualifications.map(async (qualification) => ({
      ...qualification,
      modules: await listCurriculumModules(session, qualification.id),
    })),
  );

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Qualifications</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          An occupational qualification is delivered across three kinds of
          module: Knowledge, Practical skill, and Workplace experience. Each
          module has its own assessment criteria, and the system checks that
          course content covers every one of them before a course can be
          published.
        </p>
      </div>

      {/* The documents come first: everything below is built on them, and the
          App can read most of what the form would otherwise ask for. */}
      <div className="mb-6">
        <FromFolder
          roots={extension.allowedImportRoots}
          extension={
            mayUseExtension
              ? {
                  enabled: extension.enabled,
                  available: extension.availability?.available ?? false,
                  reason: extension.availability?.reason ?? null,
                }
              : null
          }
        />
      </div>

      <div className="mb-6">
        <FromDocument />
      </div>

      <QualificationsManager qualifications={withModules} />
    </AppShell>
  );
}
