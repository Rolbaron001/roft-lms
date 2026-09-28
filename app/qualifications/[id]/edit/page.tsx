import Link from "next/link";
import { notFound } from "next/navigation";
import { pageT, requirePermission, requireTenant } from "@/lib/request";
import {
  curriculumForEditing,
  curriculumProblems,
  CurriculumError,
} from "@/lib/curriculum-editor";
import { programmeReadiness } from "@/lib/programme-readiness";
import { planReclassification } from "@/lib/part-qualifications";
import { listQualifications } from "@/lib/authoring";
import { AppShell, Card } from "@/components/app-shell";
import { ModuleEditor } from "./module-editor";
import { AddModule } from "./add-module";
import { ReclassifyForm } from "./reclassify-form";

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
  const t = await pageT();

  let curriculum;
  try {
    curriculum = await curriculumForEditing(session, id);
  } catch (error) {
    if (error instanceof CurriculumError) notFound();
    throw error;
  }

  const [problems, readiness, classification, everyQualification] =
    await Promise.all([
      curriculumProblems(session, id),
      programmeReadiness(session, id),
      planReclassification(session, id),
      listQualifications(session),
    ]);

  // Only a full qualification can be a parent: a part of a part has no meaning
  // in the documents, where each part lists the full qualification's own
  // module codes.
  const candidates = everyQualification
    .filter((one) => one.id !== id && one.kind === "full")
    .map((one) => ({ id: one.id, title: one.title }));

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
        <h1 className="mt-2 text-xl font-semibold">{t("buildCurr.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("buildCurr.intro")}</p>
        <Link
          href={`/qualifications/${id}/edit/from-document`}
          className="mt-3 inline-block rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium"
        >
          {t("buildCurr.fromDocument")}
        </Link>
      </div>

      {readiness.ready ? (
        <p className="mb-6 rounded-md border border-[var(--success)]/40 bg-[var(--success)]/5 px-4 py-3 text-sm">
          {t("buildCurr.ready", {
            modules: readiness.curriculum.modules,
            criteria: readiness.curriculum.criteria,
          })}
        </p>
      ) : (
        <div className="mb-6 rounded-md border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 px-4 py-3 text-sm">
          <p className="font-medium">{t("buildCurr.notReady")}</p>
          <ul className="mt-1 space-y-0.5 text-[var(--muted)]">
            {readiness.gaps.map((gap, index) => (
              <li key={index}>· {gap.action}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-6">
        <Card
          title={t("buildCurr.whatItIs")}
          description={t("buildCurr.whatItIsNote")}
        >
          <ReclassifyForm
            qualificationId={id}
            kind={classification.from}
            parentId={curriculum.qualification.parentQualificationId ?? null}
            ownModules={classification.ownModules}
            selectedModules={classification.selectedModules}
            enrolled={classification.enrolled}
            candidates={candidates}
          />
        </Card>
      </div>

      {faults.length > 0 ? (
        <Card
          title={t("buildCurr.faults", { count: faults.length })}
          description={t("buildCurr.faultsNote")}
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
          <Card title={t("buildCurr.worthKnowing")}>
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
