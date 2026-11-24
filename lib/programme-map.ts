/**
 * The programme map (job sheet D60; Roland, 24 November 2026).
 *
 * Reading a folder ends in a draft: which study unit each file belongs to,
 * which guide belongs to which paper, and where each link came from. Until
 * now the draft was acted on as it stood, and every new layout ("Part A",
 * a guide that never says "workbook", a unit named again in the schedule)
 * turned into a paper quietly linked to the wrong guide or unit. So the
 * draft is shown on "Check the map" first: what the platform could not
 * decide is asked as a plain question, what it decided less surely is listed
 * for a tick, and nothing is built until both are done.
 *
 * Roland, 24 November: it "must be very user friendly ... clear and guided
 * ... work through it very quickly, else it becomes a burden. Ticks and
 * checkboxes." A folder that reads cleanly needs one click.
 */
import type { IngestionPlan, PlannedDocument } from "./folder-plan";
import { artefactNumber, chooseGuide, versionOf } from "./capture-from-documents";
import { bestGuide } from "./document-linking";

export const PAPER_KINDS = new Set(["workbook", "summative_assessment"]);
export const GUIDE_KINDS = new Set(["workbook_memorandum", "summative_memorandum"]);
const GUIDE_FOR: Record<string, string> = { workbook: "workbook_memorandum", summative_assessment: "summative_memorandum" };
const PAPER_FOR: Record<string, string> = { workbook_memorandum: "workbook", summative_memorandum: "summative_assessment" };

/** A FISA is the QCTO's, kept with the qualification and never captured. */
const isFisa = (document: PlannedDocument) => /\bFISA\b/i.test(document.filename.replace(/[_-]+/g, " "));
const isPaper = (document: PlannedDocument) => PAPER_KINDS.has(document.kind ?? "") && !isFisa(document) && !document.ignored;
const isGuide = (document: PlannedDocument) => GUIDE_KINDS.has(document.kind ?? "") && !isFisa(document) && !document.ignored;

// ------------------------------------------------------------------ pairing

/**
 * Each workbook and summative given its guide, while the files are still in
 * hand: by its kind, study unit, number and version first ("Workbook 1" with
 * "Assessor Guide Workbook 1", "Part A" with "Part A"), then by what the two
 * say, where the text was read. A pairing a person made is never changed.
 */
export function pairPapers(plan: IngestionPlan, texts: Map<string, string | null> = new Map()): void {
  const papers = plan.documents.filter(isPaper);
  const guides = plan.documents.filter(isGuide);
  const taken = new Set(papers.map((paper) => paper.guidePath).filter(Boolean) as string[]);

  for (const paper of papers) {
    if (paper.guidePath || paper.noGuide) continue;
    const wanted = GUIDE_FOR[paper.kind!];
    const pool = guides.filter((guide) => guide.kind === wanted && !taken.has(guide.path));
    const sameUnit = pool.filter((guide) => guide.studyUnitCode === paper.studyUnitCode);
    const number = artefactNumber(paper.filename);
    const byNumber = number ? chooseGuide(paper.filename, sameUnit.filter((guide) => artefactNumber(guide.filename) === number)) : null;
    if (byNumber) {
      paper.guidePath = byNumber.path;
      paper.guideSource = "name";
      taken.add(byNumber.path);
      continue;
    }
    const asCandidates = (list: PlannedDocument[]) => list.map((guide) => ({ id: guide.path, filename: guide.filename, text: texts.get(guide.path) ?? null }));
    const subject = { filename: paper.filename, text: texts.get(paper.path) ?? null };
    const link = bestGuide(subject, asCandidates(sameUnit)) ?? bestGuide(subject, asCandidates(pool));
    if (link) {
      paper.guidePath = link.id;
      paper.guideSource = "content";
      taken.add(link.id);
    }
  }
}

// ------------------------------------------------------------------ the map

export type MapState = "decide" | "look" | "settled";
export type MapQuestion = "what" | "unit" | "guide" | "paper";

export type MapItem = {
  path: string;
  filename: string;
  title: string;
  kind: string | null;
  unit: string | null;
  also: string[];
  role: "paper" | "guide" | "material" | "programme" | "library" | "unknown" | "ignored";
  state: MapState;
  /** What a person must answer, where they must. */
  question: MapQuestion | null;
  /** In plain words, why it is asked or worth a look. */
  why: string | null;
  because: string;
  source: string | null;
  guide: { path: string; title: string; source: string | null } | null;
  /** On a guide: the papers it was given to. */
  guides: string[];
  noGuide: boolean;
  confirmed: boolean;
  /** What may be chosen, for the questions that offer a list. */
  choices: { path: string; title: string }[];
  version: string | null;
};

export type ProgrammeMap = {
  units: { code: string; title: string }[];
  items: MapItem[];
  counts: { decide: number; look: number; settled: number };
  /** True when nothing needs an answer and everything worth a look is ticked. */
  ready: boolean;
};

/**
 * The map of a plan. `knownUnits`: study units the qualification already has,
 * when the folder adds to one. A course or learning path has none, so no
 * file is asked which unit it belongs to (Roland, 24 November 2026: this
 * applies to every kind of programme).
 */
export function mapOf(plan: IngestionPlan, knownUnits: { code: string; title: string }[] = []): ProgrammeMap {
  const units = [...plan.studyUnits, ...knownUnits.filter((one) => !plan.studyUnits.some((own) => own.code === one.code))].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true }),
  );
  const byPath = new Map(plan.documents.map((document) => [document.path, document]));
  const papers = plan.documents.filter(isPaper);
  const guides = plan.documents.filter(isGuide);
  const claimedBy = new Map<string, PlannedDocument[]>();
  for (const paper of papers) {
    if (!paper.guidePath || byPath.get(paper.guidePath)?.ignored) continue;
    claimedBy.set(paper.guidePath, [...(claimedBy.get(paper.guidePath) ?? []), paper]);
  }

  const items = plan.documents.map((document): MapItem => {
    const base = {
      path: document.path,
      filename: document.filename,
      title: document.title,
      kind: document.kind,
      unit: document.studyUnitCode,
      also: document.also ?? [],
      because: document.because,
      source: document.source ?? null,
      guide: null as MapItem["guide"],
      guides: [] as string[],
      noGuide: document.noGuide === true,
      confirmed: document.confirmed === true,
      choices: [] as MapItem["choices"],
      version: document.version,
    };
    const settled = (role: MapItem["role"]): MapItem => ({ ...base, role, state: "settled", question: null, why: null });
    const decide = (role: MapItem["role"], question: MapQuestion, why: string, choices: MapItem["choices"] = []): MapItem => ({ ...base, role, state: "decide", question, why, choices });

    if (document.ignored) return settled("ignored");
    if (document.target === "library") return settled("library");
    if (!document.kind || document.kind === "other") return decide("unknown", "what", "The platform could not tell what this file is.");

    if (isPaper(document)) {
      // A guide that was left out is no guide: the question comes back.
      const linked = document.guidePath ? byPath.get(document.guidePath) : undefined;
      const guide = linked && !linked.ignored ? linked : undefined;
      const withGuide = { ...base, guide: guide ? { path: guide.path, title: guide.title, source: document.guideSource ?? null } : null };
      if (!document.studyUnitCode && units.length > 0) {
        return {
          ...decide("paper", "unit", "Nothing in its name or in the alignment document says which study unit it belongs to.", units.map((one) => ({ path: one.code, title: `${one.code} ${one.title}` }))),
          guide: withGuide.guide,
        };
      }
      const candidates = guides.filter((one) => one.kind === GUIDE_FOR[document.kind!]).map((one) => ({ path: one.path, title: one.title }));
      if (!guide && !document.noGuide) {
        return { ...decide("paper", "guide", "No guide was found for it. Without one, its written questions have no marking guidance.", candidates), guide: null };
      }
      const sharers = guide ? (claimedBy.get(guide.path) ?? []).filter((one) => one !== document && (one.version ?? "") === (document.version ?? "")) : [];
      if (sharers.length > 0) {
        return { ...decide("paper", "guide", `The same guide was given to ${sharers.map((one) => one.title).join(", ")} as well.`, candidates), guide: withGuide.guide };
      }
      const why = lookReason(document, document.guideSource === "content" ? "Its guide was matched by what the two say, not by their names." : null);
      return { ...withGuide, role: "paper", state: why && !document.confirmed ? "look" : "settled", question: null, why, choices: candidates };
    }

    if (isGuide(document)) {
      const owners = claimedBy.get(document.path) ?? [];
      if (owners.length === 0) {
        const candidates = papers.filter((one) => one.kind === PAPER_FOR[document.kind!]).map((one) => ({ path: one.path, title: one.title }));
        return { ...decide("guide", "paper", "No paper was found for this guide.", candidates), guides: [] };
      }
      const why = lookReason(document, null);
      return { ...base, guides: owners.map((one) => one.title), role: "guide", state: why && !document.confirmed ? "look" : "settled", question: null, why, choices: [] };
    }

    const role: MapItem["role"] = document.studyUnitCode ? "material" : "programme";
    const why = lookReason(document, null);
    return { ...base, role, state: why && !document.confirmed ? "look" : "settled", question: null, why };
  });

  const counts = {
    decide: items.filter((item) => item.state === "decide").length,
    look: items.filter((item) => item.state === "look").length,
    settled: items.filter((item) => item.state === "settled").length,
  };
  return { units, items, counts, ready: counts.decide === 0 && counts.look === 0 };
}

/** Why a link is worth a person's glance, or null when it is not. */
function lookReason(document: PlannedDocument, extra: string | null): string | null {
  const reasons: string[] = [];
  if (document.source === "content") reasons.push("Placed by what it says, not by its name.");
  if (document.source === "fallback") reasons.push("Placed in the last unit its modules cover.");
  if ((document.also ?? []).length > 0) reasons.push(`Also covers ${document.also!.join(", ")}.`);
  if (extra) reasons.push(extra);
  return reasons.length > 0 ? reasons.join(" ") : null;
}

// ------------------------------------------------------------------ answers

export type MapAnswer =
  | { path: string; field: "kind"; value: string }
  | { path: string; field: "ignore" }
  | { path: string; field: "unit"; value: string }
  | { path: string; field: "also"; value: string[] }
  | { path: string; field: "guide"; value: string | "none" }
  | { path: string; field: "paper"; value: string | "ignore" }
  | { path: string; field: "confirm"; value: boolean };

/** One answer applied to the plan. Every answer counts as the item confirmed. */
export function applyAnswer(plan: IngestionPlan, answer: MapAnswer): void {
  const document = plan.documents.find((one) => one.path === answer.path);
  if (!document) return;
  switch (answer.field) {
    case "kind":
      document.kind = answer.value;
      if (document.target === "library") document.target = document.studyUnitCode ? "study_unit" : "qualification";
      break;
    case "ignore":
      document.ignored = true;
      break;
    case "unit":
      document.studyUnitCode = answer.value;
      document.target = "study_unit";
      document.source = "person";
      document.also = (document.also ?? []).filter((code) => code !== answer.value);
      break;
    case "also":
      document.also = answer.value.filter((code) => code !== document.studyUnitCode);
      break;
    case "guide":
      if (answer.value === "none") {
        document.guidePath = null;
        document.noGuide = true;
      } else {
        // A guide belongs to one paper of each version: taken from any other.
        for (const other of plan.documents) {
          if (other !== document && other.guidePath === answer.value && (other.version ?? "") === (document.version ?? "")) {
            other.guidePath = null;
            other.guideSource = undefined;
          }
        }
        document.guidePath = answer.value;
        document.noGuide = false;
      }
      document.guideSource = "person";
      break;
    case "paper":
      if (answer.value === "ignore") {
        document.ignored = true;
      } else {
        const paper = plan.documents.find((one) => one.path === answer.value);
        if (paper) {
          applyAnswer(plan, { path: paper.path, field: "guide", value: document.path });
          paper.confirmed = true;
        }
      }
      break;
    case "confirm":
      document.confirmed = answer.value;
      return;
  }
  document.confirmed = true;
}

/** Every item worth a look ticked at once. */
export function confirmAll(plan: IngestionPlan): void {
  for (const item of mapOf(plan, []).items) {
    if (item.state !== "look") continue;
    const document = plan.documents.find((one) => one.path === item.path);
    if (document) document.confirmed = true;
  }
}
