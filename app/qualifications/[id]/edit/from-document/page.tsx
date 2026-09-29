import Link from "next/link";
import { pageT, requirePermission, requireTenant, said } from "@/lib/request";
import { proposalForQualification } from "@/lib/curriculum-from-document";
import { AppShell, Card } from "@/components/app-shell";
import { AcceptModule } from "./accept-module";

/**
 * What the curriculum document appears to say.
 *
 * Everything on this page is a proposal. Nothing has been written, and nothing
 * will be until somebody presses the button on a module — one module at a
 * time, deliberately. A single "import all" button on a fifteen-module
 * document is one nobody can check before pressing, and an unchecked
 * curriculum is worse than a blank one: it looks finished.
 */
export default async function FromDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("qualification:manage");
  const t = await pageT();

  const proposal = await said(await proposalForQualification(session, id));

  const waiting = proposal.modules.filter((module) => !module.present);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href={`/qualifications/${id}/edit`}
          className="text-sm text-[var(--muted)] hover:underline"
        >
          {t("takeDoc.back")}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{t("takeDoc.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          {proposal.document
            ? t("takeDoc.readFrom", { file: proposal.document.filename })
            : t("takeDoc.nothingRead")}
        </p>
      </div>

      {proposal.blocked ? (
        <Card title={t("takeDoc.nothing")}>
          <p className="text-sm">{proposal.blocked}</p>
          <Link
            href={`/qualifications/${id}`}
            className="mt-3 inline-block text-sm underline underline-offset-2"
          >
            {t("takeDoc.goToDocuments")}
          </Link>
        </Card>
      ) : null}

      {proposal.notes.length > 0 ? (
        <div className="mb-6">
          <Card
            title={t("takeDoc.notes", { count: proposal.notes.length })}
            description={t("takeDoc.notesNote")}
          >
            <ul className="space-y-1 text-sm text-[var(--muted)]">
              {proposal.notes.map((note, index) => (
                <li key={index}>· {note}</li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {proposal.modules.length > 0 ? (
        <>
          <p className="mb-3 text-sm text-[var(--muted)]">
            {t("takeDoc.read", { count: proposal.modules.length })}
            {waiting.length < proposal.modules.length
              ? ` · ${t("takeDoc.already", { count: proposal.modules.length - waiting.length })}`
              : ""}
          </p>

          <div className="space-y-3">
            {proposal.modules.map((module) => (
              <AcceptModule
                key={module.code}
                qualificationId={id}
                module={{
                  code: module.code,
                  component: module.component,
                  title: module.title,
                  credits: module.credits,
                  present: module.present,
                  topicCount: module.topicCount,
                  elementCount: module.elementCount,
                  criterionCount: module.criterionCount,
                  topics: module.topics.map((topic) => ({
                    code: topic.code,
                    title: topic.title,
                    weightPercent: topic.weightPercent,
                    elements: topic.elements.map((element) => ({
                      code: element.code,
                      kind: element.kind,
                      description: element.description,
                    })),
                    criteria: topic.criteria.map((criterion) => ({
                      code: criterion.code,
                      description: criterion.description,
                    })),
                  })),
                }}
              />
            ))}
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
