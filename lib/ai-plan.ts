import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

/**
 * What a folder is proposing to put into the platform.
 *
 * Built before anything is written, and built from the folder's own structured
 * files wherever they exist rather than from a model reading prose. A
 * programme folder produced by the client's own development system carries
 * `_control/blueprint.json` - the qualification, its exit level outcomes and
 * all fifteen modules with their topics - and `_control/register.csv`, a
 * manifest naming every document, its study unit and its version.
 *
 * Where those are present the structure is not a judgement at all. It is a
 * file, read directly, free, in milliseconds, and incapable of inventing an
 * assessment criterion. The model is then used only for what the manifest does
 * not say, and for folders that have no manifest.
 *
 * That ordering matters more than it looks. The expensive, slow and fallible
 * path should be the fallback, not the default, and a platform that sends a
 * perfectly good JSON file to a language model to be described back to it has
 * misunderstood what it has.
 *
 * This module reads files and imports nothing from the database.
 */

export type PlannedModule = {
  component: "knowledge" | "practical" | "workplace";
  code: string;
  title: string;
  credits: number | null;
  topics: {
    code: string | null;
    title: string;
    elements: string[];
    criteria: string[];
  }[];
};

export type PlannedDocument = {
  /** Relative to the folder that was pointed at. */
  path: string;
  filename: string;
  bytes: number;
  /** Where it belongs. */
  target: "qualification" | "study_unit" | "library";
  /** A `programmeDocumentKind` when the target is a qualification or unit. */
  kind: string | null;
  /** A `libraryCategory` when the target is the library. */
  category: string | null;
  /** The study unit's code, where the manifest names one. */
  studyUnitCode: string | null;
  title: string;
  version: string | null;
  /** Why it was filed the way it was, so a person can check the reasoning. */
  because: string;
};

export type IngestionPlan = {
  source: "blueprint" | "documents";
  qualification: {
    title: string;
    saqaId: string | null;
    curriculumCode: string | null;
    nqfLevel: number | null;
    credits: number | null;
    purpose: string | null;
  };
  modules: PlannedModule[];
  studyUnits: { code: string; title: string }[];
  documents: PlannedDocument[];
  /** Everything a person should read before committing any of it. */
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Classifying a document
// ---------------------------------------------------------------------------

/**
 * Which kind of programme document a file is, from its name and folder.
 *
 * Rules rather than a model, because the client's filenames are systematic and
 * a rule that is wrong is wrong visibly and in one place. Everything the rules
 * do not recognise is filed as "other" and listed, rather than guessed at.
 */
const DOCUMENT_RULES: { match: RegExp; kind: string }[] = [
  { match: /qualification document/i, kind: "qualification_document" },
  { match: /curriculum document/i, kind: "curriculum_document" },
  { match: /assessment specification/i, kind: "assessment_specification" },
  { match: /alignment matrix/i, kind: "alignment_matrix" },
  { match: /theory guide/i, kind: "theory_guide" },
  { match: /learner handbook/i, kind: "learner_handbook" },
  { match: /workbook memo|memorandum.*workbook/i, kind: "workbook_memorandum" },
  { match: /workbook/i, kind: "workbook" },
  { match: /summative memo/i, kind: "summative_memorandum" },
  { match: /summative/i, kind: "summative_assessment" },
  { match: /coach guide/i, kind: "workplace_coach_guide" },
  { match: /workplace agreement/i, kind: "workplace_agreement" },
  { match: /sign.?off/i, kind: "workplace_signoff" },
  { match: /learning programme guide|programme guide/i, kind: "learning_programme_guide" },
  { match: /facilitation plan/i, kind: "facilitation_plan" },
  { match: /rollout|roll.?out schedule/i, kind: "rollout_schedule" },
  { match: /induction/i, kind: "induction" },
  { match: /roadmap/i, kind: "learning_roadmap" },
];

/**
 * Business documents, which go to the library rather than to a qualification.
 *
 * A QMS policy is not a programme document. It governs the provider, applies
 * across every qualification they offer, and belongs where an auditor looks
 * for policies - which is the library, not buried under one qualification.
 */
const LIBRARY_RULES: { match: RegExp; category: string }[] = [
  { match: /qms policy|quality management system|policy \d/i, category: "policy" },
  { match: /accreditation|sdp\d|qcto\//i, category: "accreditation" },
  { match: /learner agreement|contract/i, category: "contract" },
  { match: /paia|popia|b-bbee|tax clearance/i, category: "statutory" },
];

/** The study unit a filename names, as SU1, SU 1 or Study Unit 1. */
export function studyUnitFromName(name: string): string | null {
  const match = name.match(/\bSU\s?(\d{1,2})\b/i) ??
    name.match(/\bstudy unit\s+(\d{1,2})\b/i);
  return match ? `SU${match[1]}` : null;
}

export function classifyDocument(
  relativePath: string,
  filename: string,
  bytes: number,
): PlannedDocument {
  const haystack = `${relativePath} ${filename}`;

  for (const rule of LIBRARY_RULES) {
    if (rule.match.test(haystack)) {
      return {
        path: relativePath,
        filename,
        bytes,
        target: "library",
        kind: null,
        category: rule.category,
        studyUnitCode: null,
        title: cleanTitle(filename),
        version: null,
        because: `Matched "${rule.match.source}" - it governs the provider rather than one qualification, so it goes to the document library.`,
      };
    }
  }

  for (const rule of DOCUMENT_RULES) {
    if (rule.match.test(haystack)) {
      const unit = studyUnitFromName(filename);
      return {
        path: relativePath,
        filename,
        bytes,
        target: unit ? "study_unit" : "qualification",
        kind: rule.kind,
        category: null,
        studyUnitCode: unit,
        title: cleanTitle(filename),
        version: null,
        because: unit
          ? `Recognised as a ${rule.kind.replace(/_/g, " ")}, and the filename names ${unit}.`
          : `Recognised as a ${rule.kind.replace(/_/g, " ")}.`,
      };
    }
  }

  return {
    path: relativePath,
    filename,
    bytes,
    target: "qualification",
    kind: "other",
    category: null,
    studyUnitCode: studyUnitFromName(filename),
    title: cleanTitle(filename),
    version: null,
    because:
      "Not recognised by name. Filed against the qualification as 'other' rather than guessed at - change it after it lands, or say what it is and the rule can be added.",
  };
}

/** A filename without its extension, its SAQA prefix, or its underscores. */
function cleanTitle(filename: string): string {
  return filename
    .replace(new RegExp(`${extname(filename)}$`), "")
    .replace(/^\d{5,6}\s*[-\s]*/, "")
    .replace(/[_]+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// The structured path
// ---------------------------------------------------------------------------

type Blueprint = {
  meta?: Record<string, unknown>;
  purpose?: string;
  knowledge_modules?: RawModule[];
  practical_modules?: RawModule[];
  workplace_modules?: RawModule[];
  anomalies?: unknown[];
  corrections?: unknown[];
};

type RawModule = {
  code?: string;
  short?: string;
  title?: string;
  credits?: number;
  topics?: RawTopic[];
  skills?: RawTopic[];
  experiences?: RawTopic[];
};

type RawTopic = {
  code?: string;
  title?: string;
  elements?: unknown;
  criteria?: unknown;
  activities?: unknown;
  knowledge?: unknown;
  [key: string]: unknown;
};

/** Anything the blueprint offers as a list of strings, however it names it. */
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) =>
      typeof item === "string"
        ? item
        : item && typeof item === "object" && "description" in item
          ? String((item as { description: unknown }).description)
          : item && typeof item === "object" && "text" in item
            ? String((item as { text: unknown }).text)
            : "",
    )
    .map((item) => item.trim())
    .filter(Boolean);
}

function plannedModules(
  raw: RawModule[] | undefined,
  component: PlannedModule["component"],
): PlannedModule[] {
  return (raw ?? []).map((module) => {
    // Knowledge modules carry topics, practical ones skills, workplace ones
    // experiences. The same shape under three names, because the framework
    // names them three ways and the blueprint follows the framework.
    const groups = module.topics ?? module.skills ?? module.experiences ?? [];

    return {
      component,
      code: module.code ?? module.short ?? "",
      title: module.title ?? "",
      credits: typeof module.credits === "number" ? module.credits : null,
      topics: groups.map((group) => ({
        code: group.code ?? null,
        title: group.title ?? "",
        elements: [
          ...strings(group.elements),
          ...strings(group.activities),
          ...strings(group.knowledge),
        ],
        criteria: strings(group.criteria),
      })),
    };
  });
}

/**
 * Reads `_control/blueprint.json`, if the folder has one.
 *
 * Returns null rather than throwing on anything unexpected: a folder without a
 * blueprint is the ordinary case, not an error, and a malformed one should
 * fall through to the model rather than stop the import.
 */
export async function readBlueprint(
  folder: string,
): Promise<IngestionPlan | null> {
  let parsed: Blueprint;
  try {
    parsed = JSON.parse(
      await readFile(join(folder, "_control", "blueprint.json"), "utf8"),
    ) as Blueprint;
  } catch {
    return null;
  }

  const meta = parsed.meta ?? {};
  const modules = [
    ...plannedModules(parsed.knowledge_modules, "knowledge"),
    ...plannedModules(parsed.practical_modules, "practical"),
    ...plannedModules(parsed.workplace_modules, "workplace"),
  ].filter((module) => module.code && module.title);

  if (modules.length === 0) return null;

  const warnings: string[] = [
    "Read from the folder's own blueprint.json rather than by a model reading the documents. The structure below is what that file says, exactly, and nothing in it has been inferred.",
  ];

  // The client's own build records what it could not reconcile. Surfacing it
  // is the whole reason it exists, and it would otherwise sit in a file nobody
  // opens.
  for (const entry of [
    ...(parsed.anomalies ?? []),
    ...(parsed.corrections ?? []),
  ]) {
    const text =
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object"
          ? Object.values(entry).filter(Boolean).join(" - ")
          : "";
    if (text) warnings.push(`From the programme build: ${text}`);
  }

  return {
    source: "blueprint",
    qualification: {
      title: String(meta.title ?? ""),
      saqaId: meta.saqa_id ? String(meta.saqa_id) : null,
      curriculumCode: meta.curriculum_code ? String(meta.curriculum_code) : null,
      nqfLevel: typeof meta.nqf_level === "number" ? meta.nqf_level : null,
      credits:
        typeof meta.credits_total === "number" ? meta.credits_total : null,
      purpose: parsed.purpose ?? null,
    },
    modules,
    studyUnits: [],
    documents: [],
    warnings,
  };
}

/**
 * Reads `_control/register.csv`, the manifest of every artefact.
 *
 * Where it exists, which study unit a document belongs to is a fact rather
 * than something guessed from a filename, and so is its version. Both are
 * things the client's own build recorded and that no amount of reading the
 * document would recover.
 */
export async function readRegister(
  folder: string,
): Promise<Map<string, { studyUnit: string | null; title: string; version: string | null }>> {
  const found = new Map<
    string,
    { studyUnit: string | null; title: string; version: string | null }
  >();

  let text: string;
  try {
    text = await readFile(join(folder, "_control", "register.csv"), "utf8");
  } catch {
    return found;
  }

  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return found;

  const header = splitCsv(lines[0]).map((cell) => cell.trim().toLowerCase());
  const at = (name: string) => header.indexOf(name);
  const pathAt = at("path");
  const unitAt = at("study_unit");
  const titleAt = at("title");
  const versionAt = at("version");

  if (pathAt === -1) return found;

  for (const line of lines.slice(1)) {
    const cells = splitCsv(line);
    const path = (cells[pathAt] ?? "").trim().replace(/\\/g, "/");
    if (!path) continue;

    const unit = (cells[unitAt] ?? "").trim();
    found.set(path, {
      // "ALL" means it applies across the qualification rather than to a unit.
      studyUnit: unit && unit.toUpperCase() !== "ALL" ? unit : null,
      title: (cells[titleAt] ?? "").trim(),
      version: (cells[versionAt] ?? "").trim() || null,
    });
  }

  return found;
}

/** Enough CSV for a manifest: quoted cells with escaped quotes inside. */
function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (quoted) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"') quoted = true;
    else if (character === ",") {
      cells.push(current);
      current = "";
    } else current += character;
  }

  cells.push(current);
  return cells;
}
