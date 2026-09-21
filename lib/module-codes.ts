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

/**
 * The module code inside a longer identifier.
 *
 * The QCTO numbers a module twice. Its curriculum document calls knowledge
 * module one `242303-001-00-KM-01` - the qualification's own curriculum code
 * with the module code on the end - and the provider's alignment document
 * calls the same module `KM-01`. Both are correct, and both are the published
 * convention for the document they appear in.
 *
 * That is the failure Roland hit on 21 September. Fifteen modules had been
 * loaded under their full identifiers, the alignment document named the short
 * forms, and nothing matched - correctly, since `24230300100KM01` and `KM01`
 * are not the same string. Renaming fifteen modules by hand would have fixed
 * the symptom and thrown away the identifier the QCTO actually publishes.
 *
 * So: the code is the last run of letters followed by digits. It is a rule
 * rather than a list, because a curriculum code is a different length for
 * every qualification and no table could enumerate them.
 */
export function moduleCodeCore(code: string): string | null {
  /*
   * Anchored at the end, which is stricter than finding the last match.
   *
   * Unanchored, `KM01A` yields `KM01` - and a curriculum holding `KM01A` but
   * not `KM01` would then accept a document's `KM01` as meaning it. That is a
   * guess, and the whole design is that an unreadable code is reported rather
   * than guessed at. A trailing letter is somebody distinguishing two modules,
   * so it must not be discarded.
   */
  return /[A-Z]+\d+$/.exec(normaliseCode(code))?.[0] ?? null;
}

/** A code split into its letters and its number, where it has both. */
export function splitCode(
  code: string,
): { prefix: string; digits: string; number: number } | null {
  // The core, so a full QCTO identifier splits as well as a bare code does.
  const core = moduleCodeCore(code);
  const match = core ? /^([A-Z]+)(\d+)$/.exec(core) : null;
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

/**
 * The standards a set of loaded codes implies.
 *
 * Roland, 21 September: "the user only needs to input the standard (in fact
 * the system could ask to read particular documents during setup which would
 * allow the system to infer the standards)."
 *
 * Inferred rather than asked for, because the documents already say it. Every
 * module in a curriculum carries its code, and the code inside a full QCTO
 * identifier is its last letters-and-digits run - so a curriculum loaded under
 * `242303-001-00-KM-01` implies the standard `KM01` without anybody typing it.
 * Somebody can still add one in Settings for a scheme the loaded documents do
 * not yet show.
 */
export function standardsFrom(codes: string[]): string[] {
  const cores = codes
    .map(moduleCodeCore)
    .filter((core): core is string => Boolean(core));

  return [...new Set(cores)].sort((a, b) => a.localeCompare(b));
}

export type AliasRow = {
  /** The provider's own form, as they write it. */
  canonical: string;
  aliases: string[];
  /** Proposed and withheld, with the reason, so nothing vanishes silently. */
  rejected: { alias: string; because: string }[];
};

/**
 * The whole table for one set of standards, with the ambiguous ones removed.
 *
 * Generating per code is not enough. `KM01` proposes `K01`, and on its own
 * that is a fair reading - but a qualification whose components are Knowledge,
 * Practical and Workplace has `KM01`, `PM01` and `WM01`, and the moment two of
 * them propose the same short form it stops being a reading and becomes a
 * guess. The same applies to digit widths: a curriculum with `KM1` and `KM01`
 * as two different modules cannot have either abbreviate to the other.
 *
 * So anything proposed by more than one standard is dropped, and anything that
 * collides with a standard is dropped, and both are reported rather than
 * quietly discarded. A provider looking at the table should be able to see
 * that `K01` was considered and why it is not there - otherwise the first
 * thing they do is add it by hand.
 *
 * What is NOT in the table, and does not need to be: the full QCTO identifier.
 * `242303-001-00-KM-01` is read by rule, in `moduleCodeCore`, because the
 * curriculum code differs for every qualification and enumerating it would
 * make the table a different length for each one.
 */
export function aliasTable(standards: string[]): AliasRow[] {
  const canonicals = standards
    .map((code) => moduleCodeCore(code) ?? normaliseCode(code))
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
 * What a document's code means, against the codes a curriculum holds.
 *
 * Four steps, in this order, and the order is the safety:
 *
 *   1. The same string, once punctuation and case are removed. `KM-01` and
 *      `km 01` were always one code.
 *   2. The same *core*. This is what crosses the QCTO's two conventions:
 *      a curriculum holding `242303-001-00-KM-01` and a document naming
 *      `KM-01` are the same module, and neither document is wrong.
 *   3. The tenant's own table, matched on cores at both ends, which crosses a
 *      dropped leading zero or a shortened prefix.
 *   4. Nothing. A code that means nothing is reported, never guessed at.
 *
 * Returns the curriculum's own code, normalised, so a caller can look the
 * module up by it. Ambiguity at any step returns null rather than picking one:
 * two modules sharing a core is not a thing to resolve by ordering.
 */
export function resolveCode(
  code: string,
  known: string[],
  aliases: CodeAliases,
): string | null {
  const wanted = normaliseCode(code);
  if (!wanted) return null;

  const canonicals = known.map(normaliseCode).filter(Boolean);

  const exact = canonicals.indexOf(wanted);
  if (exact !== -1) return canonicals[exact];

  const wantedCore = moduleCodeCore(wanted);
  if (!wantedCore) return null;

  // One curriculum code whose core is the same. Two would mean the curriculum
  // itself holds an ambiguity, which is not this function's to resolve.
  const byCore = canonicals.filter(
    (one) => moduleCodeCore(one) === wantedCore,
  );
  if (byCore.length === 1) return byCore[0];
  if (byCore.length > 1) return null;

  for (const [canonical, accepted] of Object.entries(aliases)) {
    const target = moduleCodeCore(canonical);
    if (!target) continue;
    if (!accepted.map((one) => moduleCodeCore(one) ?? "").includes(wantedCore)) {
      continue;
    }

    const holders = canonicals.filter((one) => moduleCodeCore(one) === target);
    if (holders.length === 1) return holders[0];
  }

  return null;
}

/** The generated table as it is stored: standard to accepted spellings. */
export function aliasesFrom(rows: AliasRow[]): CodeAliases {
  const stored: CodeAliases = {};
  for (const row of rows) {
    if (row.aliases.length > 0) stored[row.canonical] = row.aliases;
  }
  return stored;
}
