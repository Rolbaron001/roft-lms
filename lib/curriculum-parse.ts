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
  /^(?:[\d\-.:()\s]{0,40})?(KM|PM|WM)[\s\-]?(\d{2})(?!\d)[,.:]?\s+(.+)$/i;

/**
 * Level and credits are read separately from the header line rather than being
 * required by it.
 *
 * They used to be part of the pattern above, which meant a document that wrote
 * "Credit Value 12" instead of "Credits 12", or carried the credits in a table
 * column that extracts onto its own line, matched nothing at all — not a
 * module with a missing field, but no modules whatsoever, and therefore no
 * topics and no assessment criteria either. One word of house style decided
 * whether the whole curriculum could be read.
 *
 * They are optional here. What a module is missing is reported for the
 * reviewer to fill in; it is not grounds for pretending the module is absent.
 */
const LEVEL_ANYWHERE = /\bNQF\s*Level[:\s\-]*(\d{1,2})\b/i;
const CREDITS_ANYWHERE = /\bCredits?(?:\s*Value)?[:\s\-]*(\d{1,3})\b/i;

/** Where a title stops and the header's other fields begin. */
const TITLE_ENDS_AT = /[,.]?\s*(?:NQF\s*Level|Credits?(?:\s*Value)?)\b/i;

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
 * The heading above the assessment criteria, whatever the document calls it.
 *
 * This one is worth naming on its own because getting it wrong is silent. The
 * pattern used to demand the word "Internal", and a document heading the same
 * column "Assessment Criteria" still yielded every module and every topic —
 * and not one criterion. A reader that finds nothing announces itself; a
 * reader that finds everything except the thing competence is judged against
 * looks like it worked.
 */
const CRITERIA_HEADING =
  /^(?:internal\s+|formative\s+)?assessment\s+criteri(?:a|on)\b/i;

/**
 * Numbering a document puts in front of its headings — "3.2 Applied
 * knowledge". Stripped before a heading is matched, so a house style that
 * numbers its sections reads the same as one that does not.
 */
const HEADING_NUMBER = /^\d+(?:\.\d+)*[.)]?\s+/;

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
    guidelines: /^guidelines?\s+for\s+(?:the\s+)?topics?/i,
    // A knowledge topic is distinguished by the percentage of the module it
    // carries. Its prefix is not reliable: KM01 numbers its topics KM0101 and
    // KM05 numbers its topics KT0501, which is also an element prefix.
    //
    // The percentage is no longer required, only preferred: a document that
    // omits it used to lose two thirds of its topics and two thirds of its
    // criteria without saying so. When this pattern finds nothing, the module
    // is read again the way the other two components are read, by taking the
    // topic prefix from the module itself.
    topic: /^([A-Z]{2}\d{4})[:.]?\s+(.+?)\s*\((\d{1,3})\s*%\)\s*$/,
    sections: [
      { heading: /^topic\s+elements?\b/i, collect: "knowledge_topic" },
      { heading: CRITERIA_HEADING, collect: "criteria" },
    ],
  },
  practical: {
    guidelines: /^guidelines?\s+for\s+practical\s+skills?/i,
    // The two documents disagree about what PS means: in 121150 a PS code is
    // the skill itself, in 121151 it is an activity inside one. So the prefix
    // that means "topic" is read from each module rather than fixed here.
    topicFromFirstCode: true,
    sections: [
      {
        heading: /^(?:required\s+performance|(?:skills?\s+)?activities\s+that\s+must\s+be\s+mastered|practical\s+skills?\s+required)\b/i,
        collect: "practical_activity",
      },
      { heading: /^applied\s+knowledge\b/i, collect: "applied_knowledge" },
      { heading: CRITERIA_HEADING, collect: "criteria" },
    ],
  },
  workplace: {
    guidelines: /^guidelines?\s+for\s+work(?:place)?\s+experience/i,
    topicFromFirstCode: true,
    sections: [
      { heading: /^work\s+activities\b/i, collect: "work_activity" },
      {
        heading: /^contextual\s+workplace\s+knowledge\b/i,
        collect: "contextual_knowledge",
      },
      {
        heading: /^supporting\s+evidence\b/i,
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

    const topics = parseTopics(
      lines.slice(from, to),
      candidate.entry.component,
      candidate.entry.code.slice(2),
    );
    const parsed = { ...candidate.entry, topics };
    const existing = byCode.get(parsed.code);

    if (!existing) {
      byCode.set(parsed.code, parsed);
      return;
    }

    // The occurrences of a module carry different things. The one in the
    // contents states its credits and level and has no content beneath it;
    // the one in the body has every topic and often repeats neither. Choosing
    // one reading whole therefore threw away whatever the other one knew —
    // which is why a document could yield fifteen complete modules and three
    // sets of credits. Each field is taken from whichever reading has it.
    const richer = weight(parsed) > weight(existing) ? parsed : existing;

    byCode.set(parsed.code, {
      ...richer,
      credits: existing.credits || parsed.credits,
      nqfLevel: existing.nqfLevel || parsed.nqfLevel,
      // A title truncated by a line break is a shorter title, not a better one.
      title:
        parsed.title.length > existing.title.length
          ? parsed.title
          : existing.title,
    });
  });

  // Matching a module code no longer requires the header to state a level and
  // credits, which is what lets an unfamiliar house style still be read. The
  // price is that a bare mention of a code could otherwise become a module
  // with nothing in it, so a candidate has to show something for itself:
  // either one of the header fields, or actual content underneath. A real
  // module always has one or the other; a stray reference has neither.
  for (const entry of byCode.values()) {
    if (
      entry.credits === 0 &&
      entry.nqfLevel === 0 &&
      entry.topics.length === 0
    ) {
      byCode.delete(entry.code);
    }
  }

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

    // The shortest candidate that matches is not the most informative one.
    // A header's code and title sit on the first line and its level and
    // credits wrap onto the next, so stopping at the first structural match
    // reads the module and misses both figures. Every candidate is tried, and
    // the first one that also carries a figure wins; the bare match is kept
    // only as what to fall back on.
    let best: {
      prefix: string;
      number: string;
      rawTitle: string;
      candidate: string;
      score: number;
    } | null = null;

    for (const candidate of candidates) {
      const match = MODULE_HEADER.exec(candidate);
      if (!match) continue;

      const [, prefix, number, rawTitle] = match;

      // Scored rather than taken on the first field found: these headers wrap
      // wherever the margin falls, and "NQF Level 6," at the end of one line
      // with "Credits 8." at the start of the next is ordinary. Stopping as
      // soon as either appeared read the level and lost the credits.
      const score =
        (LEVEL_ANYWHERE.test(candidate) ? 1 : 0) +
        (CREDITS_ANYWHERE.test(candidate) ? 1 : 0);

      if (!best || score > best.score) {
        best = { prefix, number, rawTitle, candidate, score };
      }
      if (score === 2) break;
    }

    if (!best) return;

    const level = LEVEL_ANYWHERE.exec(best.candidate);
    const credits = CREDITS_ANYWHERE.exec(best.candidate);

    // The title runs until the first of the other fields, whichever that is.
    const end = best.rawTitle.search(TITLE_ENDS_AT);
    const title = cleanTitle(
      end === -1 ? best.rawTitle : best.rawTitle.slice(0, end),
    );

    found.push({
      index,
      entry: {
        code: `${best.prefix.toUpperCase()}${best.number}`,
        component: COMPONENT_BY_PREFIX[best.prefix.toUpperCase()],
        title,
        credits: credits ? Number(credits[1]) : 0,
        nqfLevel: level ? Number(level[1]) : 0,
        topics: [],
      },
    });
  });

  return found;
}

/** Topics, elements and criteria within one module's slice of the document. */
function parseTopics(
  lines: string[],
  component: Component,
  moduleNumber: string,
): ParsedTopic[] {
  const plan = PLANS[component];

  // Everything before the guidelines heading is the module's purpose and a
  // summary list that repeats what the guidelines then set out in full.
  // Starting at the heading avoids reading every topic twice. When there is no
  // such heading the whole slice is read, which is worse but not nothing.
  const begin = lines.findIndex((line) => plan.guidelines.test(line));
  const body = begin === -1 ? lines : lines.slice(begin + 1);

  // The preferred pattern first. Where a component has one, it is the more
  // precise of the two — but precision that finds nothing is not precision,
  // so a module it cannot read is read again by taking the topic prefix from
  // the module's own first coded line. That fallback is how the practical and
  // workplace components have always worked; knowledge now shares it instead
  // of depending on every topic carrying a percentage.
  // A topic's code carries its module's number: KM04 numbers its topics
  // KM0401, and where a document switches letters it keeps the number, so
  // KM05's topics are KT0501. That number is the module's own answer to which
  // topics are its own, and it is the one thing these documents are
  // consistent about.
  //
  // Anchoring to it is what stops a topic being read into the wrong module.
  // Matching on shape alone — any two letters and four digits with a
  // percentage — let KM03's topics be collected under KM04, whose percentages
  // then came to 200%. Nothing about that reads as an error; it reads as a
  // module with nine topics.
  const ownNumber = new RegExp(
    `^([A-Z]{2}${moduleNumber}\\d{2})[:.]?\\s+(.+?)(?:\\s*\\((\\d{1,3})\\s*%\\))?\\s*$`,
  );

  // Two places to look, in order. Everything after the guidelines heading is
  // the module set out in full, and reading only that avoids taking the
  // summary list above it as a second set of topics.
  //
  // But a module with a single topic declares it above the heading and puts
  // its elements and criteria below — so looking only below found no topic at
  // all, and then attached that module's elements to whatever code came first,
  // which belonged to another module entirely. When the detail section yields
  // no topic, the whole module is searched instead.
  const regions = begin === -1 ? [lines] : [body, lines];

  // Whether a topic code has to carry this module's number is decided by the
  // document, not assumed. 121151 numbers KM04's topics KM0401 and up, so a
  // KT0301 found under KM04 is a neighbour's topic read across a boundary and
  // is dropped. 121150 numbers its practical topics in one sequence for the
  // whole qualification, so PM03's only topic is coded PM0101 — and dropping
  // that would empty the module on the strength of a house rule it never
  // agreed to.
  //
  // So the requirement is tried first and abandoned if it finds nothing
  // anywhere. Where the numbering is per-module it is a strong filter; where
  // it is not, it costs nothing.
  for (const requireOwnNumber of [true, false]) {
    for (const region of regions) {
      // Most specific first. The percentage marks a knowledge topic exactly;
      // the module's own first coded line names the one prefix its topics
      // use; only when neither applies is the module number used alone, which
      // is loosest because a module's elements carry its number too — KM01's
      // topics are KM0101 and its elements KT0101, and only the prefix
      // separates them.
      const attempts = [plan.topic, topicPatternFor(region), ownNumber].filter(
        (pattern): pattern is RegExp => Boolean(pattern),
      );

      for (const pattern of attempts) {
        const found = collectTopics(region, component, pattern, moduleNumber);
        const topics = requireOwnNumber
          ? found.filter((topic) => belongsHere(topic.code, moduleNumber))
          : found;
        if (topics.length > 0) return topics;
      }
    }
  }

  // Without a first coded line there is nothing to anchor to, and guessing a
  // prefix here is how one document's activities become another's topics.
  return [];
}

/**
 * Whether a topic code can belong to this module.
 *
 * A four-digit code carries its module's number in the middle two: KM0501 and
 * KT0501 are both KM05's, and KT0101 is not. Anything shaped differently is
 * accepted, because a document that numbers its topics some other way is not
 * thereby wrong — but a code that says plainly it belongs to module 01 is not
 * read into module 05 on the grounds that nothing better turned up.
 */
function belongsHere(code: string, moduleNumber: string): boolean {
  const parts = /^[A-Z]{2}(\d{2})\d{2}$/.exec(code);
  return !parts || parts[1] === moduleNumber;
}

/**
 * The code a topic line is really about.
 *
 * Detail headers get copied and half-edited: PM04's second topic is headed
 * "PM0101: PM0401 Coordinate the implementation of..." in a published QCTO
 * curriculum, where PM0101 is left over from another module and PM0401 is the
 * topic. Taking the first code drops the topic entirely once it is checked
 * against the module it sits in — so where the leading code belongs elsewhere
 * and the next one belongs here, the document's own second answer is used.
 */
function codeFor(
  code: string,
  title: string,
  moduleNumber: string,
): { code: string; title: string } {
  if (belongsHere(code, moduleNumber)) return { code, title };

  const next = /^([A-Z]{2}\d{4})[:.]?\s+(.*)$/.exec(title);
  if (next && belongsHere(next[1], moduleNumber)) {
    return { code: next[1], title: next[2] };
  }

  return { code, title };
}

function collectTopics(
  body: string[],
  component: Component,
  pattern: RegExp,
  moduleNumber: string,
): ParsedTopic[] {
  const plan = PLANS[component];
  const allowed = ELEMENT_KINDS_BY_COMPONENT[component] ?? [];

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
      const resolved = codeFor(topic[1], topic[2], moduleNumber);

      current = {
        code: resolved.code,
        title: cleanTitle(stripRepeatedCode(resolved.title, resolved.code)),
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

    const heading = line.replace(HEADING_NUMBER, "");
    const section = plan.sections.find((entry) => entry.heading.test(heading));
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
