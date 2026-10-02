import { moduleCodeCore, normaliseCode } from "./module-codes";

/**
 * Which assessment criterion a paper means when it writes a code. Job sheet,
 * Roland's capture review of 2 October 2026.
 *
 * A captured question is linked to the criteria it assesses, and that link is
 * what the coverage check, the assessor's decision screen and the moderation
 * pack all read. Until 2 October the link was made by comparing the paper's
 * code with the curriculum's as plain text, across the whole provider. Both
 * halves were wrong:
 *
 *   **The same code means different criteria.** Every module of 121151 has
 *   its own IAC0101; in one provider's records the code `IAC0104` named 22
 *   different criteria. A text match took whichever came last.
 *
 *   **The same criterion has different codes.** A curriculum loaded from a
 *   folder's own summary numbers criteria straight through each module
 *   (`242303-001-00-KM-01-IAC10`); Curiosa's papers number them within each
 *   topic (`IAC0301`, topic 03, criterion 1). Those are the same criterion,
 *   and no text match will ever say so. That is why SU1 of 121151 showed 0 of
 *   31 criteria covered after all its papers were captured.
 *
 * So a code is resolved by rule, only among the criteria of the study unit the
 * paper belongs to, narrowed by the topic or module the paper names around
 * the question ("Activity 2.1 (KM0103 & KM0104)", "SECTION 1: KNOWLEDGE MODULE
 * 05 (KM-05)", "Practical Skill: PM0501"). Where the rule cannot pick one
 * criterion, nothing is linked and the reason is given: a wrong link is worse
 * than none, because it makes a gap look covered.
 *
 * Pure: no database, so it is tested against the real codes directly.
 */

export type CriterionCandidate = {
  id: string;
  /** As the curriculum records it: "IAC0301" or "242303-001-00-KM-01-IAC10". */
  code: string;
  /** "KM01" or "242303-001-00-KM-01". */
  moduleCode: string;
  /** "KM0103", or null where the curriculum gives no topics. */
  topicCode: string | null;
  /** Its place among its topic's criteria, from 1, in the curriculum's order. */
  positionInTopic: number | null;
};

export type Resolution = { id: string } | { id: null; reason: string };

type Hint = { module: string; topic: string | null };

/**
 * Module and topic codes named in a piece of text. "KM0103" is module KM01,
 * topic KM0103; "KM-05" and "KM5" are module KM05.
 */
export function hintsIn(text: string): Hint[] {
  const found = new Map<string, Hint>();
  for (const match of text.toUpperCase().matchAll(/\b(KM|PM|WM)[\s-]?(\d{1,2})(\d{2})?\b/g)) {
    const moduleCode = `${match[1]}${match[2].padStart(2, "0")}`;
    const topic = match[3] ? `${moduleCode}${match[3]}` : null;
    found.set(topic ?? moduleCode, { module: moduleCode, topic });
  }
  return [...found.values()];
}

const moduleOf = (code: string) => moduleCodeCore(code) ?? normaliseCode(code);

/** The trailing letters-and-digits of a code: "IAC10" from "242303-001-00-KM-01-IAC10". */
const tail = (code: string) => /[A-Z]+\d+$/.exec(normaliseCode(code))?.[0] ?? normaliseCode(code);

function narrow(candidates: CriterionCandidate[], hints: Hint[]): CriterionCandidate[] {
  const topics = hints.map((hint) => hint.topic).filter(Boolean) as string[];
  if (topics.length > 0) {
    const byTopic = candidates.filter((c) => c.topicCode && topics.includes(normaliseCode(c.topicCode)));
    if (byTopic.length > 0) return byTopic;
  }
  const modules = hints.map((hint) => hint.module);
  if (modules.length > 0) {
    const byModule = candidates.filter((c) => modules.includes(moduleOf(c.moduleCode)));
    if (byModule.length > 0) return byModule;
  }
  return candidates;
}

/**
 * The criterion a code means, among the study unit's own criteria.
 *
 * `hints` are the module and topic codes named near the question, most
 * specific first: the question's own text, its section, then the paper as a
 * whole. The first set that narrows the choice to one is the one used.
 */
export function resolveCriterion(
  code: string,
  candidates: CriterionCandidate[],
  hintSets: Hint[][],
): Resolution {
  const wanted = normaliseCode(code);
  if (!wanted) return { id: null, reason: "No code." };

  // 1. The code as the curriculum writes it, in full or by its last part.
  const exact = candidates.filter((c) => normaliseCode(c.code) === wanted || tail(c.code) === tail(wanted));
  if (exact.length === 1) return { id: exact[0].id };
  if (exact.length > 1) {
    for (const hints of hintSets) {
      const narrowed = narrow(exact, hints);
      if (narrowed.length === 1) return { id: narrowed[0].id };
    }
  }

  // 2. Topic and position: "IAC0301" is topic 03, its first criterion.
  const positional = /^([A-Z]+)(\d{2})(\d{2})$/.exec(tail(wanted));
  if (positional) {
    const topicNumber = positional[2];
    const position = Number(positional[3]);
    const inTopic = candidates.filter(
      (c) => c.topicCode && normaliseCode(c.topicCode).endsWith(topicNumber) && c.positionInTopic === position,
    );
    if (inTopic.length === 1) return { id: inTopic[0].id };
    for (const hints of hintSets) {
      const narrowed = narrow(inTopic, hints);
      if (narrowed.length === 1 && narrowed.length < inTopic.length) return { id: narrowed[0].id };
    }
    if (inTopic.length > 1) {
      return {
        id: null,
        reason: `${code} could be any of ${inTopic.length} criteria in this study unit (${[...new Set(inTopic.map((c) => c.topicCode))].join(", ")}), and the paper does not say which module it means here.`,
      };
    }
  }

  if (exact.length > 1) {
    return { id: null, reason: `${code} names ${exact.length} criteria in this study unit, and the paper does not say which module it means here.` };
  }
  return { id: null, reason: `${code} is not one of this study unit's assessment criteria.` };
}

/**
 * Every code on every question of a paper, resolved: the criterion ids per
 * question, in the paper's order, and what could not be linked.
 */
export function resolvePaperCriteria(
  paper: {
    title: string | null;
    sections: { title: string; instruction: string | null; items: { stem: string; criterionCodes: string[] }[] }[];
  },
  candidates: CriterionCandidate[],
  /** The whole paper's text, for the module or topic it names in its heading. */
  paperText = "",
): { perItem: string[][][]; unresolved: string[] } {
  const paperHints = hintsIn(`${paper.title ?? ""}\n${paperText}`);
  const unresolved = new Set<string>();
  const perItem = paper.sections.map((section) => {
    const sectionHints = hintsIn(`${section.title}\n${section.instruction ?? ""}`);
    return section.items.map((item) => {
      const hintSets = [hintsIn(item.stem), sectionHints, paperHints].filter((set) => set.length > 0);
      const ids: string[] = [];
      for (const code of item.criterionCodes) {
        const result = resolveCriterion(code, candidates, hintSets);
        if ("reason" in result) unresolved.add(result.reason);
        else if (!ids.includes(result.id)) ids.push(result.id);
      }
      return ids;
    });
  });
  return { perItem, unresolved: [...unresolved] };
}
