/**
 * The many ways one module gets written down.
 *
 * Roland, 21 September, after every module of a fifteen-module qualification
 * failed to link: "The codes differ in the documents. Not an importer fault.
 * But it would be good if the system could read permutations of the codes to
 * avoid such issues. This type of fault is going to be continuous and will
 * also affect Tenants who use different codes declared under Settings."
 *
 * He is right that it is continuous. A curriculum document, an alignment
 * document and a workbook are written by different people at different times,
 * and one qualification's knowledge module one is `KM01` in the curriculum,
 * `KM-01` in the alignment table and `K1` in the workbook filename. All three
 * mean the same module. Nothing is wrong with any of the documents.
 *
 * Matching already ignored spaces and hyphens, which covers the easy third of
 * it. What it could not cross is a genuinely different scheme: a dropped
 * leading zero, or a prefix written short. This produces those, per tenant, so
 * the platform can be told once what a provider's codes look like instead of
 * failing fifteen times and asking somebody to retype a curriculum.
 *
 * Pure on purpose: no imports at all. The settings modal shows the
 * permutations live as they are edited, which it can only do if this runs in
 * the browser - the same reason lib/naming-convention.ts and
 * lib/curriculum-shape.ts import nothing. A module that reaches the database
 * would drag the Postgres driver into the browser bundle and fail the build.
 */

/** Canonical code to the other spellings accepted for it. */
export type CodeAliases = Record<string, string[]>;

/**
 * A code reduced to what matching actually compares.
 *
 * Punctuation, spacing and case never distinguish two modules from each other
 * in any document anybody writes, so they are removed before anything else
 * happens. This is what makes `KM-01`, `KM 01`, `km.01` and `KM01` one code
 * rather than four, and it is why none of those appear as permutations below:
 * they are already the same thing and listing them would pad the table with
 * rows that do nothing.
 */
export function normaliseCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/** A code split into its letters and its number, where it has both. */
export function splitCode(
  code: string,
): { prefix: string; digits: string; number: number } | null {
  const match = /^([A-Za-z]+)(\d+)$/.exec(normaliseCode(code));
  if (!match) return null;

  return {
    prefix: match[1],
    digits: match[2],
    number: Number(match[2]),
  };
}

/**
 * The spellings of one code that a document might plausibly use.
 *
 * Two axes, because these are the two that survive normalisation and so are
 * the two that actually break a match:
 *
 *   **How many digits.** `KM1`, `KM01`, `KM001`. A curriculum that numbers to
 *   fifteen writes two; a summary table written by hand writes one.
 *
 *   **How much of the prefix.** `KM01`, `K01`. Providers abbreviate in
 *   filenames and in the narrow columns of an alignment table.
 *
 * Deliberately not generated: anything that drops the *first* letter. `M01`
 * from `KM01` is exactly as good a reading of `PM01` and `WM01`, and a
 * knowledge module silently matching a workplace module is far worse than no
 * match at all. Ambiguity is removed for the whole set in `aliasTable` below,
 * but this axis is not even proposed.
 */
export function permutationsFor(code: string): string[] {
  const parts = splitCode(code);
  if (!parts) return [];

  const canonical = normaliseCode(code);
  const found = new Set<string>();

  // Prefixes from the whole thing down to its first letter. Truncating from
  // the end keeps what distinguishes one component from another.
  const prefixes: string[] = [];
  for (let length = parts.prefix.length; length >= 1; length -= 1) {
    prefixes.push(parts.prefix.slice(0, length));
  }

  // One to three digits, which covers every curriculum anybody numbers by
  // hand. A qualification with more than 999 modules has other problems.
  for (const prefix of prefixes) {
    for (let width = 1; width <= 3; width += 1) {
      const alias = `${prefix}${String(parts.number).padStart(width, "0")}`;
      if (alias !== canonical) found.add(alias);
    }
  }

  return [...found].sort();
}

export type AliasRow = {
  canonical: string;
  aliases: string[];
  /** Proposed and withheld, with the reason, so nothing vanishes silently. */
  rejected: { alias: string; because: string }[];
};

/**
 * The whole table for one set of codes, with the ambiguous ones removed.
 *
 * Generating per code is not enough. `KM01` proposes `K01`, and on its own
 * that is a fair reading - but a qualification whose components are Knowledge,
 * Practical and Workplace has `KM01`, `PM01` and `WM01`, and the moment two of
 * them propose the same short form it stops being a reading and becomes a
 * guess. The same applies to digit widths: a curriculum with `KM1` and `KM01`
 * as two different modules cannot have either abbreviate to the other.
 *
 * So anything proposed by more than one canonical code is dropped, and
 * anything that collides with a canonical code is dropped, and both are
 * reported rather than quietly discarded. A provider looking at the table
 * should be able to see that `K01` was considered and why it is not there -
 * otherwise the first thing they do is add it by hand.
 */
export function aliasTable(codes: string[]): AliasRow[] {
  const canonicals = codes
    .map(normaliseCode)
    .filter(Boolean)
    .filter((code, index, all) => all.indexOf(code) === index);

  const taken = new Set(canonicals);
  const proposedBy = new Map<string, string[]>();

  for (const canonical of canonicals) {
    for (const alias of permutationsFor(canonical)) {
      proposedBy.set(alias, [...(proposedBy.get(alias) ?? []), canonical]);
    }
  }

  return canonicals.map((canonical) => {
    const aliases: string[] = [];
    const rejected: { alias: string; because: string }[] = [];

    for (const alias of permutationsFor(canonical)) {
      const claimants = proposedBy.get(alias) ?? [];

      if (taken.has(alias)) {
        rejected.push({
          alias,
          because: `${alias} is a module in its own right.`,
        });
      } else if (claimants.length > 1) {
        rejected.push({
          alias,
          because: `${claimants.join(" and ")} would both read as ${alias}.`,
        });
      } else {
        aliases.push(alias);
      }
    }

    return { canonical, aliases, rejected };
  });
}

/**
 * What a document's code means, under a tenant's table.
 *
 * Returns the canonical code, or null. Checked in one order and only one
 * order: an exact match first, always, so a tenant who adds a careless alias
 * can never shadow a real module code with it.
 */
export function resolveCode(
  code: string,
  known: string[],
  aliases: CodeAliases,
): string | null {
  const wanted = normaliseCode(code);
  if (!wanted) return null;

  const canonicals = known.map(normaliseCode);
  const exact = canonicals.indexOf(wanted);
  if (exact !== -1) return canonicals[exact];

  for (const [canonical, accepted] of Object.entries(aliases)) {
    const target = normaliseCode(canonical);
    if (!canonicals.includes(target)) continue;
    if (accepted.map(normaliseCode).includes(wanted)) return target;
  }

  return null;
}

/** The generated table as it is stored: canonical to accepted spellings. */
export function aliasesFrom(rows: AliasRow[]): CodeAliases {
  const stored: CodeAliases = {};
  for (const row of rows) {
    if (row.aliases.length > 0) stored[row.canonical] = row.aliases;
  }
  return stored;
}
