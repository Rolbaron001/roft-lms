/**
 * How a tenant names its files, and what the App reads out of a filename.
 *
 * Pure on purpose: no imports at all. The settings form shows a live preview
 * of how a filename would be read, and it can only do that if this runs in
 * the browser. lib/capture reaches into the database, so a form importing
 * one constant from it would drag the Postgres driver into the browser bundle
 * and fail the build with "can't resolve net" — the same trap as
 * lib/curriculum-shape.
 */

export type NamingConvention = {
  /** "{provider} {qualification} {studyUnit} {artefact}{number} [{memo}]" */
  pattern: string;
  /** { WB: "workbook", SA: "summative_assessment", WEM: "workplace_signoff" } */
  artefactCodes: Record<string, string>;
  /** "AG" */
  memorandumMarker: string;
};

export const DEFAULT_CONVENTION: NamingConvention = {
  pattern: "{provider} {qualification} {studyUnit} {artefact}{number} [{memo}]",
  artefactCodes: {
    WB: "workbook",
    SA: "summative_assessment",
    WEM: "workplace_signoff",
  },
  memorandumMarker: "AG",
};

export type Classified = {
  provider: string | null;
  qualification: string | null;
  studyUnit: string | null;
  artefact: string | null;
  number: string | null;
  isMemorandum: boolean;
  /** What could not be read, so the reviewer knows to fill it in. */
  unread: string[];
};

/**
 * Reads a filename under a tenant's own convention.
 *
 * Nothing here refuses. A tenant that files inconsistently gets a blank form
 * to fill in rather than a filled one to check — a slower path, not a closed
 * one — so the classifier reports what it could not read instead of rejecting
 * the upload.
 */
export function classifyFilename(
  filename: string,
  convention: NamingConvention = DEFAULT_CONVENTION,
): Classified {
  const stem = filename
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = stem.split(" ");
  const artefactCodes = Object.keys(convention.artefactCodes);
  const memo = convention.memorandumMarker.toUpperCase();

  const isMemorandum = tokens.some(
    (token) => token.toUpperCase() === memo,
  );

  let artefact: string | null = null;
  let number: string | null = null;
  for (const token of tokens) {
    const match = new RegExp(`^(${artefactCodes.join("|")})(\\d*)$`, "i").exec(
      token,
    );
    if (match) {
      artefact = convention.artefactCodes[match[1].toUpperCase()] ?? null;
      number = match[2] || null;
      break;
    }
  }

  const qualification = tokens.find((token) => /^\d{5,6}$/.test(token)) ?? null;
  const studyUnit = tokens.find((token) => /^SU\d+$/i.test(token)) ?? null;
  // The provider code is the leading token, where it is not one of the others.
  const first = tokens[0] ?? "";
  const provider =
    first && first !== qualification && !/^SU\d+$/i.test(first) ? first : null;

  const unread: string[] = [];
  if (!provider) unread.push("provider");
  if (!qualification) unread.push("qualification");
  if (!studyUnit) unread.push("study unit");
  if (!artefact) unread.push("artefact");

  return {
    provider,
    qualification,
    studyUnit,
    artefact,
    number,
    isMemorandum,
    unread,
  };
}

