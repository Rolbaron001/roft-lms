import {
  ELEMENT_KINDS_BY_COMPONENT,
  type ElementKind,
} from "./curriculum-shape";

/**
 * Reading a curriculum document into a proposal.
 *
 * A curriculum document is written to a house style, and that style is regular
 * enough to read — but only within a component. The three read differently:
 *
 *   Knowledge  GUIDELINES FOR TOPICS, then topics carrying a percentage of the
 *              module, each with Topic Elements and Internal Assessment
 *              Criteria.
 *   Practical  GUIDELINES FOR PRACTICAL SKILLS, then a skill per PS code, each
 *              with Required Performance and Applied Knowledge, then criteria.
 *   Workplace  GUIDELINES FOR WORK EXPERIENCE, then an experience per WE code,
 *              each with Work Activities, Contextual Workplace Knowledge and
 *              Supporting Evidence — and no criteria at all, because a work
 *              experience module is evidenced by a signed logbook.
 *
 * Documents also differ between qualifications: 121150 numbers a module KM01
 * and 121151 numbers the same thing KM-01, and codes repeat between modules,
 * so KT0101 in KM01 is a different line from KT0101 in KM05. Everything here
 * is therefore scoped to the module it was found in.
 *
 * What comes out is a *proposal*, never a curriculum. Nothing is written from
 * it until somebody has read it against the document and said so. That is not
 * caution for its own sake: every question, lesson and assessor decision
 * downstream references these codes, so a mis-parse propagates silently into
 * all of it, and a person reading two columns side by side catches in a minute
 * what no heuristic here will.
 *
 * So this under-claims deliberately. A line that does not fit is reported as
 * unread rather than guessed at, because a visible gap gets fixed and a
 * confident wrong answer does not.
 */

export type ParsedElement = {
  code: string;
  kind: ElementKind;
  description: string;
};

export type ParsedTopic = {
  code: string;
  title: string;
  weightPercent: number | null;
  elements: ParsedElement[];
  criteria: { code: string; description: string }[];
};

export type ParsedModule = {
  code: string;
  component: "knowledge" | "practical" | "workplace";
  title: string;
  credits: number | null;
  nqfLevel: number | null;
  topics: ParsedTopic[];
};

/**
 * What the front matter of a curriculum document says about the qualification
 * itself, as opposed to about its modules.
 *
 * Every field is optional. A document that states none of them is still worth
 * reading for its modules, and a blank field on the confirmation screen is a
 * box somebody types into — which is exactly what they would have done anyway.
 */
export type ParsedQualification = {
  title: string | null;
  /** The curriculum code the document prints, e.g. 441601-001-00-00. */
  curriculumCode: string | null;
  nqfLevel: number | null;
  totalCredits: number | null;
};

export type ParsedCurriculum = {
  /**
   * Never guessed at from the modules. A qualification created with a title
   * inferred from its first module would be wrong in a way nobody would think
   * to check.
   */
  qualification: ParsedQualification;
  modules: ParsedModule[];
  /**
   * Things worth a person's eye. Never fatal: a document that parses partly is
   * a better starting point than an empty form, so long as what was missed is
   * said out loud.
   */
  notes: string[];
};

type Component = ParsedModule["component"];

const COMPONENT_BY_PREFIX: Record<string, Component> = {
  KM: "knowledge",
  PM: "practical",
  WM: "workplace",
};

/**
 * A module header, in either convention:
 *   441601-001-00- KM01, Introduction to Organisations..., NQF Level 5, Credits 12.
 *   242303-001-00-KM-01, Creating and Implementing..., NQF Level 6, Credits 8.
 *
 * The qualification code in front varies and is skipped rather than matched:
 * documents put a bullet, a repeated code, or nothing at all there.
 */
const MODULE_HEADER =
  /^(?:.{0,40}?[\s:\-])?(KM|PM|WM)-?(\d{2})[,.:]?\s+(.+?)[,.]?\s*NQF\s+Level\s+(\d+)[,.]?\s*Credits?\s+(\d+)/i;

/**
 * The front-matter table every curriculum document opens with:
 *
 *   Curriculum Code | Qualification Title | NQF Level
 *   441601-001-00-00  Higher Occupational Certificate:
 *                     Human Resource Management
 *                     Administrator
 *   5
 *
 * The cells arrive as separate lines because that is how a table extracts, so
 * the code line starts the title and the bare digit ends it.
 */
const FRONT_MATTER_HEADER = /Curriculum Code/i;
const QUALIFICATION_CODE = /^([0-9]{5,6}-[0-9]{3}-[0-9]{2}(?:-[0-9]{2})?)[:.]?\s*(.*)$/;
const BARE_LEVEL = /^([1-9]|10)$/;
const QUALIFICATION_CREDITS =
  /Total number of credits for the qualification[:\s]+([0-9]{1,4})/i;
const COMPONENT_CREDITS =
  /Total number of credits for [^:]*Modules[:\s]+([0-9]{1,4})/gi;

/** The running header repeated on every page, e.g. `441601-001-00-00-00 HRM Administrator 12`. */
const PAGE_HEADER = /^[\d-]{10,}:?\s+.*\s+\d{1,4}$/;

/** A table-of-contents line: a heading followed by dot leaders and a page number. */
const CONTENTS_LINE = /\.{4,}\s*\d{1,4}\s*$/;

/**
 * A coded line inside a topic. Two digits as well as four, because contextual
 * knowledge and supporting evidence are numbered WK01 and SE01.
 */
const CODED_LINE = /^([A-Z]{2,3}\d{2,4})[:.]?\s+(.*)$/;

/**
 * How each component is laid out. Keeping this as data rather than as branches
 * is what makes the three readable side by side — and what makes it obvious
 * that the workplace plan has no criteria entry, which is the domain rule
 * rather than an omission.
 */
const PLANS: Record<
  Component,
  {
    guidelines: RegExp;
    /**
     * Identifies a topic line, capturing code, title and optional percentage.
     * Absent when the topic prefix has to be read from the module itself.
     */
    topic?: RegExp;
    topicFromFirstCode?: boolean;
    sections: { heading: RegExp; collect: ElementKind | "criteria" }[];
  }
> = {
  knowledge: {
    guidelines: /^GUIDELINES FOR TOPICS/i,
    // A knowledge topic is distinguished by the percentage of the module it
    // carries. Its prefix is not reliable: KM01 numbers its topics KM0101 and
    // KM05 numbers its topics KT0501, which is also an element prefix.
    topic: /^([A-Z]{2}\d{4})[:.]?\s+(.+?)\s*\((\d{1,3})\s*%\)\s*$/,
    sections: [
      { heading: /^Topic Elements\b/i, collect: "knowledge_topic" },
      { heading: /^Internal Assessment Criteria\b/i, collect: "criteria" },
    ],
  },
  practical: {
    guidelines: /^GUIDELINES FOR PRACTICAL SKILLS/i,
    // The two documents disagree about what PS means: in 121150 a PS code is
    // the skill itself, in 121151 it is an activity inside one. So the prefix
    // that means "topic" is read from each module rather than fixed here.
    topicFromFirstCode: true,
    sections: [
      { heading: /^Required Performance\b/i, collect: "practical_activity" },
      {
        heading: /^Skills activities that must be mastered/i,
        collect: "practical_activity",
      },
      { heading: /^Applied knowledge\b/i, collect: "applied_knowledge" },
      { heading: /^Internal Assessment Criteria\b/i, collect: "criteria" },
    ],
  },
  workplace: {
    guidelines: /^GUIDELINES FOR WORK EXPERIENCE/i,
    topicFromFirstCode: true,
    sections: [
      { heading: /^Work activities\b/i, collect: "work_activity" },
      {
        heading: /^Contextual Workplace Knowledge that must be tested/i,
        collect: "contextual_knowledge",
      },
      {
        heading: /^Supporting Evidence that must be collected/i,
        collect: "supporting_evidence",
      },
    ],
  },
};

/**
 * Lines that end a section without starting one. What follows belongs to the
 * module, not to the topic before it.
 */
const SECTION_END =
  /^(Provider Programme Approval Requirements|Physical Requirements|Human Resource Requirements|Legal Requirements|Purpose of the|Knowledge Topics|Skills included in the Module|List of Experiences|Total number of credits)/i;

/**
 * Reads the qualification's own details out of the front matter.
 *
 * Deliberately conservative. The curriculum document does not carry a SAQA ID
 * at all — only the qualification document does — so that field is never
 * offered here rather than being filled with something that looks like one.
 */
export function parseQualificationDetails(lines: string[]): ParsedQualification {
  const result: ParsedQualification = {
    title: null,
    curriculumCode: null,
    nqfLevel: null,
    totalCredits: null,
  };

  // The table sits at the very top; looking further risks picking up a module
  // code from the summary list and calling it the qualification.
  const headerAt = lines
    .slice(0, 20)
    .findIndex((line) => FRONT_MATTER_HEADER.test(line));

  if (headerAt !== -1) {
    for (let index = headerAt; index < Math.min(headerAt + 12, lines.length); index++) {
      const match = QUALIFICATION_CODE.exec(lines[index]);
      if (!match) continue;

      result.curriculumCode = match[1];

      // The title runs from the rest of that line until a line that is just
      // the NQF level. Anything else on the way is a wrapped part of it.
      const parts = match[2] ? [match[2]] : [];
      for (let next = index + 1; next < Math.min(index + 8, lines.length); next++) {
        const level = BARE_LEVEL.exec(lines[next]);
        if (level) {
          result.nqfLevel = Number(level[1]);
          break;
        }
        parts.push(lines[next]);
      }

      const title = parts.join(" ").replace(/\s{2,}/g, " ").trim();
      if (title.length >= 3) result.title = title;
      break;
    }
  }

  const stated = QUALIFICATION_CREDITS.exec(lines.join("\n"));
  if (stated) {
    result.totalCredits = Number(stated[1]);
  } else {
    // Not every document prints a qualification total, but all of them print
    // one per component. Adding those up is the document's own arithmetic
    // rather than an assumption of ours.
    const joined = lines.join("\n");
    COMPONENT_CREDITS.lastIndex = 0;
    let total = 0;
    let found = 0;
    for (const match of joined.matchAll(COMPONENT_CREDITS)) {
      total += Number(match[1]);
      found += 1;
    }
    if (found > 0) result.totalCredits = total;
  }

  return result;
}

export function parseCurriculumText(text: string): ParsedCurriculum {
  const lines = text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !PAGE_HEADER.test(line) &&
        !CONTENTS_LINE.test(line),
    );

  const candidates = findModuleHeaders(lines);
  const notes: string[] = [];

  if (candidates.length === 0) {
    return {
      qualification: parseQualificationDetails(lines),
      modules: [],
      notes: [
        "No module headers were found. Either this is not a curriculum document, or its text could not be read — if it is a scan, the platform cannot read it.",
      ],
    };
  }

  const boundaries = candidates.map((candidate) => candidate.index);
  const modules: ParsedModule[] = [];

  // A module code appears several times: in the contents, in the summary list,
  // in the details, and — for work experience — again in the statement at the
  // back. The occurrence that matters is the one followed by actual content,
  // so each is tried and the richest kept, rather than assuming a position.
  const byCode = new Map<string, ParsedModule>();

  candidates.forEach((candidate, position) => {
    const from = candidate.index + 1;
    const to =
      position + 1 < boundaries.length ? boundaries[position + 1] : lines.length;

    const topics = parseTopics(lines.slice(from, to), candidate.entry.component);
    const parsed = { ...candidate.entry, topics };
    const existing = byCode.get(parsed.code);

    if (!existing || weight(parsed) > weight(existing)) {
      byCode.set(parsed.code, parsed);
    }
  });

  modules.push(...byCode.values());
  modules.sort((a, b) => a.code.localeCompare(b.code));

  notes.push(...review(modules));

  return { qualification: parseQualificationDetails(lines), modules, notes };
}

/** How much content a reading of a module found, for choosing between readings. */
function weight(entry: ParsedModule): number {
  return entry.topics.reduce(
    (total, topic) => total + 1 + topic.elements.length + topic.criteria.length,
    0,
  );
}

function findModuleHeaders(lines: string[]) {
  const found: { index: number; entry: ParsedModule }[] = [];

  lines.forEach((line, index) => {
    // Headers wrap: the title runs on and NQF Level lands on the next line, or
    // the one after. Joining is cheaper than a multi-line grammar.
    const candidates = [
      line,
      `${line} ${lines[index + 1] ?? ""}`,
      `${line} ${lines[index + 1] ?? ""} ${lines[index + 2] ?? ""}`,
    ];

    for (const candidate of candidates) {
      const match = MODULE_HEADER.exec(candidate);
      if (!match) continue;

      const [, prefix, number, rawTitle, level, credits] = match;

      found.push({
        index,
        entry: {
          code: `${prefix.toUpperCase()}${number}`,
          component: COMPONENT_BY_PREFIX[prefix.toUpperCase()],
          title: cleanTitle(rawTitle),
          credits: Number(credits),
          nqfLevel: Number(level),
          topics: [],
        },
      });
      return;
    }
  });

  return found;
}

/** Topics, elements and criteria within one module's slice of the document. */
function parseTopics(lines: string[], component: Component): ParsedTopic[] {
  const plan = PLANS[component];
  const allowed = ELEMENT_KINDS_BY_COMPONENT[component] ?? [];

  // Everything before the guidelines heading is the module's purpose and a
  // summary list that repeats what the guidelines then set out in full.
  // Starting at the heading avoids reading every topic twice. When there is no
  // such heading the whole slice is read, which is worse but not nothing.
  const begin = lines.findIndex((line) => plan.guidelines.test(line));
  const body = begin === -1 ? lines : lines.slice(begin + 1);

  const pattern = plan.topic ?? topicPatternFor(body);

  // Without a first coded line there is nothing to anchor to, and guessing a
  // prefix here is how one document's activities become another's topics.
  if (!pattern) return [];

  const topics: ParsedTopic[] = [];
  let current: ParsedTopic | null = null;
  let collecting: ElementKind | "criteria" | null = null;

  for (let index = 0; index < body.length; index++) {
    const line = body[index];

    // A topic header wraps as often as not: the title runs on and the
    // percentage lands on the next line. Matching only single lines silently
    // loses every topic in whole modules, which reads as the document being
    // empty rather than as the reader being wrong.
    let topic = pattern.exec(line);
    let consumed = 0;

    if (!topic) {
      for (let extra = 1; extra <= 2 && index + extra < body.length; extra++) {
        const joined = body.slice(index, index + extra + 1).join(" ");
        const match = pattern.exec(joined);
        if (match) {
          topic = match;
          consumed = extra;
          break;
        }
      }
    }

    if (topic) {
      current = {
        code: topic[1],
        title: cleanTitle(stripRepeatedCode(topic[2], topic[1])),
        weightPercent: topic[3] ? Number(topic[3]) : null,
        elements: [],
        criteria: [],
      };
      topics.push(current);
      collecting = null;
      index += consumed;
      continue;
    }

    if (!current) continue;

    const section = plan.sections.find((entry) => entry.heading.test(line));
    if (section) {
      collecting = section.collect;
      continue;
    }

    if (SECTION_END.test(line)) {
      collecting = null;
      continue;
    }

    if (!collecting) continue;

    const coded = CODED_LINE.exec(line);

    if (coded) {
      const [, code, description] = coded;

      if (collecting === "criteria") {
        current.criteria.push({ code, description: description.trim() });
      } else if (allowed.includes(collecting)) {
        current.elements.push({
          code,
          kind: collecting,
          description: description.trim(),
        });
      }
      continue;
    }

    // Not a coded line, so it continues the one before it: descriptions wrap
    // across two and three lines, and bullet lists hang under a code.
    const target =
      collecting === "criteria" ? current.criteria : current.elements;
    const last = target[target.length - 1];
    if (last) last.description = `${last.description} ${line}`.trim();
  }

  return topics;
}

/** What a person should look at before accepting any of this. */
function review(modules: ParsedModule[]): string[] {
  const notes: string[] = [];

  for (const entry of modules) {
    if (entry.topics.length === 0) {
      notes.push(
        `${entry.code} was found but nothing under it was. Add its topics by hand, or check that page of the document.`,
      );
      continue;
    }

    const weighted = entry.topics.filter((t) => t.weightPercent !== null);
    const total = weighted.reduce((sum, t) => sum + (t.weightPercent ?? 0), 0);

    if (weighted.length === entry.topics.length && total !== 100) {
      notes.push(
        `${entry.code}: its topic percentages come to ${total}, not 100. This is what the document says — check it before accepting.`,
      );
    }

    // A code repeated where the platform requires a unique one. This is a
    // fault in the document rather than in the reading of it, and it is the
    // kind that is invisible on the page: 121150's first work experience
    // module numbers five different activities WA0201. Only the first of them
    // can be stored, so it has to be said before somebody accepts the module
    // and quietly loses the other four.
    //
    // The two scopes differ because the platform's do: a line to teach is
    // unique within its topic, and a criterion within its whole module.
    for (const topic of entry.topics) {
      for (const code of repeats(topic.elements.map((e) => e.code))) {
        notes.push(
          `${entry.code} / ${topic.code}: the document uses ${code} more than once. Only the first can be stored — the rest need their own codes.`,
        );
      }
    }

    for (const code of repeats(
      entry.topics.flatMap((t) => t.criteria.map((c) => c.code)),
    )) {
      notes.push(
        `${entry.code}: the document uses criterion ${code} more than once in this entry. Only the first can be stored — the rest need their own codes.`,
      );
    }

    for (const topic of entry.topics) {
      if (topic.elements.length === 0) {
        notes.push(`${entry.code} / ${topic.code}: nothing to teach was read.`);
      }
      if (entry.component !== "workplace" && topic.criteria.length === 0) {
        notes.push(
          `${entry.code} / ${topic.code}: no assessment criteria were read.`,
        );
      }
    }
  }

  return notes;
}

/**
 * The prefix that means "topic" in this module, taken from the first coded
 * line after the guidelines heading. That line is the first skill or the first
 * experience by construction, so its prefix is the module's own answer to a
 * question the documents answer inconsistently.
 */
function topicPatternFor(body: string[]): RegExp | null {
  for (const line of body) {
    const coded = CODED_LINE.exec(line);
    if (coded) {
      const prefix = coded[1].slice(0, 2);
      return new RegExp(`^(${prefix}${"\\d"}{2,4})[:.]?${"\\s"}+(.+)$`);
    }
  }
  return null;
}

/**
 * Some modules print the code twice: `PM0101: PM0101 Administer communications`.
 * The second one is not part of the title.
 */
function stripRepeatedCode(title: string, code: string): string {
  return title.startsWith(code)
    ? title.slice(code.length).replace(/^[:.\s]+/, "")
    : title;
}

/** Codes that appear more than once in a list where each must be distinct. */
function repeats(codes: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();

  for (const code of codes) {
    if (seen.has(code)) repeated.add(code);
    seen.add(code);
  }

  return [...repeated];
}

/** Trailing punctuation from the document's sentence style, not part of a title. */
function cleanTitle(value: string): string {
  return value.trim().replace(/[.,;:]+$/, "").trim();
}
