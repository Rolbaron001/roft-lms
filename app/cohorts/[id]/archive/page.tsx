import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, Card } from "@/components/app-shell";
import { ArchiveError, cohortArchiveState } from "@/lib/cohort-archive";
import { pageT, requirePermission, requireTenant } from "@/lib/request";
import { maybe } from "@/lib/i18n/maybe";
import {
  Abandon,
  CheckCopy,
  RemoveFiles,
  Restore,
  StartArchive,
  WhileBuilding,
} from "./archive-controls";

/**
 * Archiving a cohort's evidence off the platform. Job sheet 4.3.
 *
 * Four steps, each a deliberate act: make the archive, download it and store
 * it, check the stored copy, and only then remove the files. The page shows
 * one archive's next step at a time rather than every button at once, so the
 * order cannot be got wrong by clicking.
 */

function day(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

function size(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

export default async function CohortArchivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("records:manage");
  const t = await pageT();

  let state;
  try {
    state = await cohortArchiveState(session, id);
  } catch (error) {
    if (error instanceof ArchiveError) notFound();
    throw error;
  }

  const building = state.archives.some((archive) => archive.status === "building");

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link href={`/cohorts/${id}`} className="text-sm text-[var(--muted)] hover:underline">
          ← {state.cohort.name}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{t("archive.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("archive.intro")}</p>
      </div>

      <Card
        title={t("archive.ready", { count: state.ready.length })}
        description={
          state.qualification
            ? t("archive.readyFor", { qualification: state.qualification.title })
            : t("archive.noQualification")
        }
      >
        {state.ready.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{t("archive.nobody")}</p>
        ) : (
          <>
            <ul className="mb-4 space-y-1 text-sm">
              {state.ready.map((learner) => (
                <li key={learner.userId}>{learner.name}</li>
              ))}
            </ul>
            {building ? (
              <p className="text-sm text-[var(--muted)]">{t("archive.anotherBuilding")}</p>
            ) : (
              <StartArchive cohortId={id} ready={state.ready.length} />
            )}
          </>
        )}
      </Card>

      {state.waiting.length > 0 ? (
        <div className="mt-6">
          <Card title={t("archive.notYet", { count: state.waiting.length })} description={t("archive.notYetIntro")}>
            <ul className="space-y-1 text-sm">
              {state.waiting.map((learner) => (
                <li key={learner.userId}>
                  {learner.name}
                  <span className="ml-2 text-xs text-[var(--muted)]">{learner.reason}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {state.archives.map((archive) => (
        <div key={archive.id} className="mt-6">
          <Card
            title={archive.filename}
            description={`${t("archive.summary", {
              status: maybe(t, `archive.status.${archive.status}`) ?? archive.status,
              learners:
                archive.learners === 1
                  ? t("archive.oneLearner")
                  : t("archive.learners", { count: archive.learners }),
              files: archive.files === 1 ? t("archive.oneFile") : t("archive.files", { count: archive.files }),
            })}${archive.sizeBytes !== null ? ` · ${size(archive.sizeBytes)}` : ""}`}
          >
            <dl className="mb-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
              <dt className="text-[var(--muted)]">{t("archive.started")}</dt>
              <dd>
                {day(archive.startedAt)}
                {archive.builtBy ? t("archive.by", { name: archive.builtBy }) : ""}
              </dd>
              {archive.verifiedAt ? (
                <>
                  <dt className="text-[var(--muted)]">{t("archive.checked")}</dt>
                  <dd>{day(archive.verifiedAt)}</dd>
                </>
              ) : null}
              {archive.removedAt ? (
                <>
                  <dt className="text-[var(--muted)]">{t("archive.removed")}</dt>
                  <dd>{day(archive.removedAt)}</dd>
                </>
              ) : null}
              {archive.restoredAt ? (
                <>
                  <dt className="text-[var(--muted)]">{t("archive.restored")}</dt>
                  <dd>{day(archive.restoredAt)}</dd>
                </>
              ) : null}
              {archive.fingerprint ? (
                <>
                  <dt className="text-[var(--muted)]">{t("archive.fingerprint")}</dt>
                  <dd className="break-all font-mono text-xs">{archive.fingerprint}</dd>
                </>
              ) : null}
            </dl>

            {archive.status === "building" ? <WhileBuilding /> : null}

            {archive.status === "failed" ? (
              <p className="text-sm text-[var(--danger)]">{archive.failureReason}</p>
            ) : null}

            {archive.status === "built" ? (
              <div className="space-y-5">
                <div>
                  <p className="text-sm font-medium">{t("archive.step1")}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">{t("archive.step1Note")}</p>
                  <a
                    href={`/api/archives/${archive.id}`}
                    className="mt-2 inline-block rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                  >
                    {t("archive.download")}
                  </a>
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">{t("archive.step2")}</p>
                  <CheckCopy cohortId={id} archiveId={archive.id} expectedBytes={archive.sizeBytes ?? 0} />
                </div>
                <Abandon cohortId={id} archiveId={archive.id} />
              </div>
            ) : null}

            {archive.status === "verified" ? (
              <div className="space-y-5">
                <div>
                  <p className="mb-2 text-sm font-medium">{t("archive.step3")}</p>
                  <RemoveFiles
                    cohortId={id}
                    archiveId={archive.id}
                    removing={archive.files - archive.filesKept}
                    keeping={archive.filesKept}
                  />
                </div>
                <Abandon cohortId={id} archiveId={archive.id} />
              </div>
            ) : null}

            {archive.status === "removed" ? (
              <Restore cohortId={id} archiveId={archive.id} expectedBytes={archive.sizeBytes ?? 0} />
            ) : null}
          </Card>
        </div>
      ))}
    </AppShell>
  );
}
