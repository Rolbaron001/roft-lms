/**
 * Who operates this deployment.
 *
 * The platform is sold twice: ROFT runs one instance for its own clients, and
 * Curiosa Academy runs another for theirs. They are the same application from
 * the same repository — what differs is the organisation sitting at the top of
 * it, and that is configuration rather than code.
 *
 * Everything an operator's identity touches reads from here: the tab title
 * before any tenant has resolved, the sign-in page, the prefix printed on a
 * certificate. Nothing hardcodes a company name, so standing up a third
 * operator is a `.env` file and a seeded organisation, not a fork.
 *
 * Two of these are read before the database is available — the root layout
 * builds page metadata for hosts that match no tenant — so they come from the
 * environment rather than from the operator's own organisation row. The rest
 * of the operator's identity (its display name for signed-in pages, its logo,
 * its colours) comes from that row like any other tenant's, through
 * `resolveTenant`.
 */

/** The slug of the organisation that operates this deployment. */
export function platformSlug(): string {
  return process.env.PLATFORM_ORG_SLUG?.trim() || "roft";
}

/**
 * The operator's name, for the few places rendered before a tenant is known:
 * the fallback tab title and the sign-in page of an unrecognised host.
 */
export function platformName(): string {
  return process.env.PLATFORM_NAME?.trim() || "ROFT";
}

/**
 * The prefix printed before a verification reference, so a certificate reads
 * as the issuing platform's own.
 *
 * Uppercase letters only, 2 to 12 of them. A prefix carrying digits or hyphens
 * would be ambiguous against the reference body, which is what verification
 * actually matches on.
 */
export function referencePrefix(): string {
  const configured = process.env.PLATFORM_REFERENCE_PREFIX?.trim().toUpperCase();
  if (configured && /^[A-Z]{2,12}$/.test(configured)) return configured;
  return "ROFT";
}

/**
 * A small illustration for empty screens, or null for none.
 *
 * Configuration rather than a file named in a component: the same codebase is
 * deployed for more than one operator, and one of them having a mascot must
 * not put that mascot in the other's product.
 */
export function platformIllustration(): string | null {
  const configured = process.env.PLATFORM_ILLUSTRATION?.trim();
  return configured && configured.startsWith("/") ? configured : null;
}
