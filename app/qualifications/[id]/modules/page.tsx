import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { qualifications } from "@/db/schema";
import { listCurriculumModules } from "@/lib/authoring";
import { modulesOf } from "@/lib/part-qualifications";
import { requirePermission, requireTenant } from "@/lib/request";
import { AppShell, Card } from "@/components/app-shell";
import { ModuleSelection } from "./module-selection";

/**
 * Which of its parent's modules a part qualification takes.
 *
 * This is the screen the SAQA document is transcribed onto. 118710's
 * `QUALIFICATION RULES` section names five modules out of Commercial
 * Cleaner's; somebody ticks those five here, and the platform then knows what
 * this qualification is assessed against without a second copy of the
 * curriculum existing anywhere.
 *
 * The running credit total is shown as it is ticked, against what the document
 * claims, because the two agreeing is the check that the transcription is
 * right - 16 + 14 + 17 = 47, which is the stated minimum.
 */
export default async function PartModulesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("qualification:manage");

  const [entry] = await withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: qualifications.id,
        title: qualifications.title,
        kind: qualifications.kind,
        parentId: qualifications.parentQualificationId,
        totalCredits: qualifications.totalCredits,
      })
      .from(qualifications)
      .where(eq(qualifications.id, id)),
  );

  if (!entry) notFound();

  // A qualification that carries its own curriculum has nothing to select
  // from. Sending them to the curriculum itself is more use than an error.
  if (!entry.parentId) {
    redirect(`/qualifications/${id}`);
  }

  const [parent] = await withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: qualifications.id,
        title: qualifications.title,
        curriculumCode: qualifications.curriculumCode,
      })
      .from(qualifications)
      .where(eq(qualifications.id, entry.parentId!)),
  );

  const available = await listCurriculumModules(session, entry.parentId!);
  const chosen = await modulesOf(session, id);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <p className="text-xs text-[var(--muted)]">
          <Link
            href={`/qualifications/${id}`}
            className="underline-offset-2 hover:underline"
          >
            {entry.title}
          </Link>
        </p>
        <h1 className="mt-1 text-xl font-semibold">
          Which modules this takes
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
          {entry.kind === "part" ? "This part qualification" : "This programme"}{" "}
          is drawn from{" "}
          <Link
            href={`/qualifications/${parent?.id}`}
            className="underline underline-offset-2"
          >
            {parent?.title}
          </Link>
          {parent?.curriculumCode
            ? ` and shares its curriculum, ${parent.curriculumCode}.`
            : " and shares its curriculum."}{" "}
          Tick the modules its own SAQA document lists under{" "}
          <em>Qualification Rules</em>. Nothing is copied: a learner&rsquo;s
          work against a module counts once, wherever they met it.
        </p>
      </div>

      {available.length === 0 ? (
        <Card title="The parent's curriculum has not been read in yet">
          <p className="text-sm text-[var(--muted)]">
            There is nothing to choose from until{" "}
            <Link
              href={`/qualifications/${parent?.id}`}
              className="underline underline-offset-2"
            >
              {parent?.title}
            </Link>{" "}
            has its curriculum document read in. Do that first, and this list
            fills itself.
          </p>
        </Card>
      ) : (
        <ModuleSelection
          qualificationId={id}
          modules={available.map((module) => ({
            id: module.id,
            code: module.code,
            title: module.title,
            component: module.component,
            credits: module.credits,
          }))}
          chosen={chosen.map((module) => module.id)}
          claimedCredits={entry.totalCredits}
        />
      )}
    </AppShell>
  );
}
