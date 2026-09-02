import { verifyByReference } from "@/lib/certificates";
import { verifyStatement } from "@/lib/statement-of-results";
import { verifyBadge } from "@/lib/badges";
import { currentTenant } from "@/lib/request";
import { referencePrefix } from "@/lib/platform";

/**
 * Public certificate verification.
 *
 * Deliberately outside the signed-in area: the people who most need to check a
 * certificate — an employer, a SETA, a client's compliance officer — will
 * never have an account here. It asks for nothing but the printed reference
 * and reveals nothing beyond what is printed on the certificate.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string }>;
}) {
  const { reference } = await searchParams;
  const tenant = await currentTenant();

  // Certificates and Statements of Results share one reference format and one
  // check, because whoever holds a printed reference has no reason to know
  // which kind of document it came from. A certificate attests to what somebody
  // achieved; a statement admits them to the EISA. Both are checked here.
  const certificate = reference ? await verifyByReference(reference) : null;
  const statement =
    reference && !certificate?.found ? await verifyStatement(reference) : null;

  const result = certificate?.found ? certificate : null;

  // A badge, if the reference is one. Checked last and in the same box because
  // whoever holds a reference has no reason to know which kind of thing it
  // came from - and a badge reference looks like the others.
  const badge =
    reference && !certificate?.found && !statement?.found
      ? await verifyBadge(reference)
      : null;

  return (
    <main
      className="flex min-h-screen items-start justify-center px-4 py-16"
      style={
        tenant
          ? ({
              "--brand-primary": tenant.primaryColour,
              "--brand-accent": tenant.accentColour,
            } as React.CSSProperties)
          : undefined
      }
    >
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <div
            className="mx-auto mb-4 h-1 w-12 rounded-full"
            style={{ background: "var(--brand-accent)" }}
          />
          <h1 className="text-xl font-semibold">Verify a certificate</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Enter the reference printed on the certificate. No account is
            needed.
          </p>
        </div>

        <form
          method="get"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6"
        >
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">
              Verification reference
            </span>
            <input
              name="reference"
              defaultValue={reference ?? ""}
              placeholder={`${referencePrefix()}-XXXXX-XXXXX-XXXXX-XXXXX`}
              className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 font-mono text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30"
            />
          </label>

          <button
            type="submit"
            className="mt-4 w-full rounded-md px-4 py-2.5 text-sm font-semibold text-white"
            style={{ background: "var(--brand-primary)" }}
          >
            Check this certificate
          </button>
        </form>

        {result ? (
          <section
            className="mt-6 rounded-lg border-2 bg-[var(--surface)] p-6"
            style={{
              borderColor: result.valid
                ? "var(--success)"
                : result.found
                  ? "var(--danger)"
                  : "var(--border)",
            }}
            aria-live="polite"
          >
            {statement?.found ? (
              statement.valid ? (
                <>
                  <h2
                    className="font-semibold"
                    style={{ color: "var(--success)" }}
                  >
                    Valid Statement of Results
                  </h2>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    This learner has achieved every internal assessment
                    criterion for the qualification below and may be entered for
                    the External Integrated Summative Assessment.
                  </p>
                  <dl className="mt-4 space-y-2 text-sm">
                    <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                      <dt className="text-[var(--muted)]">Learner</dt>
                      <dd className="font-medium">{statement.learnerName}</dd>
                    </div>
                    <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                      <dt className="text-[var(--muted)]">Qualification</dt>
                      <dd>{statement.qualificationTitle}</dd>
                    </div>
                    <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                      <dt className="text-[var(--muted)]">Issued by</dt>
                      <dd>{statement.issuedBy}</dd>
                    </div>
                    <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                      <dt className="text-[var(--muted)]">Issued on</dt>
                      <dd>{statement.issuedAt?.toLocaleDateString("en-ZA")}</dd>
                    </div>
                    <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                      <dt className="text-[var(--muted)]">Modules</dt>
                      <dd>{statement.moduleCount} recorded as competent</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <>
                  <h2 className="font-semibold" style={{ color: "var(--danger)" }}>
                    Statement of Results withdrawn
                  </h2>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    Withdrawn on{" "}
                    {statement.revokedAt?.toLocaleDateString("en-ZA")}.{" "}
                    {statement.revokedReason}
                  </p>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    Do not accept this document. Contact the provider named on
                    it if the learner believes this is a mistake.
                  </p>
                </>
              )
            ) : !result?.found ? (
              <>
                <h2 className="font-semibold">No certificate found</h2>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  No certificate carries that reference. Check it against the
                  document — the characters I, L, O, U, 0 and 1 are never used,
                  so a 1 is a 7 or a J, and an O is a Q or a D.
                </p>
              </>
            ) : result.valid ? (
              <>
                <h2
                  className="font-semibold"
                  style={{ color: "var(--success)" }}
                >
                  Valid certificate
                </h2>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                    <dt className="text-[var(--muted)]">Awarded to</dt>
                    <dd className="font-medium">{result.holderName}</dd>
                  </div>
                  <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                    <dt className="text-[var(--muted)]">For</dt>
                    <dd>{result.title}</dd>
                  </div>
                  <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                    <dt className="text-[var(--muted)]">Issued by</dt>
                    <dd>{result.issuedBy}</dd>
                  </div>
                  <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                    <dt className="text-[var(--muted)]">Issued on</dt>
                    <dd>{result.issuedAt?.toLocaleDateString("en-ZA")}</dd>
                  </div>
                </dl>

                {result.competencies && result.competencies.length > 0 ? (
                  <>
                    <p className="mt-5 text-sm font-medium">
                      Competencies attested
                    </p>
                    <ul className="mt-2 space-y-1">
                      {result.competencies.map((competency) => (
                        <li key={competency.code} className="text-sm">
                          <span className="font-medium">{competency.code}</span>{" "}
                          {competency.name}
                          {competency.level ? ` — ${competency.level}` : ""}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <h2 className="font-semibold" style={{ color: "var(--danger)" }}>
                  This certificate was withdrawn
                </h2>
                <p className="mt-2 text-sm">
                  It was issued to {result.holderName} for {result.title}, and
                  withdrawn on {result.revokedAt?.toLocaleDateString("en-ZA")}.
                </p>
                {result.revokedReason ? (
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    Reason given: {result.revokedReason}
                  </p>
                ) : null}
                <p className="mt-3 text-sm">
                  It should not be relied on.
                </p>
              </>
            )}
          </section>
        ) : null}

        {badge ? (
          <section
            className="mt-6 rounded-lg border-2 bg-[var(--surface)] p-6"
            style={{ borderColor: "var(--success)" }}
            aria-live="polite"
          >
            <h2 className="font-semibold" style={{ color: "var(--success)" }}>
              <span className="mr-2" aria-hidden>
                {badge.glyph}
              </span>
              {badge.name}
            </h2>

            <dl className="mt-4 space-y-2 text-sm">
              <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                <dt className="text-[var(--muted)]">Held by</dt>
                <dd className="font-medium">{badge.holderName}</dd>
              </div>
              <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                <dt className="text-[var(--muted)]">Earned on</dt>
                <dd>{badge.earnedOn}</dd>
              </div>
              {badge.description ? (
                <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                  <dt className="text-[var(--muted)]">For</dt>
                  <dd>{badge.description}</dd>
                </div>
              ) : null}
            </dl>

            {/*
              Said plainly, and it is the most important sentence on the page.
              A badge that reads like a certificate to an employer is the one
              way this becomes a liability for the provider.
            */}
            <p className="mt-4 border-t border-[var(--border)] pt-3 text-sm text-[var(--muted)]">
              This is a provider&rsquo;s own record that the holder completed
              this module of study. It is not a national qualification, carries
              no credits, and is not awarded by a quality council. A
              qualification is verified by its own certificate reference.
            </p>
          </section>
        ) : null}
      </div>
    </main>
  );
}
