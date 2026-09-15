import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
import { canAny } from "@/lib/rbac";
import { listTemplates } from "@/lib/document-templates";
import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KIND_NOTES,
} from "@/lib/document-fields";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";
import { TemplateForm } from "../settings/template-form";

/**
 * The documents this provider produces, and how each one reads.
 *
 * Roland, 15 September: a proper place for the templates "held inside the
 * system, but exported to clients, learners, other role-players".
 *
 * They were already editable, inside Settings, underneath the branding and the
 * clock. That is not where anybody looks for the layout of a Statement of
 * Results, and being reachable is not the same as being findable - which was
 * the substance of the concern.
 *
 * Its own screen, so each document can say what it is for, who receives it and
 * whether this provider has written their own version yet. The editor itself is
 * the same component Settings used, because the job has not changed - only
 * where somebody goes to do it.
 */
export default async function TemplatesPage() {
  const tenant = await requireTenant();
  const session = await requireSession();

  if (!canAny(session, ["tenant:manage_branding", "tenant:manage_settings"])) {
    redirect("/not-permitted");
  }

  const templates = await listTemplates(session);

  /** Who each document actually goes to, which is the point of having one. */
  const goesTo: Record<string, string> = {
    statement_of_results:
      "The learner, who carries it to the assessment centre with their identity document.",
    certificate: "The learner, and whoever they show it to.",
    workplace_statement:
      "The learner's file, signed by a coach at the host employer.",
    enrolment_form:
      "Filed as evidence, and handed to a QCTO monitor on a visit.",
  };

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Templates</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          The documents {tenant.displayName} produces. How each one reads and
          looks is yours: write your own version and the platform produces it
          from that instead of its own layout. What a regulator requires is
          added after yours and cannot be edited, because that part is not the
          provider&rsquo;s to change.
        </p>
      </div>

      {/* What exists, and whether this provider has taken it over yet. */}
      <div className="mb-6">
        <Card
          title="What the platform produces"
          description="Anything without your own version uses the platform's layout, which is a working document rather than a placeholder."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="py-2 pr-4 font-medium">Document</th>
                  <th className="py-2 pr-4 font-medium">Who gets it</th>
                  <th className="py-2 font-medium">Layout</th>
                </tr>
              </thead>
              <tbody>
                {DOCUMENT_KINDS.map((kind) => {
                  const own = templates.find(
                    (row) => row.kind === kind && row.status === "active",
                  );

                  return (
                    <tr key={kind} className="border-b border-[var(--border)]">
                      <td className="py-2 pr-4">
                        <span className="font-medium">
                          {DOCUMENT_KIND_LABELS[kind]}
                        </span>
                        <span className="block text-xs text-[var(--muted)]">
                          {DOCUMENT_KIND_NOTES[kind]}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-[var(--muted)]">
                        {goesTo[kind] ?? ""}
                      </td>
                      <td className="py-2">
                        {own ? (
                          <span style={{ color: "var(--success)" }}>
                            Yours
                          </span>
                        ) : (
                          <span className="text-[var(--muted)]">
                            The platform&rsquo;s
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="mb-6">
        <Card
          title="Write your own"
          description="Start from the platform's layout and edit it down into yours. Every field the document can carry is listed beside the editor with a real example of what it looks like."
        >
          <TemplateForm templates={templates} />
        </Card>
      </div>

      {/*
        The documents a provider supplies rather than lays out. Named here
        because somebody looking for "templates" will look here for all of
        them, and finding only half is worse than a signpost.
      */}
      <Card
        title="Documents you supply rather than lay out"
        description="Not every document is a template the platform fills in."
      >
        <ul className="space-y-2 text-sm">
          <li>
            <Link href="/records" className="underline underline-offset-2">
              Policies and contracts
            </Link>
            <span className="text-[var(--muted)]">
              {" "}
              — your accreditation letter, policies and agreements, uploaded and
              retained rather than generated.
            </span>
          </li>
          <li>
            <Link href="/fisa" className="underline underline-offset-2">
              FISA instruments
            </Link>
            <span className="text-[var(--muted)]">
              {" "}
              — written by your own examiner and moderated before anybody sits
              them, so they are authored rather than templated.
            </span>
          </li>
          <li>
            <Link href="/qualifications" className="underline underline-offset-2">
              Curriculum documents
            </Link>
            <span className="text-[var(--muted)]">
              {" "}
              — the published qualification documents the platform reads to
              build a curriculum from.
            </span>
          </li>
        </ul>
      </Card>
    </AppShell>
  );
}
