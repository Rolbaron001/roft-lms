import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { requirePermission, requireTenant } from "@/lib/request";
import { withTenant } from "@/db/client";
import { assessmentCriteria } from "@/db/schema";
import {
  getMarkedPaper,
  MarkingError,
  proposeCriterionOutcomes,
  rubricsForPaper,
} from "@/lib/marking";
import { AppShell, Card } from "@/components/app-shell";
import { MarkForm } from "./mark-form";

/**
 * Marking a paper question by question.
 *
 * Separate from the decision screen because they are two different jobs: this
 * one awards marks, that one records a judgement. For a summative the two run
 * in order — every question marked, then the criteria the marks imply
 * confirmed — and this page links on when it is ready.
 */
export default async function MarkPaperPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("assessment:assess");

  let paper;
  try {
    paper = await getMarkedPaper(session, id);
  } catch (error) {
    if (error instanceof MarkingError) {
      if (error.code === "not_permitted") redirect("/not-permitted");
      notFound();
    }
    throw error;
  }

  const rubrics = await rubricsForPaper(session, id);

  // The criteria this paper's questions evidence, offered as the things a
  // facilitator can flag when returning a workbook.
  const criterionIds = [
    ...new Set(paper.items.flatMap((item) => item.criterionIds)),
  ];
  const criteria =
    criterionIds.length === 0
      ? []
      : await withTenant(session.organisationId, (tx) =>
          tx
            .select({
              id: assessmentCriteria.id,
              code: assessmentCriteria.code,
              description: assessmentCriteria.description,
            })
            .from(assessmentCriteria)
            .where(inArray(assessmentCriteria.id, criterionIds)),
        );

  // For a summative, show what the marks imply once everything is marked.
  let proposals: Awaited<ReturnType<typeof proposeCriterionOutcomes>> = [];
  if (paper.purpose === "summative" && paper.fullyMarked) {
    proposals = await proposeCriterionOutcomes(session, id);
  }

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link href="/assess" className="text-sm text-[var(--muted)] hover:underline">
          ← Waiting to be assessed
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Marking</h1>
      </div>

      <MarkForm paper={paper} rubrics={rubrics} criteria={criteria} />

      {paper.purpose === "summative" ? (
        <div className="mt-6">
          <Card
            title="What these marks imply"
            description="A proposal, not a decision. Confirm or change each one on the decision screen — what you record there is your judgement, and an override is recorded as an override."
          >
            {!paper.fullyMarked ? (
              <p className="text-sm text-[var(--muted)]">
                Every question has to be marked before the criteria can be
                worked out.
              </p>
            ) : (
              <>
                <ul className="space-y-2">
                  {proposals.map((proposal) => (
                    <li
                      key={proposal.criterionId}
                      className="rounded-md border border-[var(--border)] px-4 py-3 text-sm"
                    >
                      <span className="font-mono text-xs">{proposal.code}</span>{" "}
                      {proposal.description}
                      <span
                        className={`ml-2 font-medium ${
                          proposal.outcome === "competent"
                            ? "text-[var(--success)]"
                            : "text-[var(--danger)]"
                        }`}
                      >
                        {proposal.outcome === "competent"
                          ? "competent"
                          : "not yet competent"}
                      </span>
                      <span className="mt-1 block text-xs text-[var(--muted)]">
                        On{" "}
                        {proposal.evidence
                          .map((e) => `${e.awarded}/${e.points}`)
                          .join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={`/assess/${id}`}
                  className="mt-4 inline-block rounded-md px-4 py-2 text-sm font-semibold text-white"
                  style={{ background: "var(--brand-primary)" }}
                >
                  Record the decision
                </Link>
              </>
            )}
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
