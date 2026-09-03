import { requirePermission, requireTenant } from "@/lib/request";
import { listCurriculumModules, listQualifications } from "@/lib/authoring";
import { AppShell } from "@/components/app-shell";
import { QualificationsManager } from "./qualifications-manager";
import { FromDocument } from "./from-document";
import { FolderPicker } from "@/components/folder-picker";
import { Card } from "@/components/ui";
import { extensionOffered, extensionState } from "@/lib/extensions";

export default async function QualificationsPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("qualification:manage");

  // Folder import is ordinary functionality and is shown to everybody who can
  // manage a qualification. The extension state is read only so the form can
  // say what an extension would add, not to decide whether to offer it.
  const extension = await extensionState(session);
  const mayUseExtension =
    extensionOffered() && session.permissions.includes("extension:use");

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
        <Card
          title="Build it from a folder"
          description="Choose a qualification folder and it reads everything in it — the curriculum, the study units, the guides, the policies — and shows you what it would create. Nothing is written until you say so."
        >
          <FolderPicker
            label="The qualification's folder, from your own computer"
            extension={
              mayUseExtension
                ? {
                    enabled: extension.enabled,
                    available: extension.availability?.available ?? false,
                    reason: extension.availability?.reason ?? null,
                  }
                : null
            }
            hint={
              <>
                Everything in the folder and its subfolders is read: the
                curriculum, the study units, the guides and the policies.
                <br />
                A folder built by your programme development system includes a
                summary of itself, and that is read directly — in seconds. A
                folder without one cannot have its structure worked out yet.
              </>
            }
          />
        </Card>
      </div>

      <div className="mb-6">
        <FromDocument />
      </div>

      <QualificationsManager qualifications={withModules} />
    </AppShell>
  );
}
