/**
 * What an enrolment document is, with nothing that reaches a database.
 *
 * Split out of `enrolment-documents.ts` because the form that files one is a
 * client component, and importing the library there drags the Postgres driver
 * into the browser bundle. It fails the build with "can't resolve 'net'",
 * which is a long way from the cause.
 *
 * The rule for this file: it imports nothing. Constants and types a form needs
 * live here; anything that touches the database stays next door.
 */

export type EnrolmentRoute =
  | "standard_qualification"
  | "skills_programme"
  | "learnership"
  | "rpl"
  | "employment_equity";

export type DocumentKind =
  | "certified_id"
  | "highest_qualification"
  | "cv"
  | "proof_of_payment"
  | "learnership_agreement"
  | "rpl_portfolio"
  | "employment_equity_form"
  | "other";

export const DOCUMENT_LABEL: Record<DocumentKind, string> = {
  certified_id: "Certified copy of identity document",
  highest_qualification: "Certified copy of highest qualification",
  cv: "Current CV",
  proof_of_payment: "Proof of payment",
  learnership_agreement: "Learnership agreement",
  rpl_portfolio: "Portfolio of prior learning",
  employment_equity_form: "Employment equity form",
  other: "Other",
};

export const ROUTE_LABEL: Record<EnrolmentRoute, string> = {
  standard_qualification: "Full or part qualification",
  skills_programme: "Skills programme",
  learnership: "Learnership",
  rpl: "Recognition of prior learning",
  employment_equity: "Employment equity",
};

export const ENROLMENT_ROUTES: EnrolmentRoute[] = [
  "standard_qualification",
  "skills_programme",
  "learnership",
  "rpl",
  "employment_equity",
];

/** Kinds that must be a certified copy, and therefore go stale. */
export const CERTIFIED_KINDS: DocumentKind[] = [
  "certified_id",
  "highest_qualification",
];

/**
 * How long a certified copy is treated as current.
 *
 * Three months is the South African convention, and the client's own procedure
 * refuses a copy whose certification date is not current.
 */
export const CERTIFICATION_VALID_DAYS = 90;

export type DocumentStatus = {
  kind: DocumentKind;
  label: string;
  documentId: string | null;
  verification: "missing" | "pending" | "accepted" | "refused";
  refusedReason: string | null;
  certifiedOn: string | null;
  expired: boolean;
  satisfied: boolean;
};

export type EnrolmentReadiness = {
  route: EnrolmentRoute;
  documents: DocumentStatus[];
  outstanding: string[];
  ready: boolean;
};

/**
 * Which documents a route requires.
 *
 * Kept as data rather than as branches so the routes can be read side by side,
 * and so the differences are visible: recognition of prior learning wants a
 * portfolio precisely because there is no certificate to copy, and a
 * learnership carries an agreement a standard enrolment does not.
 */
const REQUIRED: Record<EnrolmentRoute, DocumentKind[]> = {
  standard_qualification: ["certified_id", "highest_qualification", "cv"],
  skills_programme: ["certified_id", "highest_qualification", "cv"],
  learnership: [
    "certified_id",
    "highest_qualification",
    "cv",
    "learnership_agreement",
  ],
  rpl: ["certified_id", "cv", "rpl_portfolio"],
  employment_equity: ["certified_id", "employment_equity_form"],
};

export function requiredDocuments(route: EnrolmentRoute): DocumentKind[] {
  return [...REQUIRED[route]];
}

/**
 * Whether a certified copy has gone stale by a given date.
 *
 * False for anything that does not need certifying. True for a certified kind
 * with no date at all: a copy nobody dated cannot be shown to be current, and
 * treating unknown as acceptable is how an expired one reaches a statutory
 * return.
 */
export function certificationExpired(
  kind: DocumentKind,
  certifiedOn: string | null,
  asAt: Date = new Date(),
): boolean {
  if (!CERTIFIED_KINDS.includes(kind)) return false;
  if (!certifiedOn) return true;

  const certified = new Date(`${certifiedOn}T00:00:00Z`);
  if (Number.isNaN(certified.getTime())) return true;

  const days = (asAt.getTime() - certified.getTime()) / 86_400_000;
  return days > CERTIFICATION_VALID_DAYS;
}
