import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, Card } from "@/components/app-shell";
import { ArchiveError, cohortArchiveState } from "@/lib/cohort-archive";
import { requirePermission, requireTenant } from "@/lib/request";
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

const STATUS: Record<string, string> = {
  building: "Being written",
  failed: "Did not finish",
  built: "Ready to download",
  verified: "Your copy checked",
  removed: "Files removed from the platform",
  restored: "Restored",
  abandoned: "Set aside",
};

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
        <h1 className="mt-2 text-xl font-semibold">Archive evidence</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Once a learner holds their certificate and statement of results, their Portfolio of Evidence can leave the platform in one archive that you keep. The archive opens in any browser without the platform. Nothing is removed until your stored copy has been checked against it, and every record stays here, saying which archive holds the files.
        </p>
      </div>

      <Card
        title={`Ready to archive (${state.ready.length})`}
        description={
          state.qualification
            ? `Holding a certificate and a statement of results for ${state.qualification.title}.`
            : "This cohort's course counts towards no qualification."
        }
      >
        {state.ready.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Nobody yet.</p>
        ) : (
          <>
            <ul className="mb-4 space-y-1 text-sm">
              {state.ready.map((learner) => (
                <li key={learner.userId}>{learner.name}</li>
              ))}
            </ul>
            {building ? (
              <p className="text-sm text-[var(--muted)]">
                Another archive is being written. Start the next one when it has finished.
              </p>
            ) : (
              <StartArchive cohortId={id} ready={state.ready.length} />
            )}
          </>
        )}
      </Card>

      {state.waiting.length > 0 ? (
        <div className="mt-6">
          <Card
            title={`Not yet (${state.waiting.length})`}
            description="They stay on the platform and follow in a later archive once their own certificate is issued."
          >
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
            description={`${STATUS[archive.status] ?? archive.status} · ${archive.learners} ${archive.learners === 1 ? "learner" : "learners"}, ${archive.files} ${archive.files === 1 ? "file" : "files"}${archive.sizeBytes !== null ? ` · ${size(archive.sizeBytes)}` : ""}`}
          >
            <dl className="mb-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
              <dt className="text-[var(--muted)]">Started</dt>
              <dd>
                {day(archive.startedAt)}
                {archive.builtBy ? ` by ${archive.builtBy}` : ""}
              </dd>
              {archive.verifiedAt ? (
                <>
                  <dt className="text-[var(--muted)]">Copy checked</dt>
                  <dd>{day(archive.verifiedAt)}</dd>
                </>
              ) : null}
              {archive.removedAt ? (
                <>
                  <dt className="text-[var(--muted)]">Files removed</dt>
                  <dd>{day(archive.removedAt)}</dd>
                </>
              ) : null}
              {archive.restoredAt ? (
                <>
                  <dt className="text-[var(--muted)]">Restored</dt>
                  <dd>{day(archive.restoredAt)}</dd>
                </>
              ) : null}
              {archive.fingerprint ? (
                <>
                  <dt className="text-[var(--muted)]">Fingerprint</dt>
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
                  <p className="text-sm font-medium">1. Download it and store it</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Keep it where your records policy says learner records are kept, for the full retention period. Once the files are removed, this is the only complete copy.
                  </p>
                  <a
                    href={`/api/archives/${archive.id}`}
                    className="mt-2 inline-block rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                  >
                    Download the archive
                  </a>
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">2. Check the copy you stored</p>
                  <CheckCopy
                    cohortId={id}
                    archiveId={archive.id}
                    expectedBytes={archive.sizeBytes ?? 0}
                  />
                </div>
                <Abandon cohortId={id} archiveId={archive.id} />
              </div>
            ) : null}

            {archive.status === "verified" ? (
              <div className="space-y-5">
                <div>
                  <p className="mb-2 text-sm font-medium">3. Remove the files from the platform</p>
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
