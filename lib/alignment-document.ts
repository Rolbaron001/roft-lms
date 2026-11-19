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
  /**
   * Where the document names which topics of a module this unit takes -
   * "KM-01 (KT01, KT04)", "PM-02 (PS02)" - those topics, by module: KM01 →
   * ["KT01", "KT04"]. A module named without topics is absent, meaning all of
   * it. Used to place material named by topic ("RPL KM1 KT1.pptx") in the
   * study unit that teaches that topic.
   */
  topics: Record<string, string[]>;
  /**
   * The workbooks and summatives the document lists for this unit, as keys:
   * "workbook:1", "summative:1" (lib/material-placement.ts, paperKey). Heidi
   * added a column for them to SP-260508's alignment (19 November 2026). One
   * paper listed for two units is done once, after the later of them.
   */
  papers: string[];
};

/** "Formative Workbook 1", "Summative Assessment 2" in a line, as paper keys. */
export function paperKeysIn(line: string): string[] {
  const keys: string[] = [];
  for (const match of line.matchAll(/\bWorkbook\s*0?(\d{1,2})\b/gi)) keys.push(`workbook:${Number(match[1])}`);
  for (const match of line.matchAll(/\bSummative\s+Assessment\s*0?(\d{1,2})\b(?!\s*(?:&|and)\s*\d)/gi)) keys.push(`summative:${Number(match[1])}`);
  return keys;
}

/**
 * Of several alignment documents' texts, the units of the one that says most:
 * the most papers listed, then the most units. Empty when none reads as one.
 */
export function bestAlignmentUnits(texts: (string | null)[]): AlignedStudyUnit[] {
  let best: AlignedStudyUnit[] = [];
  const score = (units: AlignedStudyUnit[]) => units.reduce((sum, unit) => sum + unit.papers.length, 0) * 100 + units.length;
  for (const text of texts) {
    if (!text || !looksLikeAlignmentDocument(text)) continue;
    try {
      const units = readAlignmentDocument(text).studyUnits;
      if (score(units) > score(best)) best = units;
    } catch {
      /* not one after all */
    }
  }
  return best;
}

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
  /*
   * Split on tabs as well as newlines, because the same document arrives two
   * ways.
   *
   * Roland, 17 September: "whether it is a Word or an Excel document".
   * Curiosa's is a Word table, whose cells come out one per line. The same
   * thing saved as a spreadsheet comes out one row per line with tabs between
   * the cells - so a study unit, its outcome and its three modules would
   * arrive as a single line and none of the patterns below would match
   * anything.
   *
   * In both layouts a tab means what a line break means: the next cell. The
   * outcome description is a paragraph and carries none, so nothing that
   * should stay together is split.
   */
  const lines = text
    .split(/[\n\t]/)
    .map((line) => line.replace(/\u00a0/g, " ").trim())
    .filter((line) => line.length > 0 && !FURNITURE.test(line));

  const studyUnits: AlignedStudyUnit[] = [];
  const notes: string[] = [];

  let current: AlignedStudyUnit | null = null;
  let collectingCriteria = false;
  /** The unit just opened by a heading with no title on it; its title is the next cell. */
  let awaitingTitle: AlignedStudyUnit | null = null;
  /** Modules the document splits between units by topic: "KM-01 (KT01, KT04)". */
  const splitByTopic = new Set<string>();
  /** Whether the current unit is being read for the first time, in the alignment rows. */
  let listingPapers = false;

  for (const line of lines) {
    const unit = STUDY_UNIT.exec(line);
    if (unit) {
      const code = `SU${Number(unit[1])}`;
      /*
       * A study unit named a second time is the same unit. Found 17 November
       * 2026 in the RPL Advisor rollout document (SP-260508): its alignment
       * matrix is followed by a week-by-week schedule that names "Study Unit 1"
       * on every lecture row, and each mention became another, empty SU1.
       */
      const seen = studyUnits.find((one) => one.code === code);
      if (seen) {
        current = seen;
        awaitingTitle = null;
        // The schedule that follows names units again with its own assessment
        // weeks ("Summative Assessment 1 & 2"); only the alignment rows list a
        // unit's papers.
        listingPapers = false;
      } else {
        current = { code, title: unit[2].trim(), outcome: null, moduleCodes: [], topics: {}, papers: [] };
        studyUnits.push(current);
        awaitingTitle = current.title ? null : current;
        listingPapers = true;
      }
      collectingCriteria = false;
      continue;
    }

    if (!current) continue;

    /*
     * A Word table puts "Study Unit 1" in one cell and its name, "Foundations
     * & Policy Framework of RPL", in the next, so the name arrives as the line
     * after the heading. Taken only when it is not itself a module, an
     * outcome or a criteria heading.
     */
    if (awaitingTitle) {
      const target = awaitingTitle;
      awaitingTitle = null;
      if (!OUTCOME.test(line) && !MODULE_LINE.test(line) && !CRITERIA_HEADING.test(line) && line.length <= 120) {
        target.title = line;
        continue;
      }
    }

    if (listingPapers && !MODULE_LINE.test(line)) {
      const keys = paperKeysIn(line);
      if (keys.length > 0) {
        for (const key of keys) if (!current.papers.includes(key)) current.papers.push(key);
        continue;
      }
    }

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
      if (/^\(\s*(?:(?:KT|PS|WE)\s?\d|Part\b|Core\b)/i.test(moduleLine[2])) splitByTopic.add(code);
      const named = Array.from(moduleLine[2].matchAll(/\b(KT|PS|WE)\s?0?(\d{1,2})\b/gi)).map(
        (match) => `${match[1].toUpperCase()}${match[2].padStart(2, "0")}`,
      );
      if (named.length > 0) current.topics[code] = [...new Set([...(current.topics[code] ?? []), ...named])];
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
      "No study units were found in that document. Each study unit needs a heading such as “Study Unit 1 – Organisational Architecture”, with its modules listed under it.",
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
    // Named against topics ("KM-01 (KT01, KT04)") in each unit: the document
    // shares the module out deliberately, which is not a question to raise.
    if (units.length > 1 && !splitByTopic.has(code)) {
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
  if (!/study\s+unit\s+\d/i.test(text)) return false;
  if (/\bELO\s*\d/i.test(text)) return true;
  /*
   * Not every provider names an outcome per unit. The RPL Advisor rollout
   * document (SP-260508, 17 November 2026) calls itself a "Module Alignment
   * Document" and lists the modules of five study units with no ELO, and was
   * filed as an ordinary document, leaving the qualification still asking for
   * one. Without an ELO it must say it is about alignment and place modules
   * under at least two study units, which a theory guide mentioning "Study
   * Unit 1" does not.
   */
  if (!/alignment/i.test(text)) return false;
  try {
    return readAlignmentDocument(text).studyUnits.filter((unit) => unit.moduleCodes.length > 0).length >= 2;
  } catch {
    return false;
  }
}
