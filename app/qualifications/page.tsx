import { requireAnyPermission, requireTenant } from "@/lib/request";
import { listCurriculumModules, listQualifications } from "@/lib/authoring";
import { AppShell } from "@/components/app-shell";
import { QualificationsManager } from "./qualifications-manager";
import { FromDocument } from "./from-document";
import { FolderPicker } from "@/components/folder-picker";
import { DrivePicker } from "@/components/drive-picker";
import { connectionsFor } from "@/lib/drive";
import { Card } from "@/components/ui";
import { EmptyState } from "@/components/empty-state";
import { extensionOffered, extensionState } from "@/lib/extensions";

export default async function QualificationsPage() {
  const tenant = await requireTenant();
  // Read by everybody who delivers or judges against a qualification; built
  // and changed by an administrator. See the detail page for the reasoning.
  const session = await requireAnyPermission([
    "qualification:manage",
    "course:author",
    "assessment:assess",
    "assessment:moderate",
  ]);
  const canManage = session.permissions.includes("qualification:manage");

  // Curiosa keep all their material on Google Drive, so reading it where it
  // already lives saves downloading eighty files and uploading them again.
  const drives = canManage ? await connectionsFor(session) : [];

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

      {canManage ? (
        <>
          {/*
            The documents come first, and that ordering is the fix rather than
            a preference.

            This route needs no AI at any point: the curriculum document is
            parsed directly, and it reads the whole thing — 22 modules, 85
            topics and 182 internal assessment criteria out of the Commercial
            Cleaner. The folder route below needs an AI extension unless the
            folder describes itself, and on the hosted server no extension can
            run at all, because the only provider shells out to a CLI that is
            not in the container.

            On 16 September the folder route was at the top and this was
            beneath it, so the qualification test with Heidi was spent on the
            one path that could not succeed while the one that works sat
            further down the page.
          */}
          <div className="mb-6">
            <FromDocument />
          </div>

          <div className="mb-6">
            <Card
              title="Or build it from a folder"
              description="Everything at once: the curriculum, the study units, the guides and the policies. A folder that includes a summary of itself imports in seconds; one that does not has to have its structure worked out, and that is the part that needs an AI extension."
            >
              <FolderPicker
                label="The qualification's folder, from your own computer"
                extension={
                  mayUseExtension
                    ? {
                        on: extension.on,
                        available: extension.availability?.available ?? false,
                        registered: extension.registered,
                        reason: extension.availability?.reason ?? null,
                      }
                    : null
                }
                hint={
                  <>
                    Everything in the folder and its subfolders is read: the
                    curriculum, the study units, the guides and the policies.
                    <br />A folder built by your programme development system
                    includes a summary of itself, and that is read directly — in
                    seconds. A folder without one cannot have its structure
                    worked out yet.
                  </>
                }
              />
            </Card>
          </div>

          {drives.length > 0 ? (
            <div className="mb-6">
              <Card
                title="Or from a drive you have connected"
                description="The same folder, read where it already lives. It ends in the same place — a proposal to check before anything is written."
              >
                <DrivePicker
                  drives={drives.map((one) => ({
                    provider: one.provider,
                    label: one.label,
                    accountLabel: one.accountLabel,
                  }))}
                />
              </Card>
            </div>
          ) : null}
        </>
      ) : null}

      {/*
        Said rather than left blank.

        Every other list on the platform says what would be here when it holds
        nothing - "Nothing is waiting", "No cohorts yet" - and this one did
        not. A facilitator or an assessor opening it before any qualification
        has been loaded got a heading, a paragraph explaining what a
        qualification is, and then the bottom of the page: no list, no message,
        and no way to tell an empty platform from a broken one. They see no
        import controls either, correctly, so there was nothing on the screen
        at all.

        Two different sentences, because the two readers can do different
        things about it. Found by signing in as a facilitator and looking,
        which is the only way this kind of fault shows up - the screen is
        correct for the administrator who built it.
      */}
      {withModules.length === 0 ? (
        <EmptyState title="No qualifications yet">
          {canManage ? (
            <p>
              Build one from its documents above — the curriculum document and
              the qualification document are enough, and no AI extension is
              involved. Everything else on the platform hangs off a
              qualification, so this is the first thing to do.
            </p>
          ) : (
            <p>
              None has been loaded yet. When one has been, the curriculum you
              teach and mark against will be here — its modules, its topics and
              the criteria each one is assessed by. Loading one is an
              administrator&rsquo;s job.
            </p>
          )}
        </EmptyState>
      ) : null}

      <QualificationsManager
        qualifications={withModules}
        canManage={canManage}
      />
    </AppShell>
  );
}
