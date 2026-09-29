import Link from "next/link";
import { notFound } from "next/navigation";
import { pageLocale, requirePermission, requireTenant } from "@/lib/request";
import { vocabulary } from "@/lib/terms";
import { extensionState } from "@/lib/extensions";
import { FolderPicker } from "@/components/folder-picker";
import { DrivePicker } from "@/components/drive-picker";
import { connectionsFor } from "@/lib/drive";
import {
  availableCourses,
  enrollableForPath,
  getLearningPath,
  LearningPathError,
} from "@/lib/learning-paths";
import { AppShell, Card, StatusBadge } from "@/components/app-shell";
import { PathEditor } from "./path-editor";

export default async function PathPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("course:read");
  const { t, locale } = await pageLocale();
  const words = vocabulary(tenant.terminology, tenant.featureFlags, locale);
  // Drive and OneDrive are offered wherever a folder is, so a provider
  // who keeps their material there never has to download it first.
  const drives = session.permissions.includes("qualification:manage")
    ? await connectionsFor(session)
    : [];

  const canAuthorHere = session.permissions.includes("course:author");
  const extension = await extensionState(session);
  const mayUseExtension = extension.registered ? extension : null;

  let detail;
  try {
    detail = await getLearningPath(session, id);
  } catch (error) {
    if (error instanceof LearningPathError && error.code === "not_found") {
      notFound();
    }
    throw error;
  }

  const canAuthor = session.permissions.includes("course:author");
  const canEnrol = session.permissions.includes("enrolment:manage");

  const [addable, people] = await Promise.all([
    canAuthor ? availableCourses(session, id) : Promise.resolve([]),
    canEnrol && session.permissions.includes("user:read")
      ? enrollableForPath(session)
      : Promise.resolve([]),
  ]);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href="/paths"
          className="text-sm text-[var(--muted)] hover:underline"
        >
          {t("paths.all", { programmes: words.lowerMany("programme") })}
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{detail.path.title}</h1>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--muted)]">
              {detail.enrolled === 1 ? t("paths.onItOne") : t("paths.onIt", { count: detail.enrolled })}
            </span>
            <StatusBadge status={detail.path.status} />
          </div>
        </div>
        {detail.path.description ? (
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            {detail.path.description}
          </p>
        ) : null}
      </div>

      <PathEditor
        pathId={id}
        status={detail.path.status}
        steps={detail.steps.map((step) => ({
          courseId: step.courseId,
          title: step.title,
          status: step.status,
          requiresPrevious: step.requiresPrevious === 1,
        }))}
        addableCourses={addable}
        people={people.map((person) => ({
          id: person.id,
          label: `${person.firstName} ${person.lastName} · ${person.email}`,
        }))}
        canAuthor={canAuthor}
        canPublish={session.permissions.includes("course:publish")}
        canEnrol={canEnrol}
      />
      {canAuthorHere ? (
        <div className="mb-6">
          <Card title={t("paths.folder")} description={t("paths.folderNote")}>
            <FolderPicker
              learningPathId={id}
              label={t("paths.folderLabel")}
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
                  {t("paths.folderHint")}
                  <br />
                  {t("paths.folderHint2", { courses: words.lowerMany("course") })}
                </>
              }
            />
          </Card>
        </div>
      ) : null}

      {drives.length > 0 ? (
        <div className="mt-6">
          <Card title={t("paths.drive")} description={t("paths.driveNote")}>
            <DrivePicker
              drives={drives.map((one) => ({
                provider: one.provider,
                label: one.label,
                accountLabel: one.accountLabel,
              }))}
              learningPathId={id}
            />
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
