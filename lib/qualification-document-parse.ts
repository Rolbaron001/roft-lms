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
  /**
   * What the document says this is, under QUALIFICATION TYPE.
   *
   * Stated outright rather than inferred: 118709 reads "Occupational
   * Certificate" and 118710 reads "Part-Qualification". Null when the header
   * could not be read at all, which is different from "full" and is why this
   * is not defaulted here.
   */
  kind: "full" | "part" | "skills_programme" | null;
  /**
   * The module codes the QUALIFICATION RULES section lists.
   *
   * For a full qualification this restates its own curriculum. For a part it
   * is the whole point: it names which of the parent's modules this takes, and
   * nothing else in any document says so.
   */
  moduleCodes: string[];
  /**
   * The curriculum code this document states for itself.
   *
   * "The curriculum title and code are: Commercial Cleaner: 811201-000-00."
   * Worth reading because the curriculum document does not always carry its own
   * code in a form the reader can find - the Commercial Cleaner one does not -
   * and this sentence is unambiguous.
   */
  curriculumCode: string | null;
  /**
   * The curriculum a part draws on, taken from the prefix its module codes
   * share.
   *
   * This is how a part is attached to its parent, and it took reading the real
   * documents to get right. A part does **not** repeat its parent's curriculum
   * code: 118709 states 811201-000-00 and 118710 states 811201-000-01, the
   * numeric suffix Heidi described. But every module 118710 lists is written
   * "811201-000-00-KM-01" - the parent's prefix - because they are the
   * parent's modules. The modules say where the curriculum is; the header does
   * not.
   *
   * Null for a full qualification, whose module prefix is its own code.
   */
  parentCurriculumCode: string | null;
  exitLevelOutcomes: ParsedExitLevelOutcome[];
  notes: string[];
};

/**
 * A module code as the SAQA document writes it, which is not always as the
 * curriculum document writes it.
 *
 * 118710 contains "811201-000-00--WM-01" with a doubled hyphen, twice. A
 * transcription slip in a registered document is not something the platform
 * can have corrected, so it collapses runs of hyphens before matching. Codes
 * are compared, never generated, so this only ever loosens a comparison.
 */
export function normaliseModuleCode(code: string): string {
  return code.replace(/-{2,}/g, "-").trim().toUpperCase();
}

/**
 * What two documents agree on when they write the same module differently.
 *
 * The SAQA document writes "811201-000-00-KM-01". The curriculum document,
 * which is where the platform's modules actually come from, writes "KM01". The
 * component and the number are the only part both carry, so that is the key
 * the two are matched on - "KM01" either way.
 *
 * Falls back to the whole code where there is no such suffix, which is what a
 * non-QCTO module looks like: a tenant running ordinary corporate training has
 * codes of its own shape, and those match each other exactly or not at all.
 */
export function moduleKey(code: string): string {
  const match = /(KM|PM|WM)\s*-?\s*([0-9]{1,3})\s*$/i.exec(code.trim());
  if (!match) return normaliseModuleCode(code);
  return `${match[1].toUpperCase()}${match[2].padStart(2, "0")}`;
}

/** "The curriculum title and code are: Commercial Cleaner: 811201-000-00." */
const CURRICULUM_CODE =
  /curriculum title and code are\s*:\s*.*?:\s*([0-9]{4,8}(?:-[0-9]{2,4})+)/i;

/**
 * "811201-000-00-KM-01 Introduction to the World of Work, Level 1, 6 Credits."
 *
 * Taken apart rather than matched whole, because these lines are damaged in
 * two different ways across three documents that are otherwise identical.
 * 118710 writes "811201-000-00--WM-01" with a doubled hyphen; 118711 writes
 * "811201-000-00-KM-0 1Introduction", with a space inside the number and the
 * title welded onto it. Both are the registered document as published, so the
 * reader accommodates them rather than losing a module over a typesetting
 * slip.
 */
const RULE_MODULE =
  /^([0-9]{4,8}-[0-9]{2,4}-[0-9]{2,4})-+(KM|PM|WM)-?\s*([0-9])\s*([0-9])?/i;

/** The type sits under "FIELD SUBFIELD" and is the first thing on its line. */
const PART_TYPE = /^Part-?Qualification\b/i;
const SKILLS_PROGRAMME_TYPE = /^(?:Occupational\s+)?Skills\s+Programme\b/i;
/** Where the header stops and the prose starts. */
const END_OF_HEADER = /^PURPOSE AND RATIONALE/i;

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
    kind: null,
    moduleCodes: [],
    curriculumCode: null,
    parentCurriculumCode: null,
    exitLevelOutcomes: [],
    notes: [],
  };

  // --- what this is -------------------------------------------------------
  // Read only from the header block. The word "part-qualification" appears
  // dozens of times in the prose of a part's own document, and once in the
  // copyright boilerplate of every document including a full qualification's
  // - "All qualifications and part qualifications registered on the National
  // Qualifications Framework are public property" - so a document-wide search
  // would classify 118709 as a part.
  const headerEnd = lines.findIndex((line) => END_OF_HEADER.test(line));
  const header = lines.slice(0, headerEnd === -1 ? 40 : headerEnd);

  if (header.some((line) => SKILLS_PROGRAMME_TYPE.test(line))) {
    result.kind = "skills_programme";
  } else if (header.some((line) => PART_TYPE.test(line))) {
    result.kind = "part";
  } else if (header.length > 0) {
    result.kind = "full";
  }

  // --- the modules it is made up of ---------------------------------------
  // Taken from anywhere in the document rather than from under the
  // QUALIFICATION RULES heading, because the heading does not survive text
  // extraction intact - it arrives wrapped into the sentence above it. The
  // codes themselves are unambiguous enough to stand on their own.
  const codeLine = lines.find((line) => CURRICULUM_CODE.test(line));
  if (codeLine) {
    result.curriculumCode = CURRICULUM_CODE.exec(codeLine)![1];
  }

  const prefixes = new Set<string>();
  const seen = new Set<string>();
  for (const line of lines) {
    const match = RULE_MODULE.exec(line);
    if (!match) continue;
    prefixes.add(match[1].toUpperCase());

    // Padded to two digits, which is what every module code in every one of
    // these documents uses. A single digit here means the extraction lost the
    // second one, not that the code is genuinely short.
    const number = `${match[3]}${match[4] ?? ""}`.padStart(2, "0");
    const code = normaliseModuleCode(
      `${match[1]}-${match[2].toUpperCase()}-${number}`,
    );
    if (seen.has(code)) continue;
    seen.add(code);
    result.moduleCodes.push(code);
  }

  // Where the curriculum lives, for a part. Only when every module agrees: two
  // prefixes would mean a document drawing on two curricula, which is not a
  // part qualification and is not something to guess at.
  if (result.kind !== "full" && prefixes.size === 1) {
    const [prefix] = prefixes;
    if (prefix !== result.curriculumCode?.toUpperCase()) {
      result.parentCurriculumCode = prefix;
    }
  }

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
