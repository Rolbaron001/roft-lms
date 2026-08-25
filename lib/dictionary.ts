/**
 * The ROFT Learning Dictionary.
 *
 * One settled meaning per term, shipped with the application rather than held
 * in the database. Every tenant sees the same dictionary, it changes only when
 * a release changes it, and it needs no tenant scoping — so a table would buy
 * a migration, a policy and an importer for nothing. The JSON is imported
 * rather than read from disk so it is bundled into the standalone build.
 *
 * The field that matters is `definedBy`. It separates three things that are
 * easy to confuse and expensive to confuse:
 *
 *   authority  A body defines the term. Changing the meaning puts a submission
 *              or an accreditation at risk. The body is named.
 *   platform   The platform chose the word. Ours to change; no regulator is
 *              watching.
 *   practice   Widely used in the sector with no single owner. Useful, but
 *              never to be cited as a requirement.
 *
 * That distinction is the point of the dictionary, so it is carried through to
 * the screen rather than kept as an authoring note.
 */
import data from "@/dictionary/lms-dictionary.json";

export type DefinedBy = "authority" | "platform" | "practice";

export type DictionaryEntry = {
  term: string;
  abbreviation?: string;
  category: string;
  definedBy: DefinedBy;
  /** Present only when definedBy is "authority". */
  authority?: string;
  definition: string;
  seeAlso: string[];
};

export type Dictionary = {
  version: string;
  issued: string;
  categories: Record<string, string>;
  entries: DictionaryEntry[];
};

const dictionary: Dictionary = {
  version: data.version,
  issued: data.issued,
  categories: data.categories,
  entries: (data.entries as Array<Record<string, unknown>>).map((entry) => ({
    term: entry.term as string,
    abbreviation: entry.abbreviation as string | undefined,
    category: entry.category as string,
    definedBy: entry.definedBy as DefinedBy,
    authority: entry.authority as string | undefined,
    definition: entry.definition as string,
    seeAlso: (entry.seeAlso as string[] | undefined) ?? [],
  })),
};

export function getDictionary(): Dictionary {
  return dictionary;
}

/** How each `definedBy` value is explained on screen. */
export const DEFINED_BY_MEANING: Record<DefinedBy, string> = {
  authority:
    "Defined by an authority. Use it as they do — changing the meaning puts a submission at risk.",
  platform:
    "This platform's own word for it. Ours to change; no authority prescribes it.",
  practice:
    "Common usage across the sector, with no single owner. Do not cite it as a requirement.",
};

/**
 * Case-insensitive lookup by term or abbreviation, so both "EISA" and its
 * full name find the same entry.
 */
export function lookup(query: string): DictionaryEntry | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle) return undefined;
  return dictionary.entries.find(
    (entry) =>
      entry.term.toLowerCase() === needle ||
      entry.abbreviation?.toLowerCase() === needle,
  );
}

/**
 * Free-text search across term, abbreviation and definition, in that order of
 * preference, so typing "logbook" leads with the entry rather than with the
 * seven entries that merely mention it.
 */
export function searchDictionary(query: string): DictionaryEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return dictionary.entries;

  const scored = dictionary.entries
    .map((entry) => {
      const term = entry.term.toLowerCase();
      const abbreviation = entry.abbreviation?.toLowerCase() ?? "";
      let score = 0;
      if (term === needle || abbreviation === needle) score = 4;
      else if (term.startsWith(needle) || abbreviation.startsWith(needle))
        score = 3;
      else if (term.includes(needle) || abbreviation.includes(needle))
        score = 2;
      else if (entry.definition.toLowerCase().includes(needle)) score = 1;
      return { entry, score };
    })
    .filter((row) => row.score > 0);

  scored.sort(
    (a, b) => b.score - a.score || a.entry.term.localeCompare(b.entry.term),
  );
  return scored.map((row) => row.entry);
}

/**
 * Consistency checks the test suite runs, kept here so they describe the data
 * rather than the page: no duplicate terms, no cross-reference to a term that
 * does not exist, no category that is not declared, and an authority named
 * wherever one is claimed.
 */
export function dictionaryProblems(source: Dictionary = dictionary): string[] {
  const problems: string[] = [];
  const terms = new Set<string>();

  for (const entry of source.entries) {
    if (terms.has(entry.term)) problems.push(`Duplicate term: ${entry.term}`);
    terms.add(entry.term);

    if (!source.categories[entry.category])
      problems.push(`${entry.term}: undeclared category "${entry.category}"`);

    if (entry.definedBy === "authority" && !entry.authority)
      problems.push(`${entry.term}: definedBy "authority" but none named`);

    if (entry.definedBy !== "authority" && entry.authority)
      problems.push(
        `${entry.term}: names an authority but is not defined by one`,
      );

    if (!entry.definition.trim())
      problems.push(`${entry.term}: no definition`);
  }

  for (const entry of source.entries) {
    for (const reference of entry.seeAlso) {
      if (!terms.has(reference))
        problems.push(`${entry.term}: see also "${reference}" does not exist`);
    }
  }

  const sorted = [...source.entries.map((entry) => entry.term)].sort((a, b) =>
    a.localeCompare(b, "en"),
  );
  source.entries.forEach((entry, index) => {
    if (entry.term !== sorted[index])
      problems.push(`Entries are not in alphabetical order at ${entry.term}`);
  });

  return problems;
}
