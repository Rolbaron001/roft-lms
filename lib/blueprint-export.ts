import { curriculumOutline } from "./authoring";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Writing the blueprint a folder should have carried.
 *
 * `lib/folder-plan.ts` reads `_control/blueprint.json` and, where a folder has
 * one, takes the curriculum from it directly - no model, no token, no quota,
 * and identical every time. Nothing produced one. The platform could read a
 * format it could not write, which left every provider either hand-authoring
 * JSON against a schema document or paying a model to re-derive a structure
 * the platform already held.
 *
 * So: once a qualification is in, its blueprint can be written out. That makes
 * the expensive route a one-off. Read 121151 once, however you like, download
 * the blueprint, drop it in the folder's `_control/`, and every import of that
 * folder afterwards - by this tenant, by a second site, after a restore, on
 * somebody else's machine - is free, instant and exact.
 *
 * It is also the worked example. Curiosa's programme-development process is
 * meant to emit one of these beside the documents it already produces; a real
 * file generated from a real qualification is a better specification of that
 * than FOLDER-BLUEPRINT.md is, and the two are tested against each other.
 *
 * What it deliberately does not carry is in `notes`, reported rather than
 * hidden. See FOLDER-BLUEPRINT.md, "What a blueprint does not carry".
 */

type BlueprintTopic = {
  code: string | null;
  title: string;
  elements: string[];
  criteria: string[];
};

type BlueprintModule = {
  code: string;
  title: string;
  credits?: number;
  /**
   * One shape, three names. The framework calls the groups under a knowledge
   * module topics, under a practical module skills, and under a workplace
   * module experiences; the reader accepts all three as aliases. Writing the
   * one that belongs to the component means a provider opening the file sees
   * their own vocabulary rather than a flattening of it.
   */
  topics?: BlueprintTopic[];
  skills?: BlueprintTopic[];
  experiences?: BlueprintTopic[];
};

export type BlueprintFile = {
  meta: {
    title: string;
    saqa_id?: string;
    curriculum_code?: string;
    nqf_level?: number;
    credits_total?: number;
  };
  purpose?: string;
  knowledge_modules: BlueprintModule[];
  practical_modules: BlueprintModule[];
  workplace_modules: BlueprintModule[];
  anomalies?: string[];
};

export type BlueprintExport = {
  file: BlueprintFile;
  /** A filename the folder's `_control/` can take as it stands. */
  filename: string;
  /** What is in the qualification and not in the file, said plainly. */
  notes: string[];
};

const GROUP_KEY = {
  knowledge: "topics",
  practical: "skills",
  workplace: "experiences",
} as const;

export async function blueprintFor(
  session: AuthenticatedSession,
  qualificationId: string,
): Promise<BlueprintExport> {
  // The export is part of building a qualification, not of delivering one.
  // Reading the same curriculum on screen needs only course:read; writing the
  // file that will rebuild it elsewhere is an administrator's act.
  assertSessionCan(session, "qualification:manage");

  return blueprintFrom(await curriculumOutline(session, qualificationId));
}

/**
 * The same thing, from an outline already read.
 *
 * Pure, and separate so the qualification page can show what the export would
 * leave behind without reading the whole curriculum a second time to find out.
 * It is also what makes the round-trip test possible: this half touches no
 * database and no session.
 */
export function blueprintFrom(
  outline: Awaited<ReturnType<typeof curriculumOutline>>,
): BlueprintExport {
  const { qualification } = outline;
  const notes: string[] = [];

  const file: BlueprintFile = {
    meta: { title: qualification.title },
    knowledge_modules: [],
    practical_modules: [],
    workplace_modules: [],
  };

  // Omitted rather than written as null: the reader treats a missing field as
  // blank, and a file full of nulls reads as though something failed.
  if (qualification.saqaId) file.meta.saqa_id = qualification.saqaId;
  if (qualification.curriculumCode)
    file.meta.curriculum_code = qualification.curriculumCode;
  if (typeof qualification.nqfLevel === "number")
    file.meta.nqf_level = qualification.nqfLevel;
  if (typeof qualification.totalCredits === "number")
    file.meta.credits_total = qualification.totalCredits;
  if (qualification.description) file.purpose = qualification.description;

  for (const entry of outline.modules) {
    const topics: BlueprintTopic[] = entry.topics.map((topic) => ({
      code: topic.code ?? null,
      title: topic.title,
      /*
       * In the platform's own order, which is the document's order. The
       * elements under a topic are a sequence - a curriculum teaches them in
       * the order it lists them - and sorting or grouping them here would
       * quietly reorder the curriculum on the way back in.
       */
      elements: topic.elements.map((element) => element.description),
      criteria: topic.criteria.map((criterion) => criterion.description),
    }));

    if (entry.looseCriteria.length > 0) {
      notes.push(
        `${entry.code} has ${entry.looseCriteria.length} assessment criteria that sit on the module rather than under a topic. A blueprint carries criteria under topics, so these are not in the file — put them under a topic first if they matter.`,
      );
    }

    const component = entry.component as keyof typeof GROUP_KEY;
    const list =
      component === "knowledge"
        ? file.knowledge_modules
        : component === "practical"
          ? file.practical_modules
          : component === "workplace"
            ? file.workplace_modules
            : null;

    if (!list) {
      // "general" is a module belonging to a tenant outside the occupational
      // system. It has nowhere to go: the blueprint's three lists are what set
      // a module's component, so there is no fourth list to put it in.
      notes.push(
        `${entry.code} is a general module rather than a knowledge, practical or workplace one, and a blueprint has no list for it. It is not in the file.`,
      );
      continue;
    }

    const written: BlueprintModule = { code: entry.code, title: entry.title };
    if (typeof entry.credits === "number") written.credits = entry.credits;
    written[GROUP_KEY[component]] = topics;
    list.push(written);
  }

  if (outline.studyUnits.length > 0) {
    notes.push(
      `The ${outline.studyUnits.length} study units are not in the file. A curriculum publishes modules and says nothing about how a provider groups them, so study units stay with the alignment document and the folder's own filenames.`,
    );
  }

  /*
   * Element kinds do not survive the round trip, and saying so beats finding
   * out.
   *
   * The curriculum parser distinguishes six - a topic element, a required
   * performance, applied knowledge, a work activity, contextual knowledge,
   * supporting evidence. A blueprint carries one list per topic, and the
   * commit path re-derives the kind from the module's component, so anything
   * that was applied knowledge under a practical module comes back as a
   * required performance. The text is exact; the label is not.
   */
  const kinds = new Set(
    outline.modules.flatMap((one) =>
      one.topics.flatMap((topic) =>
        topic.elements.map((element) => element.kind),
      ),
    ),
  );
  if (kinds.size > 1) {
    notes.push(
      "This curriculum distinguishes more than one kind of topic element (applied knowledge, supporting evidence and so on). A blueprint carries one list per topic, so re-importing from it would label them all by the module's component. The wording of every line is carried exactly.",
    );
  }

  const stem =
    qualification.saqaId ??
    qualification.curriculumCode ??
    qualification.title.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 40);

  return { file, filename: `${stem}-blueprint.json`, notes };
}

/** The file as it should be written, indented so a person can read it. */
export function blueprintJson(file: BlueprintFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}
