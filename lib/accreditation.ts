import { eq } from "drizzle-orm";
import type { TenantDatabase } from "@/db/client";
import { curriculumModules, organisations, qualifications } from "@/db/schema";

/**
 * The accreditation number a report should carry, and where it came from.
 *
 * A provider holds accreditation letters, and one letter covers several
 * qualifications. So "the provider's accreditation number" is not a single
 * fact: a provider offering qualifications from two letters has two, and
 * printing either one against the wrong qualification is worse than printing
 * none. It is confidently wrong, in front of the body that issued it, on the
 * document that body asked for.
 *
 * The qualification's own number is therefore preferred wherever it is set.
 * The provider's is a fallback rather than an equivalent, and the source is
 * returned alongside the number so a report can say which it used instead of
 * implying a precision it does not have.
 */
export type Accreditation = {
  number: string | null;
  source: "qualification" | "provider" | "none";
  /** Ready to print, e.g. "07-QCTO/SDP210524125922 (provider)". */
  label: string;
};

export function describeAccreditation(
  qualificationNumber: string | null | undefined,
  providerNumber: string | null | undefined,
): Accreditation {
  if (qualificationNumber) {
    return {
      number: qualificationNumber,
      source: "qualification",
      label: qualificationNumber,
    };
  }

  if (providerNumber) {
    return {
      number: providerNumber,
      source: "provider",
      // Marked, because a reader checking this against an accreditation letter
      // needs to know it is the provider's number standing in rather than the
      // one issued for this qualification.
      label: `${providerNumber} (provider accreditation)`,
    };
  }

  return {
    number: null,
    source: "none",
    label: "Not accredited",
  };
}

/**
 * Resolves the accreditation for one qualification, falling back to the
 * provider's. Pass a null qualification for a report that is not about one.
 */
export async function accreditationFor(
  tx: TenantDatabase,
  organisationId: string,
  qualificationId: string | null,
): Promise<Accreditation> {
  const [provider] = await tx
    .select({ accreditationNumber: organisations.accreditationNumber })
    .from(organisations)
    .where(eq(organisations.id, organisationId));

  if (!qualificationId) {
    return describeAccreditation(null, provider?.accreditationNumber);
  }

  const [qualification] = await tx
    .select({ accreditationNumber: qualifications.accreditationNumber })
    .from(qualifications)
    .where(eq(qualifications.id, qualificationId));

  return describeAccreditation(
    qualification?.accreditationNumber,
    provider?.accreditationNumber,
  );
}

/**
 * The qualification an assessment belongs to, by way of the curriculum module
 * it assesses. Null for an assessment on a course that answers to no
 * qualification, which is an ordinary internal programme rather than an error.
 */
export async function qualificationForModule(
  tx: TenantDatabase,
  curriculumModuleId: string | null,
): Promise<string | null> {
  if (!curriculumModuleId) return null;

  const [row] = await tx
    .select({ qualificationId: curriculumModules.qualificationId })
    .from(curriculumModules)
    .where(eq(curriculumModules.id, curriculumModuleId));

  return row?.qualificationId ?? null;
}
