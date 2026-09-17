/**
 * The alignment document, which says how a qualification is delivered.
 *
 * Roland, 17 September: "The alignment document, whether it is a Word or an
 * Excel document, is almost on the same level as the 3 base documents for the
 * qualification. It helps to ensure that Study Units are properly linked. So
 * when uploading and indexing a qualification this document (or something
 * similar) must guide the indexing of Modules and Study Units."
 *
 * He is right that it belongs with the base three, and the reason is worth
 * stating. The curriculum document publishes modules; it says nothing about
 * study units, because a study unit is the provider's own way of grouping
 * those modules to serve one Exit Level Outcome. Two providers may group the
 * same qualification differently and both be correct. So the grouping cannot
 * be derived from the curriculum — it has to be supplied, and this is the
 * document that supplies it.
 *
 * Without it the platform can build a curriculum and file material against
 * study units invented from filenames, but it cannot say which modules a study
 * unit actually covers. With it, the whole spine joins up: Exit Level Outcome
 * to study unit to modules to topics to criteria.
 *
 * This is a different document from the Curriculum Alignment Matrix read by
 * `alignment-matrix.ts`. That one is a spreadsheet mapping each topic element
 * to the workbook and assessment that cover it. This one is the level above:
 * which modules belong to which study unit, and which outcome they serve. Both
 * are called "alignment" by the people who write them, which is why the reader
 * decides by what a document contains rather than by what it is called.
 *
 * Pure. It takes text, because the same layout arrives as .docx from one
 * provider and .pdf from another and neither should need its own reader.
 */

export class AlignmentDocumentError extends Error {}

export type AlignedStudyUnit = {
  /** SU1, SU2 — the code the rest of the platform uses. */
  code: string;
  title: string;
  /** The Exit Level Outcome this unit serves, where it names one. */
  outcome: {
    number: number;
    /** What the outcome requires, in the document's own words. */
    description: string;
    credits: number | null;
    nqfLevel: number | null;
    /** The Associated Assessment Criteria listed under it. */
    criteria: string[];
  } | null;
  /**
   * The curriculum modules this unit covers, normalised.
   *
   * The alignment document writes them KM-01 and WM-01; the curriculum
   * document writes them KM01 and WM01. Same module, two house styles in two
   * documents describing one qualification. Normalised here so that nothing
   * downstream has to know.
   */
  moduleCodes: string[];
};

export type AlignmentReading = {
  studyUnits: AlignedStudyUnit[];
  /** What a person should look at before accepting it. */
  notes: string[];
};

/** "Study Unit 1 – Organisational Architecture", however it is dashed. */
const STUDY_UNIT = /^study\s+unit\s+(\d{1,2})\s*[-–—:.]?\s*(.*)$/i;

/** "ELO 1 – 24 Credits; Level 5" — credits and level both optional. */
const OUTCOME = /^ELO\s+(\d{1,2})\b(.*)$/i;

/** "KM-01, Creating and…, NQF Level 6, 8 Credits." */
const MODULE_LINE = /^((?:KM|PM|WM|WEM)[-\s]?\d{1,2})\b\s*[,:.]?\s*(.*)$/i;

/** The heading above the Associated Assessment Criteria. */
const CRITERIA_HEADING =
  /^associated\s+assessment\s+criteri(?:a|on)\b.*?(\d{1,2})?\s*:?\s*$/i;

/** Lines that are the document talking about itself. */
const FURNITURE =
  /^(helicopter view|note:?|this document supports|KM|PM|WEM|ELO AACs)\s*$/i;

function numberIn(text: string, after: RegExp): number | null {
  const match = after.exec(text);
  return match ? Number(match[1]) : null;
}

/**
 * Reads the alignment document out of its text.
 *
 * Deliberately forgiving about order and punctuation and strict about
 * structure: a study unit heading opens a unit, and everything until the next
 * one belongs to it. That is how the document reads on the page, and it
 * survives a provider who dashes their headings differently or drops the
 * credits from an outcome.
 */
export function readAlignmentDocument(text: string): AlignmentReading {
  const lines = text
    .split("\n")
    .map((line) => line.replace(/ /g, " ").trim())
    .filter((line) => line.length > 0 && !FURNITURE.test(line));

  const studyUnits: AlignedStudyUnit[] = [];
  const notes: string[] = [];

  let current: AlignedStudyUnit | null = null;
  let collectingCriteria = false;

  for (const line of lines) {
    const unit = STUDY_UNIT.exec(line);
    if (unit) {
      current = {
        code: `SU${Number(unit[1])}`,
        title: unit[2].trim(),
        outcome: null,
        moduleCodes: [],
      };
      studyUnits.push(current);
      collectingCriteria = false;
      continue;
    }

    if (!current) continue;

    const outcome = OUTCOME.exec(line);
    if (outcome) {
      current.outcome = {
        number: Number(outcome[1]),
        description: "",
        credits: numberIn(outcome[2], /(\d{1,3})\s*credits?/i),
        nqfLevel: numberIn(outcome[2], /level\s*(\d{1,2})/i),
        criteria: [],
      };
      collectingCriteria = false;
      continue;
    }

    const moduleLine = MODULE_LINE.exec(line);
    if (moduleLine) {
      // KM-01 and KM01 are the same module written two ways, in two documents
      // describing one qualification.
      const code = moduleLine[1].replace(/[-\s]/g, "").toUpperCase();
      if (!current.moduleCodes.includes(code)) current.moduleCodes.push(code);
      collectingCriteria = false;
      continue;
    }

    if (CRITERIA_HEADING.test(line)) {
      collectingCriteria = true;
      continue;
    }

    if (collectingCriteria) {
      if (current.outcome) current.outcome.criteria.push(line);
      continue;
    }

    /*
     * Anything else directly under an outcome is its description, which runs
     * to several lines and has no marker of its own. Joined rather than
     * replaced: a description split across two lines is one description.
     */
    if (current.outcome && !current.moduleCodes.length) {
      current.outcome.description = current.outcome.description
        ? `${current.outcome.description} ${line}`
        : line;
    }
  }

  if (studyUnits.length === 0) {
    throw new AlignmentDocumentError(
      "No study units were found in that document. One heading has to read like “Study Unit 1 – Organisational Architecture”, with the modules it covers listed under it.",
    );
  }

  for (const unit of studyUnits) {
    if (unit.moduleCodes.length === 0) {
      notes.push(
        `${unit.code} names no modules, so nothing is linked to it. Check that page of the document.`,
      );
    }
    if (!unit.outcome) {
      notes.push(
        `${unit.code} names no Exit Level Outcome. The study unit is still created; what it is assessed against is not recorded.`,
      );
    }
  }

  // The same module in two study units means a learner's work against it would
  // count towards both. That is a real thing to query rather than to resolve.
  const seen = new Map<string, string[]>();
  for (const unit of studyUnits) {
    for (const code of unit.moduleCodes) {
      seen.set(code, [...(seen.get(code) ?? []), unit.code]);
    }
  }
  for (const [code, units] of seen) {
    if (units.length > 1) {
      notes.push(
        `${code} is listed under ${units.join(" and ")}. A module belongs to one study unit; check which.`,
      );
    }
  }

  return { studyUnits, notes };
}

/**
 * Whether a document looks like an alignment document at all.
 *
 * Used to tell it from the Curriculum Alignment Matrix, which is a spreadsheet
 * of topic elements. Both are called "alignment" by the people who write them,
 * so the decision is made on what a document contains.
 */
export function looksLikeAlignmentDocument(text: string): boolean {
  return /study\s+unit\s+\d/i.test(text) && /\bELO\s*\d/i.test(text);
}
