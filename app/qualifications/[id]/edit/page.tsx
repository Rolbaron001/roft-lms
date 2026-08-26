import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import {
  curriculumForEditing,
  curriculumProblems,
  CurriculumError,
} from "@/lib/curriculum-editor";
import { programmeReadiness } from "@/lib/programme-readiness";
import { AppShell, Card } from "@/components/app-shell";
import { ModuleEditor } from "./module-editor";
import { AddModule } from "./add-module";

/**
 * Building a curriculum by hand.
 *
 * The read-only view next door exists to be checked line by line against the
 * printed document. This one exists so a provider can put a qualification into
 * the platform without anybody writing an import file for them — which is the
 * difference between a system they operate and one that needs its author.
 *
 * The problems list sits at the top and empties as the work is done. It is not
 * a gate: a curriculum is entered over hours and refusing every half-finished
 * state would make it unusable. What it must not do is stay silent.
 */
export default async function EditCurriculumPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("qualification:manage");

  let curriculum;
  try {
    curriculum = await curriculumForEditing(session, id);
  } catch (error) {
    if (error instanceof CurriculumError) notFound();
    throw error;
  }

  const [problems, readiness] = await Promise.all([
    curriculumProblems(session, id),
    programmeReadiness(session, id),
  ]);

  const faults = problems.filter((problem) => problem.severity === "problem");
  const notes = problems.filter((problem) => problem.severity === "note");

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href={`/qualifications/${id}`}
          className="text-sm text-[var(--muted)] hover:underline"
        >
          ← {curriculum.qualification.title}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Build the curriculum</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Enter it as the curriculum document prints it — the same codes, in the
          same order — so the two can be read side by side. Every line saves as
          you enter it.
        </p>
        <Link
          href={`/qualifications/${id}/edit/from-document`}
          className="mt-3 inline-block rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium"
        >
          Start from the curriculum document
        </Link>
      </div>

      {readiness.ready ? (
        <p className="mb-6 rounded-md border border-[var(--success)]/40 bg-[var(--success)]/5 px-4 py-3 text-sm">
          Ready for material. {readiness.curriculum.modules} modules and{" "}
          {readiness.curriculum.criteria} criteria are in, so a question can be
          tagged to what it evidences.
        </p>
      ) : (
        <div className="mb-6 rounded-md border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 px-4 py-3 text-sm">
          <p className="font-medium">Not ready for material yet.</p>
          <ul className="mt-1 space-y-0.5 text-[var(--muted)]">
            {readiness.gaps.map((gap, index) => (
              <li key={index}>· {gap.action}</li>
            ))}
          </ul>
        </div>
      )}

      {faults.length > 0 ? (
        <Card
          title={`${faults.length} to sort out`}
          description="Not a gate — you can leave and come back. But each of these is something the platform cannot work around later."
        >
          <ul className="space-y-1.5 text-sm">
            {faults.map((problem, index) => (
              <li key={index}>
                <span className="font-mono text-xs">{problem.where}</span>{" "}
                {problem.what}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {notes.length > 0 ? (
        <div className="mt-4">
          <Card title="Worth knowing">
            <ul className="space-y-1.5 text-sm text-[var(--muted)]">
              {notes.map((problem, index) => (
                <li key={index}>
                  <span className="font-mono text-xs">{problem.where}</span>{" "}
                  {problem.what}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      <div className="mt-6 space-y-3">
        {curriculum.modules.map((module) => (
          <ModuleEditor
            key={module.id}
            qualificationId={id}
            module={{
              id: module.id,
              component: module.component,
              code: module.code,
              title: module.title,
              credits: module.credits,
              topics: module.topics.map((topic) => ({
                id: topic.id,
                code: topic.code,
                title: topic.title,
                weightPercent: topic.weightPercent,
                elements: topic.elements.map((element) => ({
                  id: element.id,
                  kind: element.kind,
                  code: element.code,
                  description: element.description,
                })),
              })),
              criteria: module.criteria.map((criterion) => ({
                id: criterion.id,
                code: criterion.code,
                description: criterion.description,
              })),
            }}
          />
        ))}
      </div>

      <div className="mt-6">
        <AddModule qualificationId={id} />
      </div>
    </AppShell>
  );
}
