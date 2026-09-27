import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
import {
  certificateTemplateValues,
  CertificateError,
  getCertificate,
} from "@/lib/certificates";
import {
  activeTemplate,
  fillTemplate,
  providerDetails,
} from "@/lib/document-templates";
import { AppShell } from "@/components/app-shell";
import { TenantLogo } from "@/components/tenant-logo";
import { PrintButton } from "@/components/print-button";
import { WithdrawDocument } from "@/components/withdraw-document";
import { withdrawCertificateAction } from "./actions";
import { translator } from "@/lib/i18n";
import { dateLocale, localeFor } from "@/lib/i18n/locales";

export default async function CertificatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();

  // Issuing and withdrawing are the same responsibility. A learner looking at
  // their own certificate sees neither control.
  const mayWithdraw = session.permissions.includes("certificate:issue");

  let detail;
  try {
    detail = await getCertificate(session, id);
  } catch (error) {
    if (error instanceof CertificateError) {
      if (error.code === "not_permitted") redirect("/not-permitted");
      notFound();
    }
    throw error;
  }

  const { certificate, holder } = detail;
  const revoked = certificate.revokedAt !== null;

  // The page around the certificate speaks to whoever is reading it. The
  // certificate itself is its holder's document, and is in their language
  // whoever prints it: a facilitator printing it for a learner hands over the
  // learner's certificate, not one in the facilitator's language.
  const readerLocale = localeFor(tenant, session);
  const t = translator(readerLocale);
  const documentLocale = localeFor(tenant, holder);
  const doc = translator(documentLocale);
  // Written out, "27 September 2026": a document handed to an employer should
  // not leave anyone guessing which number is the month.
  const docDate = (date: Date) =>
    date.toLocaleDateString(dateLocale(documentLocale), { day: "numeric", month: "long", year: "numeric" });

  /**
   * The provider's own layout, where they have one.
   *
   * Their logo stays above it either way. A template is plain text, so it
   * cannot carry an image - and a letterhead is the main reason a provider
   * wants their own document in the first place, so the platform supplies it
   * from their branding rather than making them do without.
   */
  const template = await activeTemplate(session, "certificate");
  const rendered = template
    ? fillTemplate(
        template.body,
        certificateTemplateValues({
          certificate,
          holder,
          provider: await providerDetails(session),
        }),
      )
    : null;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link href="/" className="text-sm text-[var(--muted)] hover:underline">
          {t("cert.back")}
        </Link>
      </div>

      {revoked ? (
        <p className="mb-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-4 py-3 text-sm text-[var(--danger)]">
          {t("cert.withdrawn", {
            date: certificate.revokedAt!.toLocaleDateString(dateLocale(readerLocale)),
          })}{" "}
          {certificate.revokedReason}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-start justify-end gap-3 print:hidden">
        {mayWithdraw && !certificate.revokedAt ? (
          <WithdrawDocument
            action={withdrawCertificateAction}
            idName="certificateId"
            idValue={certificate.id}
            what={t("certAdmin.withdrawWhat")}
            consequence={t("certAdmin.withdrawConsequence")}
          />
        ) : null}
        <PrintButton label={t("cert.print")} />
      </div>

      {/* The certificate itself. Kept plain so it prints sensibly. */}
      <article
        className={`rounded-lg border-2 bg-[var(--surface)] p-10 text-center ${
          revoked ? "opacity-60" : ""
        }`}
        style={{ borderColor: "var(--brand-accent)" }}
      >
        {tenant.logoUrl ? (
          <div className="mb-6 flex justify-center">
            <TenantLogo
              logoUrl={tenant.logoUrl}
              displayName={tenant.displayName}
              height={64}
            />
          </div>
        ) : null}

        {rendered !== null ? (
          <div className="whitespace-pre-wrap text-left text-sm">{rendered}</div>
        ) : (
          <>
        <p
          className="text-xs font-semibold uppercase tracking-[0.2em]"
          style={{ color: "var(--brand-accent)" }}
        >
          {tenant.displayName}
        </p>

        {/*
          "Certificate of Completion", not "of Competence".
          
          A certificate here is issued for one of the provider's own courses,
          which the provider is entitled to certify. "Certificate of Competence"
          is the OQSF's term for the certificate the QCTO issues through SAQA
          for an occupational qualification, and a provider issuing a document
          under that name invites a learner to believe they hold something they
          do not. The competencies below are still named, because that is what
          was actually assessed and it is the useful part.
        */}
        <h1 className="mt-6 text-sm uppercase tracking-widest text-[var(--muted)]">
          {doc("cert.title")}
        </h1>

        <p className="mt-6 text-sm text-[var(--muted)]">
          {doc("cert.certifies")}
        </p>
        <p className="mt-2 text-2xl font-semibold">
          {holder.firstName} {holder.lastName}
        </p>

        <p className="mt-6 text-sm text-[var(--muted)]">
          {doc("cert.completed")}
        </p>
        <p className="mt-2 text-lg font-medium">{certificate.title}</p>

        {certificate.competenciesAttested.length > 0 ? (
          <>
            <p className="mt-8 text-sm text-[var(--muted)]">
              {doc("cert.attesting")}
            </p>
            <ul className="mx-auto mt-3 max-w-md space-y-1 text-left">
              {certificate.competenciesAttested.map((competency) => (
                <li key={competency.code} className="text-sm">
                  <span className="font-medium">{competency.code}</span>{" "}
                  {competency.name}
                  {competency.level ? (
                    <span className="text-[var(--muted)]">
                      {" "}
                      ({competency.level})
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <div
          className="mx-auto mt-10 h-px w-24"
          style={{ background: "var(--brand-accent)" }}
        />

        <p className="mt-6 text-sm text-[var(--muted)]">
          {doc("cert.issued", { date: docDate(certificate.issuedAt) })}
        </p>

        <p className="mt-6 text-xs text-[var(--muted)]">
          {doc("cert.verifyAt", { address: "/verify" })}
        </p>
        <p className="mt-1 font-mono text-sm font-medium">
          {certificate.verificationReference}
        </p>
          </>
        )}
      </article>

        {/*
          Said on the document itself rather than only in the platform, because
          the document is what leaves the platform and gets shown to an
          employer.
        */}
        <p className="mx-auto mt-8 max-w-md text-xs text-[var(--muted)]">
          {doc("cert.notNational", { provider: tenant.displayName })}
        </p>

      <p className="mt-4 text-center text-xs text-[var(--muted)]">
        {doc("cert.anyone")}
      </p>
    </AppShell>
  );
}
