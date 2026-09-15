import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import { TopicElementError, topicElementDetail } from "@/lib/topic-element";
import { AppShell, Card } from "@/components/app-shell";

const ELEMENT_LABELS: Record<string, string> = {
  knowledge_topic: "Topic element",
  practical_activity: "Required performance",
  applied_knowledge: "Applied knowledge",
  work_activity: "Work activity",
  contextual_knowledge: "Contextual workplace knowledge",
  supporting_evidence: "Supporting evidence",
};

const COMPONENT_LABELS: Record<string, string> = {
  knowledge: "Knowledge module",
  practical: "Practical skills module",
  workplace: "Work experience module",
  general: "Module",
};

/**
 * One curriculum line, opened.
 *
 * The answer to "how do I view these items?" - and the shape of the answer is
 * the point. A topic element is one sentence from a published curriculum
 * document; there is no more of it to read. What a person needs from it is
 * whether the provider has anything that teaches it and anything that tests
 * it, which is three separate records away on the qualification screen and is
 * gathered here instead.
 *
 * Read-only, and open to anybody who may read a course. A curriculum is
 * published by the QCTO: a facilitator being able to see what a module
 * requires is the ordinary case, not a privilege.
 */
export default async function TopicElementPage({
  params,
}: {
  params: Promise<{ id: string; elementId: string }>;
}) {
  const { id, elementId } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("course:read");

  let detail;
  try {
    detail = await topicElementDetail(session, id, elementId);
  } catch (error) {
    if (error instanceof TopicElementError) notFound();
    throw error;
  }

  const { element, topic, module, qualification, coverage, criteria } = detail;

  const position = detail.siblings.findIndex((one) => one.id === element.id);
  const previous = position > 0 ? detail.siblings[position - 1] : null;
  const next =
    position >= 0 && position < detail.siblings.length - 1
      ? detail.siblings[position + 1]
      : null;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href={`/qualifications/${qualification.id}`}
          className="text-sm text-[var(--muted)] underline-offset-2 hover:underline"
        >
          ← {qualification.title}
        </Link>

        <p className="mt-2 text-xs uppercase tracking-wide text-[var(--muted)]">
          {COMPONENT_LABELS[module.component] ?? "Module"}{" "}
          <span className="font-mono">{module.code}</span> · {module.title}
          {" · "}
          <span className="font-mono">{topic.code}</span> {topic.title}
        </p>

        <h1 className="mt-2 max-w-3xl text-xl font-semibold">
          <span className="font-mono text-base text-[var(--muted)]">
            {element.code}
          </span>{" "}
          {element.description}
        </h1>

        <p className="mt-1 text-sm text-[var(--muted)]">
          {ELEMENT_LABELS[element.kind] ?? element.kind}, exactly as the
          curriculum document words it. Nothing on this page may be edited here:
          a published curriculum is the QCTO&apos;s, not the provider&apos;s.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="What covers it"
          description="From the Curriculum Alignment Matrix, as the provider wrote it there."
        >
          {coverage.length === 0 ? (
            <div className="space-y-2 text-sm">
              <p style={{ color: "var(--danger)" }}>
                Nothing is recorded as covering this line.
              </p>
              <p className="text-[var(--muted)]">
                That is either a real gap in the programme or a matrix that has
                not been uploaded yet. Upload the Curriculum Alignment Matrix
                against this qualification and every line it names is filled in
                at once.
              </p>
            </div>
          ) : (
            <ul className="space-y-2 text-sm">
              {coverage.map((cover) => (
                <li key={cover.id}>
                  <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
                    {cover.kind.replace(/_/g, " ")}
                  </span>
                  <br />
                  {cover.document ? (
                    <Link
                      href={`/api/programme-documents/${cover.document.id}`}
                      className="underline"
                    >
                      {cover.reference}
                    </Link>
                  ) : (
                    <>
                      {cover.reference}{" "}
                      {/*
                        Said rather than left as a chip that does nothing when
                        clicked. A reference the platform cannot place is still
                        worth showing - it is what the provider planned - but
                        somebody checking coverage has to know the difference
                        between a document held here and a name in a
                        spreadsheet.
                      */}
                      <span className="text-xs text-[var(--muted)]">
                        — named in the matrix, but no document held here has
                        that name.
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="What it is assessed by"
          description="The internal assessment criteria of the topic this line belongs to."
        >
          {criteria.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--danger)" }}>
              This topic has no assessment criteria, so nothing here can ever be
              achieved. Until they are captured from the curriculum document,
              no learner can complete this module.
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {criteria.map((criterion) => (
                <li key={criterion.id}>
                  <span className="font-mono text-xs text-[var(--muted)]">
                    {criterion.code}
                  </span>{" "}
                  {criterion.description}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {detail.studyUnits.length > 0 ? (
        <div className="mt-4">
          <Card
            title="Where it is taught"
            description="The study units this module is delivered in."
          >
            <ul className="space-y-1 text-sm">
              {detail.studyUnits.map((unit) => (
                <li key={unit.id}>
                  <span className="font-mono text-xs text-[var(--muted)]">
                    {unit.code}
                  </span>{" "}
                  {unit.title}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {/* Walking the topic without going back to a long page and finding the
          place again. */}
      <div className="mt-6 flex flex-wrap justify-between gap-3 border-t border-[var(--border)] pt-4 text-sm">
        {previous ? (
          <Link
            href={`/qualifications/${qualification.id}/elements/${previous.id}`}
            className="max-w-sm underline-offset-2 hover:underline"
          >
            ← <span className="font-mono text-xs">{previous.code}</span>{" "}
            {previous.description}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/qualifications/${qualification.id}/elements/${next.id}`}
            className="max-w-sm text-right underline-offset-2 hover:underline"
          >
            <span className="font-mono text-xs">{next.code}</span>{" "}
            {next.description} →
          </Link>
        ) : (
          <span />
        )}
      </div>
    </AppShell>
  );
}
