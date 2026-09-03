import Link from "next/link";
import { requirePermission, requireTenant } from "@/lib/request";
import { listPeople, possibleLineManagers } from "@/lib/people";
import { AppShell, Card, StatusBadge } from "@/components/app-shell";
import { InviteForm } from "./invite-form";
import { RosterForm } from "./roster-form";
import { extensionState } from "@/lib/extensions";
import { Card as UiCard } from "@/components/ui";

const ROLE_LABELS: Record<string, string> = {
  platform_owner: "Platform Owner",
  tenant_admin: "Administrator",
  instructor: "Instructor",
  assessor: "Assessor",
  moderator: "Moderator",
  line_manager: "Line Manager",
  learner: "Learner",
  skills_development_facilitator: "SDF",
  external_verifier: "External Verifier",
  workplace_coach: "Workplace Coach",
};

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const { search } = await searchParams;
  const tenant = await requireTenant();
  const session = await requirePermission("user:read");

  // Read only so the roster form can say what an extension would add. Creating
  // people from a spreadsheet needs no extension and is offered either way.
  const extension = await extensionState(session);
  const mayUseExtension = session.permissions.includes("extension:use");

  const [people, managers] = await Promise.all([
    listPeople(session, { search }),
    possibleLineManagers(session),
  ]);

  const canInvite = session.permissions.includes("user:invite");
  const canManageRoles = session.permissions.includes("user:manage_roles");
  const incomplete = people.filter(
    (person) =>
      person.status === "active" && person.missingForStatutory.length > 0,
  );
  const awaiting = people.filter((person) => person.awaitingEnrolment);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">People</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Everyone in {tenant.displayName}, their roles, and whether their
          record carries what a statutory return needs.
        </p>
      </div>

      {awaiting.length > 0 ? (
        <p className="mb-4 rounded-md border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/10 px-4 py-3 text-sm">
          <span className="font-medium">
            {awaiting.length}{" "}
            {awaiting.length === 1 ? "learner is" : "learners are"} not enrolled
            on anything.
          </span>{" "}
          Being a learner grants no access on its own, so they sign in to an
          empty screen. Enrol them on a course, add them to a cohort, or assign
          a programme.
        </p>
      ) : null}

      {incomplete.length > 0 ? (
        <p className="mb-6 rounded-md border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/10 px-4 py-3 text-sm">
          <span className="font-medium">
            {incomplete.length}{" "}
            {incomplete.length === 1 ? "person is" : "people are"} missing
            details a SETA or SAQA return needs.
          </span>{" "}
          They are marked below. Filling them in now is far easier than the
          night before a submission.
        </p>
      ) : null}

      <form method="get" className="mb-4 flex gap-2">
        <input
          name="search"
          defaultValue={search ?? ""}
          placeholder="Search by name or email"
          className="w-full max-w-sm rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium"
        >
          Search
        </button>
        {search ? (
          <Link
            href="/people"
            className="px-2 py-2 text-sm text-[var(--muted)] hover:underline"
          >
            Clear
          </Link>
        ) : null}
      </form>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-lg text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Roles</th>
                <th className="pb-2 pr-4 font-medium">Team</th>
                <th className="pb-2 pr-4 font-medium">Record</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr
                  key={person.id}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="py-2.5 pr-4">
                    <Link
                      href={`/people/${person.id}`}
                      className="font-medium hover:underline"
                    >
                      {person.firstName} {person.lastName}
                    </Link>
                    <span className="block text-xs text-[var(--muted)]">
                      {person.email}
                    </span>
                    {person.awaitingEnrolment ? (
                      <span className="mt-0.5 block text-xs text-[var(--brand-accent)]">
                        Not enrolled on anything
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="text-xs">
                      {person.roles.length === 0
                        ? "—"
                        : person.roles
                            .map((role) => ROLE_LABELS[role] ?? role)
                            .join(", ")}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-xs text-[var(--muted)]">
                    {person.team ?? "—"}
                    {person.site ? ` · ${person.site}` : ""}
                  </td>
                  <td className="py-2.5 pr-4 text-xs">
                    {person.status !== "active" ? (
                      <span className="text-[var(--muted)]">—</span>
                    ) : person.missingForStatutory.length === 0 ? (
                      <span className="text-[var(--success)]">Complete</span>
                    ) : (
                      <span className="text-[var(--brand-accent)]">
                        Missing {person.missingForStatutory.join(", ")}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5">
                    <StatusBadge status={person.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {canInvite ? (
        <div className="mt-6">
          <UiCard
            title="Add a cohort from a spreadsheet"
            description="Read a CSV or Excel file of learners and create them all at once. It shows you what it made of the file before anybody is created."
          >
            <RosterForm
              extension={
                mayUseExtension
                  ? {
                      enabled: extension.enabled,
                      available: extension.availability?.available ?? false,
                    }
                  : null
              }
            />
          </UiCard>
        </div>
      ) : null}

      {canInvite ? (
        <div className="mt-6">
          <InviteForm
            canManageRoles={canManageRoles}
            managers={managers.map((manager) => ({
              id: manager.id,
              label: `${manager.firstName} ${manager.lastName}`,
            }))}
          />
        </div>
      ) : null}
    </AppShell>
  );
}
