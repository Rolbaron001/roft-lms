import Link from "next/link";
import { pageT, requireAnyPermission, requireCapability, said } from "@/lib/request";
import { listCurriculumModules, listQualifications } from "@/lib/authoring";
import { AppShell } from "@/components/app-shell";
import { QualificationsManager } from "./qualifications-manager";
import { FromDocument } from "./from-document";
import { FolderPicker } from "@/components/folder-picker";
import { DrivePicker } from "@/components/drive-picker";
import { connectionsFor } from "@/lib/drive";
import { Card } from "@/components/ui";
import { EmptyState } from "@/components/empty-state";
import { ViewTabs } from "@/components/view-tabs";
import { ChooseDifferently, HowChooser, HOW_OPTIONS } from "./how-chooser";
import { extensionOffered, extensionState } from "@/lib/extensions";
import { AssignedNote } from "@/components/assigned-note";

/**
 * The list of qualifications or of skills programmes, and adding one.
 *
 * One screen for both, because a skills programme is built and delivered as a
 * qualification is: study units, workbooks, cohorts, the same marking. What
 * differs is how it begins (Roland, 23 October 2026). A full or part
 * qualification is founded on three documents: the SAQA qualification
 * document, the curriculum and the assessment specification, and ends in an
 * EISA. An occupational skills programme is founded on two: its Skills
 * Programme Document and its curriculum, and ends in a FISA the provider runs.
 * So each has its own entry under Learning, its own list, and its own way in,
 * asking only for the documents it has (job sheet D39).
 */
export async function QualificationsScreen({
  searchParams,
  programme,
}: {
  searchParams: Promise<{ view?: string; how?: string }>;
  programme: boolean;
}) {
  /*
   * Reading what you have, or adding one. Two jobs on one screen.
   *
   * Roland, 19 September: "a list of available qualifications is pushed
   * in-between the creation and upload processes. Let's untangle the screens
   * please."
   */
  const params = await searchParams;
  const view = params.view === "add" ? "add" : "list";
  const basePath = programme ? "/skills-programmes" : "/qualifications";
  // A skills programme is added from its documents or by hand. A folder is
  // read by the qualification's own file names, which a skills programme's
  // documents do not follow.
  const offered = programme ? (["documents", "blank"] as const) : HOW_OPTIONS.map((option) => option.id);
  const how = offered.some((id) => id === params.how) ? params.how : null;
  const tenant = await requireCapability("qualifications");
  const session = await requireAnyPermission([
    "qualification:manage",
    "course:author",
    "assessment:assess",
    "assessment:moderate",
  ]);
  const t = await pageT();
  const canManage = session.permissions.includes("qualification:manage");

  const drives = canManage && !programme ? await connectionsFor(session) : [];
  const extension = await said(await extensionState(session));
  const mayUseExtension = extensionOffered() && session.permissions.includes("extension:use");

  const all = await listQualifications(session);
  const qualifications = all.filter((one) => (one.kind === "skills_programme") === programme);
  const others = all.length - qualifications.length;
  const withModules = await Promise.all(
    qualifications.map(async (qualification) => ({
      ...qualification,
      modules: await listCurriculumModules(session, qualification.id),
    })),
  );
  // The create form offers every full qualification as a parent, whichever list it is on.
  const forCreate = await Promise.all(
    all.map(async (qualification) => ({ ...qualification, modules: await listCurriculumModules(session, qualification.id) })),
  );

  return (
    <AppShell tenant={tenant} session={session}>
      <AssignedNote session={session} />
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{programme ? t("sp.title") : t("quals.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{programme ? t("sp.intro") : t("quals.intro")}</p>
      </div>

      {canManage ? (
        <ViewTabs
          basePath={basePath}
          current={view}
          tabs={[
            { id: "list", label: programme ? t("sp.tabList") : t("quals.tabList"), count: withModules.length },
            { id: "add", label: programme ? t("sp.tabAdd") : t("quals.tabAdd") },
          ]}
        />
      ) : null}

      {view === "add" ? (
        canManage ? (
          how === null ? (
            <HowChooser basePath={basePath} only={[...offered]} programme={programme} />
          ) : (
            <>
              <ChooseDifferently basePath={basePath} />

              {how === "documents" ? (
                <FromDocument startOpen closeHref={`${basePath}?view=add`} programme={programme} />
              ) : null}

              {how === "folder" ? (
                <>
                  <div className="mb-6">
                    <Card title={t("quals.folderTitle")} description={t("quals.folderIntro")}>
                      <FolderPicker
                        label={t("quals.folderLabel")}
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
                            {t("quals.folderHint")}
                            <br />
                            {t("quals.folderHint2")}
                          </>
                        }
                      />
                    </Card>
                  </div>

                  {drives.length > 0 ? (
                    <div className="mb-6">
                      <Card title={t("quals.driveTitle")} description={t("quals.driveIntro")}>
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

              {how === "blank" ? (
                <QualificationsManager
                  qualifications={forCreate}
                  canManage={canManage}
                  show="create"
                  defaultKind={programme ? "skills_programme" : "full"}
                />
              ) : null}
            </>
          )
        ) : null
      ) : (
        <>
          {withModules.length === 0 ? (
            <EmptyState title={programme ? t("sp.noneTitle") : t("quals.noneTitle")}>
              {programme ? (
                <p>{canManage ? t("sp.noneManage") : t("sp.noneRead")}</p>
              ) : canManage ? (
                <p>{t("quals.noneManage")}</p>
              ) : (
                <p>{t("quals.noneRead")}</p>
              )}
            </EmptyState>
          ) : null}

          <QualificationsManager qualifications={withModules} canManage={canManage} show="list" />

          {/* Where the other kind lives, so neither list hides anything. */}
          {others > 0 ? (
            <p className="mt-4 text-sm text-[var(--muted)]">
              <Link href={programme ? "/qualifications" : "/skills-programmes"} className="underline underline-offset-2">
                {programme ? t("sp.seeQualifications", { count: others }) : t("sp.seeProgrammes", { count: others })}
              </Link>
            </p>
          ) : null}
        </>
      )}
    </AppShell>
  );
}
