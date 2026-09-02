import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import { RegistrationError, registrationList } from "@/lib/eisa-registration";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui";

/**
 * The registration list for one cohort.
 *
 * Shows everybody, ready or not. A list of only the ready ones answers "who do
 * I enter" and hides the more useful question, which is who is one criterion
 * short and could still make the deadline if somebody moved this week.
 *
 * The file that goes to the quality partner carries only the ready ones.
 */
export default async function EisaCohortPage({
  params,
  searchParams,
}: {
  params: Promise<{ cohortId: string }>;
  searchParams: Promise<{ sitting?: string }>;
}) {
  const { cohortId } = await params;
  const { sitting } = await searchParams;
  const tenant = await requireTenant();
  const session = await requirePermission("enrolment:read_all");

  let list;
  try {
    list = await registrationList(session, cohortId);
  } catch (error) {
    if (error instanceof RegistrationError) notFound();
    throw error;
  }

  const ready = list.candidates.filter((row) => row.ready);
  const notReady = list.candidates.filter((row) => !row.ready);
  const missingId = ready.filter((row) => !row.nationalId);

  return (
    <AppShell tenant={tenant} session={session}>
      <Link href="/eisa" className="text-sm text-[var(--muted)] hover:underline">
        ← Back to external assessment
      </Link>

      <h1 className="mt-2 text-xl font-semibold">{list.cohortName}</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {list.qualificationTitle ?? "No qualification on these enrolments"} ·{" "}
        {ready.length} of {list.candidates.length} ready
      </p>

      {missingId.length > 0 ? (
        <div className="mt-6">
          <Card
            title={`${missingId.length} without an identity number`}
            description="Every quality partner asks for one, and a registration returned for a missing number costs a cycle. Better found now than after the file is sent."
          >
            <p className="text-sm">
              {missingId
                .map((row) => `${row.firstName} ${row.lastName}`)
                .join(", ")}
            </p>
          </Card>
        </div>
      ) : null}

      <div className="mt-6">
        <Card
          title="Ready to be entered"
          description="Every criterion in every module met, whether taught or recognised through prior learning."
        >
          {ready.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              Nobody yet. The list below says how far each of them has to go.
            </p>
          ) : (
            <>
              <ul className="space-y-1 text-sm">
                {ready.map((row) => (
                  <li key={row.userId}>
                    <Link
                      href={`/people/${row.userId}`}
                      className="hover:underline"
                    >
                      {row.lastName}, {row.firstName}
                    </Link>
                    <span className="ml-2 text-[var(--muted)]">
                      {row.nationalId ?? "no identity number"}
                    </span>
                  </li>
                ))}
              </ul>

              <a
                href={`/eisa/${cohortId}/export${sitting ? `?sitting=${sitting}` : ""}`}
                className="mt-4 inline-block rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white"
              >
                Download the registration file
              </a>
            </>
          )}
        </Card>
      </div>

      {notReady.length > 0 ? (
        <div className="mt-6">
          <Card
            title="Not ready"
            description="How far each has to go. Somebody one criterion short can still make the deadline if it is noticed this week."
          >
            <ul className="space-y-1 text-sm">
              {[...notReady]
                .sort((a, b) => a.outstanding - b.outstanding)
                .map((row) => (
                  <li key={row.userId}>
                    <Link
                      href={`/people/${row.userId}`}
                      className="hover:underline"
                    >
                      {row.lastName}, {row.firstName}
                    </Link>
                    <span className="ml-2 tabular-nums text-[var(--muted)]">
                      {row.percent}% · {row.outstanding} outstanding
                    </span>
                  </li>
                ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}
