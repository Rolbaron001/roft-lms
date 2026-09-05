import { redirect } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
import { rplModerationQueue } from "@/lib/recognition";
import { listQualifications } from "@/lib/authoring";
import { listPeople } from "@/lib/people";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { OpenApplication } from "./open-application";
import { ModerateJudgement } from "./moderate-judgement";
import { RecordTransfer } from "./record-transfer";

/**
 * Recognition of Prior Learning, and credit transfer.
 *
 * This screen did not exist. The whole module behind it did - applications,
 * advisory, judgement, moderation, exemption ceilings, credit transfer, all
 * tested - and none of it could be reached by anybody using the platform. A
 * provider is required to offer RPL under the OQSF, so the honest description
 * of that state is that the platform claimed a capability it did not deliver.
 *
 * The order on this page is the order of the process, because the process is
 * the part people get wrong: an application, then advisory, then a judgement
 * per module, then moderation by somebody else, and only then does anything
 * count. Credit transfer sits apart because it is a different thing - somebody
 * already holds a qualification whose outcomes cover a module - and it does not
 * go through advisory.
 */
export default async function RecognitionPage() {
  const tenant = await requireTenant();
  const session = await requireSession();

  const canManage = session.permissions.includes("recognition:manage");
  const canModerate = session.permissions.includes("assessment:moderate");

  if (!canManage && !canModerate) redirect("/not-permitted");

  const [queue, qualifications, learners] = await Promise.all([
    canModerate ? rplModerationQueue(session) : Promise.resolve([]),
    canManage ? listQualifications(session) : Promise.resolve([]),
    canManage && session.permissions.includes("user:read")
      ? listPeople(session)
      : Promise.resolve([]),
  ]);

  const people = learners.map((row) => ({
    id: row.id,
    label: `${row.firstName} ${row.lastName}`,
  }));

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Recognition of prior learning</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          For a learner who can already do part of the work. Nothing here is
          granted on one person&rsquo;s say-so: a judgement is made against the
          module&rsquo;s own criteria, written down in full, and moderated by
          somebody other than whoever made it before it counts for anything.
        </p>
      </div>

      {canModerate ? (
        <div className="mb-6">
          <Card
            title={
              queue.length === 0
                ? "Nothing waiting for a moderator"
                : `${queue.length} waiting for a moderator`
            }
            description="A judgement grants nothing until this is done. Read the rationale against the module before agreeing — it is the first thing an external verifier reads."
          >
            {queue.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                Judgements appear here as they are made.
              </p>
            ) : (
              <ul className="space-y-4">
                {queue.map((row) => (
                  <li
                    key={row.id}
                    className="rounded-md border border-[var(--border)] p-4"
                  >
                    <p className="text-sm font-medium">
                      {row.learnerFirstName} {row.learnerLastName}
                      <span className="ml-2 font-normal text-[var(--muted)]">
                        {row.moduleCode} {row.moduleTitle}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Judged {row.competent ? "competent" : "not yet competent"}{" "}
                      on {row.judgedOn}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm">
                      {row.rationale}
                    </p>
                    <ModerateJudgement judgementId={row.id} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}

      {canManage ? (
        <>
          <div className="mb-6">
            <Card
              title="Open an application"
              description="The first step, and the one that creates the record everything else attaches to."
            >
              <OpenApplication
                learners={people}
                qualifications={qualifications.map((row) => ({
                  id: row.id,
                  label: row.title,
                }))}
              />
            </Card>
          </div>

          <Card
            title="Credit transfer"
            description="Different from RPL: the learner already holds a qualification whose outcomes cover this module. No advisory, but the mapping has to be written down — a transfer without it is a claim nobody can check."
          >
            <RecordTransfer learners={people} />
          </Card>
        </>
      ) : null}
    </AppShell>
  );
}
