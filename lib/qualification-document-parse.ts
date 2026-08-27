/**
 * Reading the SAQA registration document — the one a provider calls the
 * Qualification Document.
 *
 * It is a different beast from the curriculum document and carries different
 * things. Two of them exist nowhere else: the **SAQA ID**, which is the
 * qualification's identity in the national system, and the **Exit Level
 * Outcomes** with their Associated Assessment Criteria, which are what an EISA
 * is set against.
 *
 * Pure on purpose: no imports. Same reason as lib/curriculum-shape.
 */

export type ParsedExitLevelOutcome = {
  number: string;
  description: string;
  criteria: string[];
};

export type ParsedQualificationDocument = {
  saqaId: string | null;
  title: string | null;
  nqfLevel: number | null;
  totalCredits: number | null;
  exitLevelOutcomes: ParsedExitLevelOutcome[];
  notes: string[];
};

/** "SAQA QUAL ID QUALIFICATION TITLE" then "121151 Advanced Occupational…". */
const SAQA_HEADER = /SAQA\s+QUAL\s+ID/i;
const SAQA_ROW = /^([0-9]{4,6})\s+(.{6,})$/;

/**
 * The summary row: "Undefined 134 Not Applicable NQF Level 06 Regular-ELOAC".
 * The credit figure is the only bare number before the level, and the level is
 * printed as two digits.
 */
const LEVEL_AND_CREDITS = /\b([0-9]{2,4})\b[^0-9]*NQF\s+Level\s+([0-9]{1,2})/i;

const OUTCOMES_HEADING = /^EXIT\s+LEVEL\s+OUTCOMES\s*$/i;
const CRITERIA_HEADING = /^ASSOCIATED\s+ASSESSMENT\s+CRITERIA\s*$/i;
const NUMBERED = /^([0-9]{1,2})\.\s+(.+)$/;
const CRITERIA_FOR = /^Associated Assessment Criteria for Exit Level Outcome\s+([0-9]{1,2})\s*[:.]?\s*$/i;
/** The document restates the outcome under its own criteria heading. */
const RESTATEMENT = /^ELO\s+[0-9]{1,2}\s*[:.]/i;

/**
 * Where the criteria stop.
 *
 * The last outcome has no "criteria for outcome N+1" heading after it, so
 * without these the rest of the document — integrated assessment, articulation,
 * the lot — arrives as criteria of the final outcome.
 */
const END_OF_CRITERIA = [
  /^Integrated Assessment\s*[:.]?$/i,
  /^QUALIFICATION RULES/i,
  /^INTERNATIONAL COMPARABILITY/i,
  /^ARTICULATION OPTIONS/i,
  /^MODERATION OPTIONS/i,
  /^CRITERIA FOR THE REGISTRATION/i,
  /^LEARNING ASSUMED/i,
  /^RECOGNITION OF PRIOR LEARNING/i,
  /^QUALIFYING LEARNERS/i,
];

/** Boilerplate that is not a criterion, however much it looks like a sentence. */
const NOT_A_CRITERION = [
  /^In all of the tables/i,
  /^This qualification replaces/i,
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}/,
  /^Page\s+[0-9]/i,
  /^SOUTH AFRICAN QUALIFICATIONS AUTHORITY/i,
  /^All qualifications and part qualifications/i,
];

export function parseQualificationDocument(
  text: string,
): ParsedQualificationDocument {
  const lines = text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);

  const result: ParsedQualificationDocument = {
    saqaId: null,
    title: null,
    nqfLevel: null,
    totalCredits: null,
    exitLevelOutcomes: [],
    notes: [],
  };

  // --- identity -----------------------------------------------------------
  const headerAt = lines.findIndex((line) => SAQA_HEADER.test(line));
  if (headerAt !== -1) {
    for (let index = headerAt + 1; index < Math.min(headerAt + 6, lines.length); index++) {
      const row = SAQA_ROW.exec(lines[index]);
      if (row) {
        result.saqaId = row[1];
        result.title = row[2].trim();
        break;
      }
    }
  }

  const summary = lines.find((line) => LEVEL_AND_CREDITS.test(line));
  if (summary) {
    const match = LEVEL_AND_CREDITS.exec(summary)!;
    result.totalCredits = Number(match[1]);
    result.nqfLevel = Number(match[2]);
  }

  // --- exit level outcomes ------------------------------------------------
  const outcomesAt = lines.findIndex((line) => OUTCOMES_HEADING.test(line));
  const criteriaAt = lines.findIndex((line) => CRITERIA_HEADING.test(line));

  if (outcomesAt === -1) {
    result.notes.push(
      "No Exit Level Outcomes were found. Check this is the SAQA registration document rather than the curriculum.",
    );
    return result;
  }

  const outcomes = new Map<string, ParsedExitLevelOutcome>();
  const end = criteriaAt > outcomesAt ? criteriaAt : lines.length;

  let current: ParsedExitLevelOutcome | null = null;
  for (let index = outcomesAt + 1; index < end; index++) {
    const line = lines[index];
    const numbered = NUMBERED.exec(line);

    if (numbered) {
      current = { number: numbered[1], description: numbered[2], criteria: [] };
      outcomes.set(numbered[1], current);
      continue;
    }
    // A line that is not numbered continues the outcome above it.
    if (current) current.description = `${current.description} ${line}`.trim();
  }

  // --- associated assessment criteria -------------------------------------
  if (criteriaAt !== -1) {
    let target: ParsedExitLevelOutcome | null = null;
    let buffer = "";
    // The document restates the outcome under its own criteria heading, and
    // that restatement wraps. Skipping only its first line leaves the rest
    // arriving as though it were the first criterion.
    let skippingRestatement = false;

    const flush = () => {
      const criterion = buffer.trim();
      if (target && criterion.length > 10) target.criteria.push(criterion);
      buffer = "";
    };

    for (let index = criteriaAt + 1; index < lines.length; index++) {
      const line = lines[index];

      if (END_OF_CRITERIA.some((pattern) => pattern.test(line))) {
        flush();
        break;
      }

      const heading = CRITERIA_FOR.exec(line);
      if (heading) {
        flush();
        skippingRestatement = false;
        target = outcomes.get(heading[1]) ?? null;
        if (!target) {
          result.notes.push(
            `Criteria are listed for Exit Level Outcome ${heading[1]}, but no such outcome was found.`,
          );
        }
        continue;
      }

      if (!target) continue;

      if (RESTATEMENT.test(line)) {
        // Runs until the sentence ends, which may be several lines later.
        skippingRestatement = !/[.]$/.test(line);
        continue;
      }
      if (skippingRestatement) {
        skippingRestatement = !/[.]$/.test(line);
        continue;
      }

      if (NOT_A_CRITERION.some((pattern) => pattern.test(line))) continue;

      buffer = buffer ? `${buffer} ${line}` : line;

      // The document wraps a criterion over as many lines as it needs and ends
      // it with a full stop. Closing on the stop is what keeps two criteria
      // from running into one.
      if (/[.]$/.test(line)) flush();
    }

    flush();
  }

  result.exitLevelOutcomes = [...outcomes.values()];

  for (const outcome of result.exitLevelOutcomes) {
    if (outcome.criteria.length === 0) {
      result.notes.push(
        `Exit Level Outcome ${outcome.number} has no associated assessment criteria. The EISA is set against these, so it is worth checking the document.`,
      );
    }
  }

  return result;
}
