import { verifyByReference } from "@/lib/certificates";
import { verifyStatement } from "@/lib/statement-of-results";
import { verifyBadge } from "@/lib/badges";
import { currentTenant, pageLocale } from "@/lib/request";
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
  const { t, dates } = await pageLocale();
  const day = (value: Date | null | undefined) => value?.toLocaleDateString(dates) ?? "";

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
          <h1 className="text-xl font-semibold">{t("verifyPage.title")}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">{t("verifyPage.intro")}</p>
        </div>

        <form
          method="get"
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6"
        >
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">{t("verifyPage.reference")}</span>
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
            {t("verifyPage.check")}
          </button>
        </form>

        {/*
          Shown whenever somebody has entered a reference, which is not what
          this used to do.
          
          The gate was `result`, and `result` is the certificate - so a
          Statement of Results reference produced no box at all. Not a wrong
          answer: no answer. Somebody at an assessment centre typed a valid
          reference off a learner's document and the page sat there as though
          they had not pressed the button, and the statement branch below could
          never run.

          A badge has its own box beneath this one, so it is the one case that
          keeps this hidden (`verifyBadge` returns null when there is none).
        */}
        {reference && !badge ? (
          <section
            className="mt-6 rounded-lg border-2 bg-[var(--surface)] p-6"
            style={{
              borderColor: (statement?.found ? statement : result)?.valid
                ? "var(--success)"
                : (statement?.found ?? result?.found)
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
                    {t("verifyPage.validStatement")}
                  </h2>
                  <p className="mt-2 text-sm text-[var(--muted)]">{t("verifyPage.validStatementNote")}</p>
                  <dl className="mt-4 space-y-2 text-sm">
                    <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                      <dt className="text-[var(--muted)]">{t("verifyPage.learner")}</dt>
                      <dd className="font-medium">{statement.learnerName}</dd>
                    </div>
                    <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                      <dt className="text-[var(--muted)]">{t("verifyPage.qualification")}</dt>
                      <dd>{statement.qualificationTitle}</dd>
                    </div>
                    <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                      <dt className="text-[var(--muted)]">{t("verifyPage.issuedBy")}</dt>
                      <dd>{statement.issuedBy}</dd>
                    </div>
                    <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                      <dt className="text-[var(--muted)]">{t("verifyPage.issuedOn")}</dt>
                      <dd>{day(statement.issuedAt)}</dd>
                    </div>
                    <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                      <dt className="text-[var(--muted)]">{t("verifyPage.modules")}</dt>
                      <dd>{t("verifyPage.competentModules", { count: statement.moduleCount ?? 0 })}</dd>
                    </div>
                  </dl>
                </>
              ) : statement.revokedAt ? (
                <>
                  <h2 className="font-semibold" style={{ color: "var(--danger)" }}>
                    {t("verifyPage.statementWithdrawn")}
                  </h2>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    {t("verifyPage.withdrawnOn", { date: day(statement.revokedAt) })} {statement.revokedReason}
                  </p>
                  <p className="mt-2 text-sm text-[var(--muted)]">{t("verifyPage.doNotAccept")}</p>
                </>
              ) : (
                /*
                  Expiry is not withdrawal, and saying "withdrawn" for a
                  statement nobody withdrew accuses a learner of something that
                  did not happen. A Statement of Results stands for two years
                  from issue - the QCTO's own rule - and then simply runs out.
                */
                <>
                  <h2 className="font-semibold" style={{ color: "var(--danger)" }}>
                    {t("verifyPage.statementExpired")}
                  </h2>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    {t("verifyPage.expiredNote", {
                      issued: day(statement.issuedAt),
                      expired: day(statement.validUntil),
                    })}
                  </p>
                  <p className="mt-2 text-sm text-[var(--muted)]">{t("verifyPage.expiredNote2")}</p>
                </>
              )
            ) : !result?.found ? (
              <>
                <h2 className="font-semibold">{t("verifyPage.notFound")}</h2>
                <p className="mt-2 text-sm text-[var(--muted)]">{t("verifyPage.notFoundNote")}</p>
              </>
            ) : result?.valid ? (
              <>
                <h2
                  className="font-semibold"
                  style={{ color: "var(--success)" }}
                >
                  {t("verifyPage.valid")}
                </h2>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                    <dt className="text-[var(--muted)]">{t("verifyPage.awardedTo")}</dt>
                    <dd className="font-medium">{result.holderName}</dd>
                  </div>
                  <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                    <dt className="text-[var(--muted)]">{t("verifyPage.for")}</dt>
                    <dd>{result.title}</dd>
                  </div>
                  <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                    <dt className="text-[var(--muted)]">{t("verifyPage.issuedBy")}</dt>
                    <dd>{result.issuedBy}</dd>
                  </div>
                  <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                    <dt className="text-[var(--muted)]">{t("verifyPage.issuedOn")}</dt>
                    <dd>{day(result.issuedAt)}</dd>
                  </div>
                </dl>

                {result.competencies && result.competencies.length > 0 ? (
                  <>
                    <p className="mt-5 text-sm font-medium">{t("verifyPage.competencies")}</p>
                    <ul className="mt-2 space-y-1">
                      {result.competencies.map((competency) => (
                        <li key={competency.code} className="text-sm">
                          <span className="font-medium">{competency.code}</span>{" "}
                          {competency.name}
                          {competency.level ? ` · ${competency.level}` : ""}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <h2 className="font-semibold" style={{ color: "var(--danger)" }}>
                  {t("verifyPage.certificateWithdrawn")}
                </h2>
                <p className="mt-2 text-sm">
                  {t("verifyPage.withdrawnDetail", {
                    holder: result.holderName ?? "",
                    title: result.title ?? "",
                    date: day(result.revokedAt),
                  })}
                </p>
                {result.revokedReason ? (
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    {t("verifyPage.reason", { reason: result.revokedReason })}
                  </p>
                ) : null}
                <p className="mt-3 text-sm">{t("verifyPage.notRely")}</p>
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
                <dt className="text-[var(--muted)]">{t("verifyPage.heldBy")}</dt>
                <dd className="font-medium">{badge.holderName}</dd>
              </div>
              <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                <dt className="text-[var(--muted)]">{t("verifyPage.earnedOn")}</dt>
                <dd>{badge.earnedOn}</dd>
              </div>
              {badge.description ? (
                <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                  <dt className="text-[var(--muted)]">{t("verifyPage.for")}</dt>
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
              {t("verifyPage.badgeNote")}
            </p>
          </section>
        ) : null}
      </div>
    </main>
  );
}
