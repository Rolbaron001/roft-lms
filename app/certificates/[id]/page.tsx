import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
import { CertificateError, getCertificate } from "@/lib/certificates";
import { AppShell } from "@/components/app-shell";
import { TenantLogo } from "@/components/tenant-logo";
import { PrintButton } from "@/components/print-button";
import { WithdrawDocument } from "@/components/withdraw-document";
import { withdrawCertificateAction } from "./actions";

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

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link href="/" className="text-sm text-[var(--muted)] hover:underline">
          ← My learning
        </Link>
      </div>

      {revoked ? (
        <p className="mb-4 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-4 py-3 text-sm text-[var(--danger)]">
          This certificate was withdrawn on{" "}
          {certificate.revokedAt!.toLocaleDateString("en-ZA")}.{" "}
          {certificate.revokedReason}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-start justify-end gap-3 print:hidden">
        {mayWithdraw && !certificate.revokedAt ? (
          <WithdrawDocument
            action={withdrawCertificateAction}
            idName="certificateId"
            idValue={certificate.id}
            what="this certificate"
            consequence="The learner may have given the reference to an employer. It keeps resolving and will say it was withdrawn."
          />
        ) : null}
        <PrintButton label="Print or save this certificate" />
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
          Certificate of Completion
        </h1>

        <p className="mt-6 text-sm text-[var(--muted)]">
          This certifies that
        </p>
        <p className="mt-2 text-2xl font-semibold">
          {holder.firstName} {holder.lastName}
        </p>

        <p className="mt-6 text-sm text-[var(--muted)]">
          has completed
        </p>
        <p className="mt-2 text-lg font-medium">{certificate.title}</p>

        {certificate.competenciesAttested.length > 0 ? (
          <>
            <p className="mt-8 text-sm text-[var(--muted)]">
              attesting to the following competencies
            </p>
            <ul className="mx-auto mt-3 max-w-md space-y-1 text-left">
              {certificate.competenciesAttested.map((competency) => (
                <li key={competency.code} className="text-sm">
                  <span className="font-medium">{competency.code}</span>{" "}
                  {competency.name}
                  {competency.level ? (
                    <span className="text-[var(--muted)]">
                      {" "}
                      — {competency.level}
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
          Issued {certificate.issuedAt.toLocaleDateString("en-ZA")}
        </p>

        <p className="mt-6 text-xs text-[var(--muted)]">
          Verify at <span className="font-medium">/verify</span> using reference
        </p>
        <p className="mt-1 font-mono text-sm font-medium">
          {certificate.verificationReference}
        </p>
      </article>

        {/*
          Said on the document itself rather than only in the platform, because
          the document is what leaves the platform and gets shown to an
          employer.
        */}
        <p className="mx-auto mt-8 max-w-md text-xs text-[var(--muted)]">
          This is {tenant.displayName}&rsquo;s own certificate for a course it
          delivered. It is not a national qualification and does not carry a
          SAQA credit or identifier. Where a learner is working towards an
          occupational qualification, the certificate for it is issued by the
          QCTO.
        </p>

      <p className="mt-4 text-center text-xs text-[var(--muted)]">
        Anyone can confirm this certificate with the reference above, without
        needing an account.
      </p>
    </AppShell>
  );
}
