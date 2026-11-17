/**
 * Which study unit a piece of material belongs to, when its name does not say.
 *
 * Roland, 17 November 2026, on the SP-260508 folder: "Presentation files are
 * clearly part of study material linked to a specific Study Unit derived
 * purely from the file name ... Uploading from a folder is supposed to build
 * the qualification into the LMS so that it is usable." The folder named its
 * material by module and topic ("RPL KM1 KT1.pptx") and by part
 * ("Formative_Workbook_1_Part1_Theory_Governance.docx"), never by study unit,
 * so every file was filed against the qualification and the build had nothing
 * to build.
 *
 * The study units are the provider's own grouping, read from their alignment
 * document, which also says which topics of a module each unit takes. So:
 *
 *   - a name that gives a module and topic is placed in the unit that teaches
 *     that topic;
 *   - otherwise the document's own text is read for the modules and topics it
 *     names, and it is placed in the last study unit they cover, because a
 *     workbook or assessment cannot be done before what it covers is taught.
 *     The SP-260508 schedule confirms it: Summative 1 after SU2, Summative 2
 *     after SU4, Summative 3 in SU5;
 *   - a FISA covers the whole programme and stays with the qualification.
 *
 * Every placement carries its reason, and where a document covers several
 * study units that is said, for the one check a person makes before commit.
 * Pure: units and text in, a placement out.
 */

export type PlacementUnit = {
  code: string;
  /** Normalised, KM01. */
  moduleCodes: string[];
  /** Topics taken from a module, where the alignment document names them: KM01 → ["KT01"]. */
  topics: Record<string, string[]>;
};

export type Placement = {
  studyUnitCode: string;
  /** Every study unit the document covers, in order. */
  covers: string[];
  because: string;
};

type Reference = { module: string; topic: string | null };

const REFERENCE = /\b(KM|PM|WM)[\s_-]?0?(\d{1,2})\b(?:[\s_-]*(KT|PS|WE)[\s_-]?0?(\d{1,2})\b)?/gi;

function referencesIn(text: string): Reference[] {
  return Array.from(text.matchAll(REFERENCE)).map((match) => ({
    module: `${match[1].toUpperCase()}${match[2].padStart(2, "0")}`,
    topic: match[3] ? `${match[3].toUpperCase()}${match[4].padStart(2, "0")}` : null,
  }));
}

const describe = (reference: Reference) =>
  `${reference.module.replace(/^([A-Z]{2})/, "$1-")}${reference.topic ? ` ${reference.topic}` : ""}`;

/** The study units one reference points at, in unit order. */
function unitsFor(units: PlacementUnit[], reference: Reference): PlacementUnit[] {
  const withModule = units.filter((unit) => unit.moduleCodes.includes(reference.module));
  if (!reference.topic) return withModule;
  const byTopic = withModule.filter((unit) => {
    const listed = unit.topics[reference.module];
    return !listed || listed.includes(reference.topic!);
  });
  // A topic the alignment document places nowhere (SP-260508 never names
  // KM-01 KT02) falls back to the units that take its module.
  return byTopic.length > 0 ? byTopic : withModule;
}

/** Kinds whose text is read for what they cover. Not handbooks or matrices, which cover everything. */
const READ_FOR_COVERAGE = new Set([
  "workbook",
  "workbook_memorandum",
  "summative_assessment",
  "summative_memorandum",
  "theory_guide",
  "facilitation_plan",
]);

export function placeMaterial(
  units: PlacementUnit[],
  document: { filename: string; kind: string | null; text: string | null },
): Placement | null {
  if (units.length === 0) return null;
  // The Final Integrated Supervised Assessment is the whole programme's.
  if (/\bFISA\b/i.test(document.filename.replace(/_/g, " "))) return null;

  const fromName = referencesIn(document.filename.replace(/\.[a-z0-9]+$/i, ""));
  const fromText = fromName.length === 0 && document.text && READ_FOR_COVERAGE.has(document.kind ?? "") ? referencesIn(document.text) : [];
  const all = fromName.length > 0 ? fromName : fromText;
  /*
   * Where a document names a module's topics, a bare mention of the same
   * module adds nothing beyond them. SP-260508's first summative names
   * "PM-02 PS02" (SU2) and, in passing, "PM-02", which every unit taking
   * PM-02 shares; counted alone it pushed the paper to SU4, two units after
   * the work it assesses.
   */
  const withTopics = new Set(all.filter((one) => one.topic).map((one) => one.module));
  const references = all.filter((one) => one.topic || !withTopics.has(one.module));
  if (references.length === 0) return null;

  const covered = new Set<string>();
  for (const reference of references) for (const unit of unitsFor(units, reference)) covered.add(unit.code);
  const covers = units.map((unit) => unit.code).filter((code) => covered.has(code));
  if (covers.length === 0) return null;

  const last = covers[covers.length - 1];
  const named = [...new Set(references.map(describe))].slice(0, 6).join(", ");
  const source = fromName.length > 0 ? "Its name gives" : "It names";
  const because =
    covers.length === 1
      ? `${source} ${named}, which the alignment document places in ${last}.`
      : `${source} ${named}, which the alignment document places in ${covers.join(", ")}. Placed in ${last}, the last of them, so it comes after what it covers. Check this.`;
  return { studyUnitCode: last, covers, because };
}
