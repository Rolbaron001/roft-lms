import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import {
  getPerson,
  PeopleError,
  possibleLineManagers,
  proposeMailboxAddress,
  takenMailboxAddresses,
} from "@/lib/people";
import { mailDomainFor } from "@/lib/mail";
import { AppShell, StatusBadge } from "@/components/app-shell";
import { PersonEditor } from "./person-editor";

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requirePermission("user:read");

  let detail;
  try {
    detail = await getPerson(session, id);
  } catch (error) {
    if (error instanceof PeopleError && error.code === "not_found") notFound();
    throw error;
  }

  const managers = await possibleLineManagers(session, id);
  const { person } = detail;

  // The domain a tenant's mailboxes live on. ROFT's own people sit on the
  // mail domain itself; a client's sit on a subdomain of it, so an address
  // plainly belongs to that client rather than to ROFT.
  const mailDomain = mailDomainFor(tenant.slug);
  const proposedMailbox = proposeMailboxAddress(
    person.firstName,
    person.lastName,
    mailDomain,
    await takenMailboxAddresses(session),
  );
  const isSelf = person.id === session.userId;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link
          href="/people"
          className="text-sm text-[var(--muted)] hover:underline"
        >
          ← All people
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">
              {person.firstName} {person.lastName}
            </h1>
            <p className="mt-0.5 text-sm text-[var(--muted)]">
              {person.email}
              {person.lastLoginAt
                ? ` · last signed in ${person.lastLoginAt.toLocaleDateString("en-ZA")}`
                : " · has not signed in yet"}
            </p>
          </div>
          <StatusBadge status={person.status} />
        </div>

        <p className="mt-3 text-sm text-[var(--muted)]">
          {detail.enrolmentCount}{" "}
          {detail.enrolmentCount === 1 ? "course" : "courses"} ·{" "}
          {detail.certificateCount}{" "}
          {detail.certificateCount === 1 ? "certificate" : "certificates"}
        </p>
      </div>

      {person.status === "anonymised" ? (
        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="font-medium">This record was anonymised</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            The personal details were erased on{" "}
            {person.anonymisedAt?.toLocaleDateString("en-ZA")} at the person&rsquo;s
            request. Their {detail.certificateCount}{" "}
            {detail.certificateCount === 1 ? "certificate remains" : "certificates remain"}{" "}
            valid and verifiable, because a qualification once earned has to
            stay on the national record.
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Nothing here can be edited.
          </p>
        </section>
      ) : (
        <PersonEditor
          userId={person.id}
          isSelf={isSelf}
          mailboxAddress={person.mailboxAddress}
          proposedMailbox={proposedMailbox}
          status={person.status}
          surname={person.lastName}
          defaults={{
            email: person.email,
            firstName: person.firstName,
            lastName: person.lastName,
            jobTitle: person.jobTitle,
            team: person.team,
            site: person.site,
            lineManagerId: person.lineManagerId,
            ofoCode: person.ofoCode,
            nationalId: person.nationalId,
            gender: person.gender,
            equityCode: person.equityCode,
            disabilityCode: person.disabilityCode,
            nationality: person.nationality,
          }}
          roles={detail.roles.map((row) => row.role)}
          registrationNumbers={Object.fromEntries(
            detail.roles.map((row) => [row.role, row.registrationNumber]),
          )}
          managers={managers.map((manager) => ({
            id: manager.id,
            label: `${manager.firstName} ${manager.lastName}`,
          }))}
          canManageRoles={session.permissions.includes("user:manage_roles")}
          canAnonymise={session.permissions.includes("user:anonymise")}
        />
      )}
    </AppShell>
  );
}
