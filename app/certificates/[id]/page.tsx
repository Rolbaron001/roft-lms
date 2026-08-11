import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
import { CertificateError, getCertificate } from "@/lib/certificates";
import { AppShell } from "@/components/app-shell";

export default async function CertificatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();

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

      {/* The certificate itself. Kept plain so it prints sensibly. */}
      <article
        className={`rounded-lg border-2 bg-[var(--surface)] p-10 text-center ${
          revoked ? "opacity-60" : ""
        }`}
        style={{ borderColor: "var(--brand-accent)" }}
      >
        <p
          className="text-xs font-semibold uppercase tracking-[0.2em]"
          style={{ color: "var(--brand-accent)" }}
        >
          {tenant.displayName}
        </p>

        <h1 className="mt-6 text-sm uppercase tracking-widest text-[var(--muted)]">
          Certificate of Competence
        </h1>

        <p className="mt-6 text-sm text-[var(--muted)]">
          This certifies that
        </p>
        <p className="mt-2 text-2xl font-semibold">
          {holder.firstName} {holder.lastName}
        </p>

        <p className="mt-6 text-sm text-[var(--muted)]">
          has demonstrated competence in
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

      <p className="mt-4 text-center text-xs text-[var(--muted)]">
        Anyone can confirm this certificate with the reference above, without
        needing an account.
      </p>
    </AppShell>
  );
}
