import Link from "next/link";
import { pageT, requirePermission, requireTenant } from "@/lib/request";
import { listPeople, possibleLineManagers } from "@/lib/people";
import { maybe } from "@/lib/i18n/maybe";
import { AppShell, Card, StatusBadge } from "@/components/app-shell";
import { InviteForm } from "./invite-form";
import { RosterForm } from "./roster-form";
import { extensionOffered, extensionState } from "@/lib/extensions";
import { Card as UiCard } from "@/components/ui";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const { search } = await searchParams;
  const tenant = await requireTenant();
  const session = await requirePermission("user:read");
  const t = await pageT();

  // Read only so the roster form can say what an extension would add. Creating
  // people from a spreadsheet needs no extension and is offered either way.
  const extension = await extensionState(session);
  const mayUseExtension =
    extensionOffered() && session.permissions.includes("extension:use");

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
        <h1 className="text-xl font-semibold">{t("people.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          {t("people.intro", { provider: tenant.displayName })}
        </p>
      </div>

      {awaiting.length > 0 ? (
        <p className="mb-4 rounded-md border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/10 px-4 py-3 text-sm">
          <span className="font-medium">
            {awaiting.length === 1
              ? t("people.notEnrolledOne")
              : t("people.notEnrolledMany", { count: awaiting.length })}
          </span>{" "}
          {t("people.notEnrolledWhy")}
        </p>
      ) : null}

      {incomplete.length > 0 ? (
        <p className="mb-6 rounded-md border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/10 px-4 py-3 text-sm">
          <span className="font-medium">
            {incomplete.length === 1
              ? t("people.missingOne")
              : t("people.missingMany", { count: incomplete.length })}
          </span>{" "}
          {t("people.missingWhy")}
        </p>
      ) : null}

      <form method="get" className="mb-4 flex gap-2">
        <input
          name="search"
          defaultValue={search ?? ""}
          placeholder={t("people.search")}
          className="w-full max-w-sm rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium"
        >
          {t("people.searchButton")}
        </button>
        {search ? (
          <Link href="/people" className="px-2 py-2 text-sm text-[var(--muted)] hover:underline">
            {t("people.clear")}
          </Link>
        ) : null}
      </form>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-lg text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="pb-2 pr-4 font-medium">{t("people.name")}</th>
                <th className="pb-2 pr-4 font-medium">{t("people.roles")}</th>
                <th className="pb-2 pr-4 font-medium">{t("people.team")}</th>
                <th className="pb-2 pr-4 font-medium">{t("people.record")}</th>
                <th className="pb-2 font-medium">{t("people.status")}</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="py-2.5 pr-4">
                    <Link href={`/people/${person.id}`} className="font-medium hover:underline">
                      {person.firstName} {person.lastName}
                    </Link>
                    <span className="block text-xs text-[var(--muted)]">{person.email}</span>
                    {person.awaitingEnrolment ? (
                      <span className="mt-0.5 block text-xs text-[var(--brand-accent)]">
                        {t("people.notEnrolled")}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className="text-xs">
                      {person.roles.length === 0
                        ? "—"
                        : person.roles.map((role) => maybe(t, `role.${role}`) ?? role).join(", ")}
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
                      <span className="text-[var(--success)]">{t("people.complete")}</span>
                    ) : (
                      <span className="text-[var(--brand-accent)]">
                        {t("people.missing", { fields: person.missingForStatutory.join(", ") })}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5">
                    <StatusBadge
                      status={person.status}
                      label={maybe(t, `userStatus.${person.status}`) ?? undefined}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {canInvite ? (
        <div className="mt-6">
          <UiCard title={t("people.roster")} description={t("people.rosterIntro")}>
            <RosterForm
              extension={
                mayUseExtension
                  ? {
                      on: extension.on,
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
