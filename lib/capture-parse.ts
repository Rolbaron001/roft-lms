/**
 * Reading a workbook and its answer guide out of Word.
 *
 * Pure text in, a proposed paper out. No database, no session — so it can be
 * tested against the real documents directly, which is the only way to know
 * whether it works.
 *
 * Nothing here commits anything. What it produces is a *proposal*, and the
 * point of the whole design is that a person confirms it. A parser that gets
 * question three's correct answer wrong produces confidently wrong marking,
 * and nobody finds out until a moderator does — or until a learner appeals. So
 * the parser is built to report what it could not work out rather than to fill
 * the gap with a guess.
 */

export type ParsedItem = {
  /** The number as printed, which is how the memorandum refers back to it. */
  number: string;
  type: "multiple_choice" | "true_false" | "long_answer" | "short_answer";
  stem: string;
  options: string[];
  /** Index into `options`, once the memorandum has been read. */
  correctIndex: number | null;
  points: number | null;
  /** Criterion codes, from the question itself or from the memorandum. */
  criterionCodes: string[];
  markingGuide: string | null;
  /**
   * Who marks it.
   *
   * "app" is only for a question with one unambiguous right answer the
   * platform can check — a multiple choice, or a bare true/false. Everything
   * else is "assessor", including a statement that asks for a justification:
   * the verdict may be true or false, but the marks are for the reasoning, and
   * no engine can judge that. Getting this wrong in either direction is worse
   * than leaving it open, so anything uncertain lands on the assessor.
   */
  markedBy: "app" | "assessor";
  /**
   * Opened by "Task 1:" or "Task A:". A guide's "Task 1 (25 Marks)" is for
   * this, never for question 1 of another part that shares the number.
   */
  task?: true;
  /**
   * Opened by its own heading, "Question C1:" or "Task 1:", rather than taken
   * from a bare sentence. Used while reading only, and removed before the
   * paper is returned.
   */
  headed?: true;
  /** Taken from a bare sentence. Used while reading only. */
  bare?: true;
};

export type ParsedSection = {
  title: string;
  instruction: string | null;
  /** As the paper prints it, which is checked against the items. */
  markTotal: number | null;
  /** "Each question carries 1 mark", where the instruction says so. */
  markEach?: number | null;
  items: ParsedItem[];
};

export type ParsedPaper = {
  title: string | null;
  /** Criteria the workbook says it covers, from its scope table. */
  declaredCriteria: string[];
  sections: ParsedSection[];
  /**
   * What the parser could not work out, in words an author can act on. These
   * are faults: something is missing or does not reconcile.
   */
  problems: string[];
  /**
   * What the reader should simply know. Not faults — a paper where every
   * question is marked by an assessor is perfectly normal, and reporting that
   * as a problem would train whoever reviews it to skim past the real ones.
   */
  notes: string[];
};

// "PART A1" as well as "PART 1": Curiosa's Version 2 papers divide Section A
// into Part A1 and Part A2. "SECTION 1" and "Part A" as well: the workbooks
// from Study Unit 2 onwards head their sections that way, and until 27
// September read as having no sections at all (job sheet D10).
const SECTION_HEADING =
  /^(?:(Activity\s+[\d.]+)|(SECTION\s+(?:[A-Z]|\d+))|(PART\s+(?:[A-Z]\d*|\d+)))\s*[::]\s*(.+)$/i;
const NUMBERED = /^(\d+)\.\s+(.+)$/;
/** "Q1. 1. In performance management…", numbered twice. */
const Q_NUMBERED = /^Q(\d+)[.)]\s*(?:\d+[.)]\s+)?(.+)$/i;
/** "A. …", "A) …", or with a tick box in front: "[  ]  A) …". */
const OPTION = /^(?:\[\s*[xX✓]?\s*\]\s*)?([A-H])[.)]\s+(.+)$/;
/** A tick box on its own: the learner's True or False column. */
const TICK_BOX = /^\[\s*[xX✓]?\s*\]$/;
/**
 * A section that is the assessor's marking grid, not questions: "SECTION 3:
 * ASSESSOR MARKING RUBRIC & EVALUATION SUMMARY". Its rows name the parts
 * again and would otherwise be read as more of them.
 */
const NOT_QUESTIONS_SECTION = /\b(RUBRIC|GRADING GRID|EVALUATION SUMMARY|ASSESSOR)\b/i;
const TRUE_FALSE = /\[\s*True\s*\/\s*False\s*\]\s*$/i;
/**
 * "(15 Marks)" or "[5 Marks]". Curiosa writes a question's marks in square
 * brackets and a section's in round ones; until 27 September only round ones
 * were read, so every "Question 1: … [5 Marks]" came back worth nothing.
 */
const MARKS_IN_HEADING = /[([](\d+(?:[.,]\d+)?)\s*Marks?\b[^)\]]*[)\]]?/i;

/**
 * "Instructions: Select the SINGLE best answer… Each question carries 1 mark."
 *
 * Read as the section's instruction, and its mark per question kept. Until
 * 27 September a line beginning "Instructions:" was taken for a question, so
 * Section A of SU5's assessment had sixteen questions for fifteen marks and
 * none of them could be given one.
 */
const INSTRUCTION_LINE =
  // "Instructions: …", or "■ INSTRUCTIONS - PART ASelect the most…", where
  // Word runs the heading into its first word.
  /^(?:■\s*)?Instructions?\b\s*(?:[-–]\s*PART\s+[A-Z0-9]{1,2}?(?=[A-Z][a-z]|[\s::]|$))?\s*[::]?\s*(.*)$/i;
const MARK_EACH = /\beach\s+(?:question|statement|item)\s+(?:carries|is worth)\s+(\d+(?:[.,]\d+)?)\s*marks?\b/i;

/** "2,5" or "2.5" as printed: South African papers use either. */
function markValue(printed: string): number {
  return Number(printed.replace(",", "."));
}

/** Marks are kept to two decimals, so sums are compared at two decimals. */
function roundMarks(marks: number): number {
  return Math.round(marks * 100) / 100;
}

function isHundredths(marks: number): boolean {
  return Math.abs(marks * 100 - Math.round(marks * 100)) < 1e-9;
}

/**
 * A line the learner writes on: "Justification: ________", "Indicate
 * True/False: ____", or nothing but a rule. Not a question, and not a copy of
 * one; read as questions they doubled Section B and were reported as copies
 * "never edited" (job sheet D10).
 */
const WRITING_SPACE = /_{4,}/;

/**
 * Nothing on the line but labels and lines to write on: "Justification:
 * ______", "Answer (True/False): ______Justification:". A line with a rule
 * in it and anything more is a question with a gap in it, and is kept.
 */
function isWritingSpace(line: string): boolean {
  if (!WRITING_SPACE.test(line)) return false;
  return (
    line
      .replace(/_{2,}/g, " ")
      .replace(/[A-Za-z][A-Za-z ()/&-]{0,40}[::]/g, " ")
      .trim() === ""
  );
}

/**
 * Where a case study begins. Everything from here to the next heading is
 * reading for the questions that follow, not questions: read line by line it
 * put a whole scenario into Section B as eleven "questions" (job sheet D10).
 */
const STIMULUS_START =
  /^(?:CASE STUDY(?: SCENARIO)?\b|ORGANI[SZ]ATIONAL CONTEXT\b|(?:Integrated\s+)?Case Study\s*[::]|SCENARIO\s*[::])/;

/**
 * "SUB-SECTION D1: OPERATIONAL DIAGNOSTIC… [13 Marks]": one part of a long
 * question, with marks of its own and bullet points under it saying what it
 * must cover.
 */
const SUBSECTION_ITEM = /^SUB-?SECTION\s+([A-Z]?\d+(?:\.\d+)*)\s*[::]\s*(.+)$/i;

/**
 * A line that begins the assessor's half of a document. Curiosa's SU2
 * summative carried its full memorandum after Section D in the learner's own
 * file (27 September 2026): read on, the answers became thirty more questions.
 */
const GUIDE_STARTS = /^(?:MEMORANDUM\b|MARKING (?:GUIDE|MEMORANDUM)\b|ASSESSOR(?:'S)? GUIDE\b)/i;

/**
 * A module's particulars under a section heading: "Module Title: …",
 * "Practical Skill: PM0501 - …". They describe the module; nobody answers
 * them. SU5 Workbook 1 read each one as a question (27 September 2026).
 */
const FRONT_MATTER =
  /^(?:Module(?:\s+Title)?|Focus|Practical\s+Skill|(?:Aligned\s+)?Applied\s+Knowledge|Case\s+Study\s+Scenario|NQF\s+Level|Credits)\s*[::]/i;
/** "■ TASK 1 INSTRUCTIONS" on a line of its own: a label inside the task. */
const TASK_INSTRUCTIONS_LABEL = /^(?:■\s*)?TASK\s+\w+\s+INSTRUCTIONS?\s*$/i;

/** Headings that say the document is a marking guide, not the learner's copy. */
const GUIDE_HEADING = /\b(ASSESSOR(?:'S)? GUIDE|MARKING MEMORANDUM|MARKING GUIDE)\b/i;
const LEARNER_HEADING = /\bINSTRUCTIONS TO (?:THE )?LEARNERS?\b/i;
const CRITERIA_TRAILING = /\(((?:IAC|AC)\d{3,6}(?:\s*,\s*(?:IAC|AC)\d{3,6})*)\)\s*$/i;
const CRITERIA_ANY = /\b(?:IAC|AC)\d{3,6}\b/gi;
const SCOPE_LINE = /^Internal Assessment Criteria\s*[::]\s*(.+)$/i;

// "Question 1: …", or "Question 1 (IAC0301): …" with its criteria before
// the colon, as the workbooks from Study Unit 2 onwards write it.
const ITEM_HEADING =
  /^Question\s+([A-Z]?[0-9]+(?:[.][0-9]+)*)\s*(\([^)]*\))?\s*[::]\s*(.+)$/i;

/**
 * The other template.
 *
 * Curiosa's later workbooks abandon numbered activities for a single case
 * study followed by a handful of tasks. There is no "Activity 1.1", no
 * options, and nothing the App can mark — every task is a piece of written
 * work an assessor reads. Read with the activity rules alone these documents
 * parse to nothing at all, which is the worst possible outcome: an empty
 * proposal looks like a clean one.
 */
const TASK_SECTION =
  /^((?:Formative|Summative|Practical Execution|Integrated|Assessment)?\s*Tasks?)\s*[::]\s*$/i;

/**
 * "Task 1: Job Analysis (IAC0201, IAC0202) — Formulate a procedure…"
 *
 * The criteria and the em dash are both optional: one variant puts the
 * description on the same line after a dash, the other on the lines beneath.
 */
const TASK_ITEM =
  /^(?:Practical\s+)?Task\s+(\d+|[A-Z])\s*[::]\s*(.+)$/i;

/** The case study or dataset a set of tasks all draw on. */
const STIMULUS_HEADING =
  /^((?:Integrated\s+)?Case Study[^::]*|SCENARIO|Dataset\s+\d+[^::]*)\s*[::]?\s*$/i;

/**
 * A scope written as a range: "IAC0101 through IAC0603".
 *
 * The platform cannot expand it — the codes are not a simple sequence, they
 * restart per topic — and reading the two ends as two individual criteria is
 * worse than reading nothing, because it then reports both as untested when
 * the tasks in between cover them.
 */
/**
 * Criteria in brackets partway along a task line, before the dash that
 * introduces the description.
 *
 * The ordinary criteria matcher only looks at the end of a line, which is
 * where an activity puts them. A task puts them in the middle, so read with
 * the ordinary rule every task parses with no criteria at all — and a task
 * tagged to nothing evidences nothing, which is the one outcome this whole
 * pipeline exists to prevent.
 */
const TASK_CRITERIA = /[(]([^)]*(?:IAC|AC|PS|AK|KM|PM|WA)\d{2,6}[^)]*)[)]/i;

const CRITERIA_RANGE =
  /\b((?:IAC|AC)\d{3,6})\s+(?:through|to|-|–)\s+((?:IAC|AC)\d{3,6})\b/i;
const BRACKET_CRITERIA = /[[]([^\]]*(?:IAC|AC|PS|PM|KM)[^\]]*)[]]/i;
const STATEMENT = /^Statement\s+(\d+)\s*[::]\s*(.+)$/i;
const ANSWER_BLANK = /^\[?\s*Answer(\s+Chosen)?\s*[::]/i;

const NOT_A_QUESTION = [
  /^select\b[^.]*\banswer\b/i,
  /^answer the following/i,
  /^write the chosen letter/i,
  /^indicate whether/i,
  /^state whether/i,
  /^complete the following/i,
];

function codesIn(text: string): string[] {
  return [...new Set((text.match(CRITERIA_ANY) ?? []).map((c) => c.toUpperCase()))];
}

/**
 * Reads the learner's copy: sections, questions, options.
 *
 * Marks and correct answers are not in this document, so they come back null
 * and the answer guide supplies them.
 */
export function parseWorkbook(text: string): ParsedPaper {
  const lines = text.split("\n").map((line) => line.replace(/\t/g, " ").trim());
  const problems: string[] = [];

  const titleLine = lines.find((line) =>
    /^(WORKBOOK|SUMMATIVE ASSESSMENT|ASSESSMENT)\b/i.test(line),
  );

  const scopeLine = lines.find((line) => SCOPE_LINE.test(line));
  const scopeRange = scopeLine ? CRITERIA_RANGE.exec(scopeLine) : null;

  // A range names its two ends and means everything between. Reading those two
  // as the whole scope would report both as untested while the tasks covering
  // them sit in the document — so the range is set aside and said out loud.
  const declaredCriteria =
    scopeLine && !scopeRange ? codesIn(scopeLine) : [];

  // A paper often prints its own mark distribution in a summary table near the
  // front: a section name in one cell and its marks in the next. Those cells
  // look exactly like section headings, so they are harvested for their marks
  // and the empty sections they produce are dropped below.
  const markHints = new Map<string, number>();
  for (let index = 0; index < lines.length - 1; index += 1) {
    const heading = SECTION_HEADING.exec(lines[index]);
    if (!heading) continue;
    const next = lines[index + 1];
    if (/^\d+$/.test(next)) {
      markHints.set(normalise(lines[index]), Number(next));
    }
  }

  // A marking guide uploaded as the learner's paper. Real: Curiosa's SU5
  // Version 2 files carry each other's names (27 September), and read as a
  // paper the guide produced one "question" made of a writing line.
  const opening = lines.slice(0, 40).join(" ");
  const guideHeading = GUIDE_HEADING.exec(opening);
  if (guideHeading && !LEARNER_HEADING.test(opening)) {
    problems.push(
      `This reads like a marking guide, not the learner's paper: its heading says "${guideHeading[1]}". Check the paper and its guide have not been given each other's names.`,
    );
  }

  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  let pending: ParsedItem | null = null;
  // Inside a case study: its lines are reading, not questions.
  let inStimulus = false;
  // Inside the assessor's marking grid, which repeats the part headings.
  let inGrid = false;
  // Inside a "Task 1:" of a practical workbook: its instructions and its
  // numbered prompts ("1. Workload Root Cause:") are part of the task.
  let inTask = false;

  const closeItem = () => {
    if (current && pending) current.items.push(pending);
    pending = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;

    // The paper's own answers, after its questions: nothing past here is for
    // the learner, and a learner given this file has them.
    if (!guideHeading && sections.length > 0 && GUIDE_STARTS.test(line)) {
      closeItem();
      problems.push(
        `The learner's paper carries its own marking guide, from "${line.slice(0, 80)}" on. A learner given this document has the answers. Take that part out of the learner's copy; the App has read only the questions before it.`,
      );
      break;
    }

    // The learner's writing space, or a tick box, is never a question.
    if (isWritingSpace(line) || TICK_BOX.test(line)) {
      closeItem();
      continue;
    }

    if (TASK_INSTRUCTIONS_LABEL.test(line)) continue;
    if (!pending && FRONT_MATTER.test(line)) {
      if (/^Case\s+Study/i.test(line)) inStimulus = true;
      continue;
    }

    if (STIMULUS_START.test(line) && !TASK_SECTION.test(line)) {
      closeItem();
      inStimulus = true;
      continue;
    }

    // A section's instruction, wherever it falls in the section: its mark
    // per question is kept, and it is never read as a question.
    const instruction = INSTRUCTION_LINE.exec(line);
    // Within a task, "Instruction: Detail specific targets…" is more of the
    // task: SU5 Workbook 4.1 has one per report heading.
    if (instruction && current && inTask) {
      if (pending) pending.stem = `${pending.stem} ${line}`.trim();
      continue;
    }
    if (instruction && current) {
      closeItem();
      // "■ INSTRUCTIONS - PART A" on a line of its own: the instruction itself
      // is the next line, and is taken there.
      if (instruction[1].trim() && !current.instruction) current.instruction = instruction[1].trim();
      const each = MARK_EACH.exec(instruction[1]);
      if (each) current.markEach = markValue(each[1]);
      continue;
    }

    // A set of tasks under a case study. The stimulus is the lines between the
    // scenario heading above and this one: the tasks are meaningless without
    // it, and it is stated once rather than repeated on each.
    const taskSection = TASK_SECTION.exec(line);
    if (taskSection) {
      closeItem();
      inStimulus = false;
      inTask = false;

      let stimulus: string | null = null;
      for (let back = index - 1; back >= 0 && index - back < 40; back -= 1) {
        if (STIMULUS_HEADING.test(lines[back])) {
          stimulus =
            lines
              .slice(back, index)
              .filter((entry) => entry.length > 0)
              .join(" ")
              .trim() || null;
          break;
        }
      }

      current = {
        title: taskSection[1].replace(/\s+/g, " ").trim(),
        instruction: stimulus,
        markTotal: null,
        items: [],
      };
      sections.push(current);
      continue;
    }

    const heading = SECTION_HEADING.exec(line);
    if (heading) {
      closeItem();
      inStimulus = false;
      inTask = false;
      const label = (heading[1] ?? heading[2] ?? heading[3]).trim();
      const rest = heading[4].trim();
      const marks = MARKS_IN_HEADING.exec(rest);

      // The assessor's grid at the end: nothing in it is a question, and the
      // "Part A: Multiple Choice" rows in it are not new parts. It lasts
      // until another numbered or lettered SECTION begins.
      if (NOT_QUESTIONS_SECTION.test(rest)) {
        current = null;
        inGrid = true;
        continue;
      }
      if (inGrid && !heading[2]) continue;
      inGrid = false;

      current = {
        title: `${label}: ${rest.replace(/\s*[([][^)\]]*[)\]]\s*$/, "").trim()}`,
        instruction: null,
        markTotal: marks ? markValue(marks[1]) : null,
        items: [],
      };
      sections.push(current);
      continue;
    }

    if (!current) continue;

    // "SUB-SECTION D1: … [13 Marks]", one part of a long question.
    const subsection = SUBSECTION_ITEM.exec(line);
    if (subsection) {
      closeItem();
      inStimulus = false;
      const marks = MARKS_IN_HEADING.exec(subsection[2]);
      pending = {
        number: subsection[1],
        type: "long_answer",
        stem: stripCriteria(subsection[2].replace(MARKS_IN_HEADING, "")).trim(),
        options: [],
        correctIndex: null,
        points: marks ? markValue(marks[1]) : null,
        criterionCodes: criteriaOf(subsection[2]),
        markingGuide: null,
        markedBy: "assessor",
      };
      continue;
    }

    // An option belongs to the question above it.
    const option = OPTION.exec(line);
    if (option && pending) {
      pending.options.push(option[2].trim());
      continue;
    }

    const numbered = Q_NUMBERED.exec(line) ?? NUMBERED.exec(line);
    // "1. Workload & Systems Alignment Root Cause:" under a task is a heading
    // the learner writes beneath, part of that task.
    if (numbered && inTask && /[::]\s*$/.test(line)) {
      if (pending) pending.stem = `${pending.stem} ${line}`.trim();
      continue;
    }
    // A numbered line inside a case study is one of its findings, not a question.
    if (numbered && !inStimulus) {
      closeItem();
      // "1. 1. Calibration sessions…": the number printed twice.
      const body = numbered[2].replace(new RegExp(`^${numbered[1]}[.)]\\s+`), "");
      pending = {
        number: numbered[1],
        // Assumed multiple choice until the following lines say otherwise;
        // corrected below if no options arrive.
        type: "multiple_choice",
        stem: stripCriteria(body),
        options: [],
        correctIndex: null,
        points: null,
        criterionCodes: criteriaOf(body),
        markingGuide: null,
        markedBy: "app",
      };
      continue;
    }

    // "Task 2: Job Analysis (IAC0201, IAC0202) — Formulate a procedure…"
    // "Task 1:" or "Task A:". A task ends the case study above it: SU1
    // Workbook 2 sets its scenario, then asks Task A and Task B.
    const task = TASK_ITEM.exec(line);
    if (task && current) {
      closeItem();
      inStimulus = false;
      inTask = true;
      const rest = task[2];
      const marks = MARKS_IN_HEADING.exec(rest);

      const bracketed = TASK_CRITERIA.exec(rest);
      const taskCriteria = bracketed ? codesIn(bracketed[1]) : [];

      // The bracket is removed from the question only when the platform
      // actually understood it. A tag it does not recognise — a practical
      // skill code on a knowledge workbook, say — stays visible, because
      // deleting a tag nobody could read is how the mismatch stops being
      // findable.
      const withoutTag =
        taskCriteria.length > 0 ? rest.replace(TASK_CRITERIA, "") : rest;

      pending = {
        number: task[1],
        // Never anything the App can mark: a task is a piece of written work
        // produced against a case study, and there is no key for that.
        type: "long_answer",
        stem: stripCriteria(withoutTag.replace(MARKS_IN_HEADING, ""))
          .replace(/^[\s—–-]+/, "")
          .replace(/\s{2,}/g, " ")
          .trim(),
        options: [],
        correctIndex: null,
        points: marks ? markValue(marks[1]) : null,
        criterionCodes:
          taskCriteria.length > 0 ? taskCriteria : criteriaOf(rest),
        markingGuide: null,
        markedBy: "assessor",
        task: true,
        headed: true,
      };
      continue;
    }

    // "Question C1: Work Profiling (20 Marks) [PM-01, PS0101]" opens a
    // question in its own right, and the lines under it are its context
    // rather than more questions.
    const itemHeading = ITEM_HEADING.exec(line);
    if (itemHeading) {
      closeItem();
      inStimulus = false;
      inTask = false;
      const rest = itemHeading[3];
      const marks = MARKS_IN_HEADING.exec(rest);
      const bracket = BRACKET_CRITERIA.exec(rest);
      // "Question 1 (IAC0301): …": criteria named before the colon.
      const before = itemHeading[2] ? codesIn(itemHeading[2]) : [];

      pending = {
        number: itemHeading[1],
        type: "long_answer",
        // The marks bracket is removed whole, closing bracket included, so a
        // bracket that ends the title itself, "(5 Whys Technique)", is kept.
        stem: rest.replace(MARKS_IN_HEADING, "").replace(BRACKET_CRITERIA, "").trim(),
        options: [],
        correctIndex: null,
        points: marks ? markValue(marks[1]) : null,
        criterionCodes: before.length > 0 ? before : bracket ? codesIn(bracket[1]) : criteriaOf(rest),
        markingGuide: null,
        markedBy: "assessor",
        headed: true,
      };
      continue;
    }

    // "Answer: ____" is where the learner writes, not a question.
    if (ANSWER_BLANK.test(line)) {
      closeItem();
      continue;
    }

    const statement = STATEMENT.exec(line);
    if (statement) {
      closeItem();
      inStimulus = false;
      // "Statement 1: 1. …" is numbered twice in some papers.
      const stem = statement[2].replace(/^[0-9]+[.]\s*/, "").trim();
      // A statement standing on its own, with a space to write in underneath,
      // asks for a verdict *and* a justification. The verdict might be
      // checkable; the marks are for the reasoning, and no engine can judge
      // that. So it goes to an assessor rather than being marked as a
      // true/false that happens to have no answer in the guide.
      current.items.push({
        number: statement[1],
        type: "short_answer",
        stem: stripCriteria(stem),
        options: [],
        correctIndex: null,
        points: null,
        criterionCodes: criteriaOf(stem),
        markingGuide: null,
        markedBy: "assessor",
      });
      continue;
    }

    if (TRUE_FALSE.test(line)) {
      closeItem();
      const stem = line.replace(TRUE_FALSE, "").trim();
      current.items.push({
        number: String(current.items.length + 1),
        type: "true_false",
        stem: stripCriteria(stem),
        options: ["True", "False"],
        correctIndex: null,
        points: null,
        criterionCodes: criteriaOf(stem),
        markingGuide: null,
        markedBy: "app",
      });
      continue;
    }

    // The first ordinary line under a heading is the instruction, not a
    // question — "Select the most appropriate answer for each question."
    if (!current.instruction && current.items.length === 0 && !pending) {
      if (NOT_A_QUESTION.some((pattern) => pattern.test(line))) {
        current.instruction = line;
        const each = MARK_EACH.exec(line);
        if (each) current.markEach = markValue(each[1]);
        continue;
      }
    }

    // Case study reading: neither a question nor part of one.
    if (inStimulus) continue;

    // A bare sentence inside a structured activity is a question in its own
    // right. Recognised by carrying criteria, or by being long enough that it
    // cannot be a stray label.
    // Not inside a task, whose tables and prompts are all the one task.
    if (!pending && !inTask && (CRITERIA_TRAILING.test(line) || line.length > 60)) {
      current.items.push({
        number: String(current.items.length + 1),
        type: "long_answer",
        stem: stripCriteria(line),
        options: [],
        correctIndex: null,
        points: null,
        criterionCodes: criteriaOf(line),
        markingGuide: null,
        markedBy: "assessor",
        bare: true,
      });
      continue;
    }

    // A continuation of the question above.
    if (pending && pending.options.length === 0) {
      pending.stem = `${pending.stem} ${stripCriteria(line)}`.trim();
      pending.criterionCodes = [
        ...new Set([...pending.criterionCodes, ...criteriaOf(line)]),
      ];
    }
  }

  closeItem();

  // A heading that gathered no questions was a table cell or a contents line,
  // not a section. Dropped rather than reported: the paper is not at fault.
  const real = sections.filter((section) => section.items.length > 0);
  for (const section of real) {
    if (section.markTotal === null) {
      const hint = markHints.get(normalise(section.title));
      if (hint !== undefined) section.markTotal = hint;
    }
  }
  sections.length = 0;
  sections.push(...real);

  // Where a part's questions have headings of their own ("Question C1:"),
  // the bare sentences before the first of them are the scenario they are
  // asked about, not questions. SU1's summative, 2 October 2026: the seven
  // lines of the Nexus Logistics case study were read as seven questions
  // with no marks and no guidance, and held the paper back. They become the
  // part's instruction, which a learner reads above the questions.
  for (const section of sections) {
    const firstHeaded = section.items.findIndex((item) => item.headed);
    if (firstHeaded > 0 && section.items.slice(0, firstHeaded).every((item) => item.bare)) {
      const context = section.items.slice(0, firstHeaded).map((item) => item.stem);
      section.instruction = [section.instruction, ...context].filter(Boolean).join("\n");
      section.items.splice(0, firstHeaded);
    }
    for (const item of section.items) {
      delete item.headed;
      delete item.bare;
    }
  }

  // A question that never collected options is not multiple choice.
  for (const section of sections) {
    // "Part B: True / False Questions": numbered statements with a True and
    // a False box to tick, and no justification asked for. A plain verdict
    // the App can mark from the guide.
    const plainTrueFalse = /true\s*\/\s*false/i.test(section.title) && !/justif/i.test(section.title);
    for (const item of section.items) {
      if (plainTrueFalse && item.type === "multiple_choice" && item.options.length === 0) {
        item.type = "true_false";
        item.options = ["True", "False"];
        continue;
      }
      if (item.type === "multiple_choice" && item.options.length === 0) {
        // A numbered line that never collected options is a written task, not
        // a choice — and nothing can mark it but a person.
        item.type = "short_answer";
        item.markedBy = "assessor";
      }
      if (item.type === "multiple_choice" && item.options.length < 2) {
        problems.push(
          `"${short(item.stem)}" looks like a multiple-choice question but only one option was found.`,
        );
      }
    }
  }

  if (sections.length === 0) {
    problems.push(
      "No activities or sections were recognised. Check that headings read like “Activity 1.1: …” or “SECTION A: …”.",
    );
  }

  const notes: string[] = [];
  const byAssessor = sections
    .flatMap((section) => section.items)
    .filter((item) => item.markedBy === "assessor").length;

  if (byAssessor > 0) {
    notes.push(
      `${byAssessor} ${byAssessor === 1 ? "question is" : "questions are"} marked by an assessor rather than by the App. That includes every statement that asks for a justification: the verdict may be checkable, but the marks are for the reasoning.`,
    );
  }

  return {
    title: titleLine ?? null,
    declaredCriteria,
    sections,
    problems,
    notes,
  };
}

function criteriaOf(text: string): string[] {
  const trailing = CRITERIA_TRAILING.exec(text);
  return trailing ? codesIn(trailing[1]) : [];
}

function stripCriteria(text: string): string {
  return text.replace(CRITERIA_TRAILING, "").trim();
}

/** Titles are matched loosely, because a table cell repeats them imperfectly. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function short(text: string): string {
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

// ---------------------------------------------------------------------------
// The memorandum
// ---------------------------------------------------------------------------

export type MemoAnswer = {
  /** The question number the guide refers to. */
  number: string;
  /** "B", for a selected-response question. */
  correctLetter: string | null;
  /** TRUE or FALSE, for a true/false statement. */
  trueFalse: "TRUE" | "FALSE" | null;
  modelAnswer: string | null;
  criterionCodes: string[];
};

export type ParsedMemo = {
  /** Marks per section title, from the mark distribution table. */
  sectionMarks: Record<string, number>;
  /** Marks per question, from headings like "Question 1.3.1: … (10 Marks)". */
  questionMarks: Record<string, number>;
  /** Marks per task, from "Task 1: … (25 Marks)", kept apart from questions. */
  taskMarks?: Record<string, number>;
  /** "(3 Marks | 1 Mark Each)": the mark per question, keyed like sectionMarks. */
  sectionEach?: Record<string, number>;
  /**
   * The part of the paper each of `questionMarks` was found under, as
   * "section c". SU2's guide gives "Question 1 (5 Marks)" under Section C, and
   * until 27 September it was given to statement 1 of Section B as well.
   */
  questionSections?: Record<string, string>;
  /**
   * What the guide says under each written question or task: its model
   * answer, the criteria in its heading's brackets, and the part of the paper
   * it was found under. Keyed "question 1.3.1" or "task A".
   */
  guides?: Record<string, { text: string; codes: string[]; part: string | null }>;
  answers: MemoAnswer[];
  total: number | null;
  problems: string[];
};

const MEMO_ACTIVITY =
  /^(Activity\s+[\d.]+|SECTION\s+(?:[A-Z]|\d+)|PART\s+[A-Z]\d*)\s*[::]\s*(.+?)\s*\((\d+(?:[.,]\d+)?)\s*Marks?/i;
const MEMO_QUESTION =
  /^Question\s+([\d.]+)\s*[::]\s*(.+?)\s*\((\d+(?:[.,]\d+)?)\s*Marks?\)/i;
/**
 * "Task A: Productivity Improvement Plan (25 Marks)". Curiosa's workbooks
 * print no marks on their tasks and give them only here (27 September 2026).
 */
const MEMO_TASK =
  /^(?:Practical\s+)?Task\s+(\d+|[A-Z])(?:\s+Model\s+Answer)?\s*[::]\s*(.+?)\s*[([](\d+(?:[.,]\d+)?)\s*Marks?/i;
/**
 * A section's marks from the guide when the guide words its title differently:
 * "Activity 2.3" is the same activity whatever each document calls it. Only a
 * single match counts, so two guide headings with one label decide nothing.
 */
/**
 * "section c" from "SECTION 4: SECTION C - SHORT QUESTIONS" or "SECTION C:
 * …"; "part d", "activity 2.3". A lettered label is preferred, since a guide
 * numbers its own sections around the paper's lettered ones.
 */
function paperPartLabel(text: string): string | null {
  const found =
    /\b(SECTION\s+[A-Z]|PART\s+[A-Z]\d*)\b/i.exec(text) ??
    /\b(Activity\s+\d+(?:\.\d+)*|SECTION\s+\d+|PART\s+\d+)\b/i.exec(text);
  return found ? found[1].replace(/\s+/g, " ").toLowerCase() : null;
}

/**
 * Whether a guide's question marks may apply to this part of the paper. Only
 * a disagreement rules it out: a guide or paper with no part labels decides
 * nothing.
 */
function sameGuidePart(memo: ParsedMemo, key: string, sectionTitle: string): boolean {
  const theirs = memo.questionSections?.[key];
  const ours = paperPartLabel(sectionTitle);
  return !theirs || !ours || theirs === ours;
}

function guideMarksByLabel(memo: ParsedMemo, title: string): number | null {
  return byTitleOrLabel(memo.sectionMarks, title);
}

function byTitleOrLabel(table: Record<string, number> | undefined, title: string): number | null {
  if (!table) return null;
  if (table[title] !== undefined) return table[title];
  const label = (text: string) => text.split(/[::]/)[0].trim().replace(/\s+/g, " ").toLowerCase();
  const own = label(title);
  const matches = Object.entries(table).filter(([key]) => label(key) === own);
  return matches.length === 1 ? matches[0][1] : null;
}

/**
 * A written question's or task's own heading in the guide, with what follows
 * it being the model answer: "Question 1.3.1: … (10 Marks) [IAC0101]",
 * "Task A: … [IAC0304]", "MEMORANDUM QUESTION C1: …".
 */
const GUIDE_ITEM =
  /^(MEMORANDUM\s+)?(?:(Question)|(?:Practical\s+)?(Task))\s+([A-Z]?\d+(?:\.\d+)*|[A-Z])\b(?:\s+Model\s+Answer)?\s*[::]/i;
/** Where one question's guidance ends, short of the next question. */
const GUIDE_BLOCK_ENDS = /^(?:SECTION|PART|Activity|MEMORANDUM\b|.*\b(?:RUBRIC|GRADING GRID|EVALUATION SUMMARY)\b)/i;

/** Model answers per written question or task. See ParsedMemo.guides. */
function guideBlocks(lines: string[]): NonNullable<ParsedMemo["guides"]> {
  const guides: NonNullable<ParsedMemo["guides"]> = {};
  let part: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = GUIDE_ITEM.exec(line);
    if (!heading) {
      // "MEMORANDUM - SECTION C" names the paper's part; "PART 2: ASSESSOR
      // MEMORANDUM" is the guide's own division and is overridden by it.
      if (/^(?:MEMORANDUM\s*[-–:]\s*)?(?:SECTION|PART|Activity)\b/i.test(line)) part = paperPartLabel(line) ?? part;
      continue;
    }
    const key = `${heading[3] ? "task" : "question"} ${heading[4].toUpperCase()}`;
    const body: string[] = [];
    for (let ahead = index + 1; ahead < lines.length && body.length < 80; ahead += 1) {
      const next = lines[ahead];
      if (GUIDE_ITEM.test(next) || GUIDE_BLOCK_ENDS.test(next)) break;
      if (next) body.push(next);
    }
    // The memorandum's own copy wins over a heading that merely repeats the
    // learner's paper, which the summatives print first (SU1 SA1, Part 1).
    if (body.length > 0 && (heading[1] || !guides[key])) {
      guides[key] = { text: body.join("\n").slice(0, 6000), codes: codesIn(line), part };
    }
  }
  return guides;
}

const LETTER_ONLY = /^([A-H])$/;
const TRUE_FALSE_ONLY = /^(TRUE|FALSE)$/i;
/**
 * "7" or "Q7". Curiosa's answer tables number questions "Q1", "Q2"; until 27
 * September only a bare number was read, so a complete fifteen-answer key for
 * SU5 came back as two answers, the two the author happened to write without
 * the Q (job sheet D10).
 */
const NUMBER_ONLY = /^Q?(\d+)$/i;

/**
 * Reads the answer guide.
 *
 * Word tables arrive one cell per line, so the memorandum tables read as a
 * repeating cycle: a question number, a correct letter, an explanation, a
 * criterion reference. The cycle is found by looking for the number and letter
 * together rather than by counting cells, because a table with a merged or
 * missing cell would otherwise silently shift every answer by one — which is
 * exactly the failure that makes a parser dangerous.
 */
export function parseMemorandum(text: string): ParsedMemo {
  const lines = text.split("\n").map((line) => line.replace(/\t/g, " ").trim());

  const sectionMarks: Record<string, number> = {};
  const questionMarks: Record<string, number> = {};
  const taskMarks: Record<string, number> = {};
  const sectionEach: Record<string, number> = {};
  const questionSections: Record<string, string> = {};
  let part: string | null = null;
  const answers: MemoAnswer[] = [];
  const problems: string[] = [];
  let total: number | null = null;

  // The learner's paper uploaded as its guide: the other half of a swap.
  const opening = lines.slice(0, 40).join(" ");
  if (LEARNER_HEADING.test(opening) && !GUIDE_HEADING.test(opening)) {
    problems.push(
      `The guide reads like the learner's paper, not a marking guide: it carries "Instructions to Learners" and no assessor's heading. Check the paper and its guide have not been given each other's names.`,
    );
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^(?:SECTION|PART|Activity)\b/i.test(line)) part = paperPartLabel(line) ?? part;
    const activity = MEMO_ACTIVITY.exec(line);
    if (activity) {
      const label = activity[1].trim();
      const rest = activity[2].replace(/\s*\([^)]*\)\s*$/, "").trim();
      sectionMarks[`${label}: ${rest}`] = markValue(activity[3]);
      const each = /(\d+(?:[.,]\d+)?)\s*Marks?\s+Each\b/i.exec(line);
      if (each) sectionEach[`${label}: ${rest}`] = markValue(each[1]);
      continue;
    }

    const question = MEMO_QUESTION.exec(line);
    if (question) {
      questionMarks[question[1]] = markValue(question[3]);
      if (part) questionSections[question[1]] = part;
      continue;
    }

    const task = MEMO_TASK.exec(line);
    if (task) {
      taskMarks[task[1].toUpperCase()] = markValue(task[3]);
      continue;
    }

    // The total is often a row of a table, so the word and the number arrive
    // as separate cells a few lines apart rather than on one line.
    if (/^TOTALS?\s*$|^TOTALS?[^A-Za-z]/i.test(line)) {
      for (let ahead = 0; ahead <= 4; ahead += 1) {
        const candidate = /^(\d+)(?:\s*Marks?)?$/i.exec(lines[index + ahead] ?? "");
        if (candidate && Number(candidate[1]) > 0) {
          total = Number(candidate[1]);
          break;
        }
      }
    }
  }

  // The selected-response tables: number, letter, explanation, criteria.
  for (let index = 0; index < lines.length; index += 1) {
    const number = NUMBER_ONLY.exec(lines[index]);
    if (!number) continue;

    const letter = LETTER_ONLY.exec(lines[index + 1] ?? "");
    if (!letter) continue;

    const explanation = lines[index + 2] ?? "";
    const criteria = codesIn(`${lines[index + 3] ?? ""} ${explanation}`);

    answers.push({
      number: number[1],
      correctLetter: letter[1],
      trueFalse: null,
      modelAnswer: explanation || null,
      criterionCodes: criteria,
    });
    index += 3;
  }

  // The true/false table: statement, TRUE or FALSE, rationale, criteria. Or
  // the statement's number in place of its text: "1 | TRUE | 1 Mark…", as the
  // workbooks from Study Unit 2 onwards set it out (job sheet D10).
  for (let index = 0; index < lines.length; index += 1) {
    const verdict = TRUE_FALSE_ONLY.exec(lines[index]);
    if (!verdict) continue;

    const statement = lines[index - 1] ?? "";
    // The header row is "Answer"; a statement is a sentence, or its number.
    if (statement.length < 20 && !NUMBER_ONLY.test(statement)) continue;

    answers.push({
      number: "",
      correctLetter: null,
      trueFalse: verdict[1].toUpperCase() as "TRUE" | "FALSE",
      modelAnswer: lines[index + 1] || null,
      criterionCodes: codesIn(
        `${lines[index + 1] ?? ""} ${lines[index + 2] ?? ""}`,
      ),
      // Kept so the merge can match it back to the statement it belongs to.
      ...({ statement } as object),
    } as MemoAnswer & { statement: string });
  }

  if (answers.length === 0) {
    problems.push(
      "No answers were found in the guide. Check that it carries a table of question numbers and correct options.",
    );
  }

  return { sectionMarks, questionMarks, taskMarks, sectionEach, questionSections, guides: guideBlocks(lines), answers, total, problems };
}

// ---------------------------------------------------------------------------
// Putting the two together
// ---------------------------------------------------------------------------

/**
 * Merges the guide into the paper, and says what it could not reconcile.
 *
 * The refusals matter more than the merges. A question with no answer in the
 * guide, a correct option naming a letter the question does not have, a
 * section whose printed total disagrees with its questions — each of those is
 * reported against the thing that caused it rather than quietly resolved,
 * because only the author knows which of the two is right.
 */
export function mergeMemorandum(
  paper: ParsedPaper,
  memo: ParsedMemo,
): ParsedPaper {
  const everyItemIsAssessorMarked =
    paper.sections.flatMap((section) => section.items).length > 0 &&
    paper.sections
      .flatMap((section) => section.items)
      .every((item) => item.markedBy === "assessor");

  // A case-study paper has no answer key because there is nothing to key: each
  // task is a piece of written work. Reported as a problem it is a false alarm
  // on every paper of that kind, and false alarms are how somebody learns to
  // scroll past the real ones.
  const noAnswerKey =
    "No answers were found in the guide. Check that it carries a table of question numbers and correct options.";

  const problems = [
    ...paper.problems,
    ...memo.problems.filter(
      (problem) => !(everyItemIsAssessorMarked && problem === noAnswerKey),
    ),
  ];
  const notes = [...paper.notes];

  if (everyItemIsAssessorMarked && memo.problems.includes(noAnswerKey)) {
    notes.push(
      "The guide carries no answer key, which is correct for this paper: every task is written work an assessor reads.",
    );
  }

  const byNumber = new Map(
    memo.answers.filter((a) => a.number).map((a) => [a.number, a]),
  );
  // Questions already reported as having no answer in the guide, so the
  // closing check does not report each of them a second time (job sheet D10:
  // SU5's screen listed fifteen questions twice over).
  const reportedMissing = new Set<ParsedItem>();
  const trueFalseAnswers = memo.answers.filter((a) => a.trueFalse);
  let trueFalseIndex = 0;

  /**
   * The guide's model answer for a written question or task, and the criteria
   * its heading names. Until 2 October only the marks were taken from these
   * headings, so every written question of Curiosa's papers was captured with
   * no marking guidance, could not be published, and assessed no criterion:
   * the workbooks print their criteria only in the guide ("Task 1: … [35
   * Marks] [IAC0101, IAC0102]").
   */
  const guideFor = (item: ParsedItem, sectionTitle: string) => {
    const guides = memo.guides ?? {};
    const number = item.number.toUpperCase();
    const ours = paperPartLabel(sectionTitle);
    const samePart = (part: string | null) => !part || !ours || part === ours;
    const find = (kind: "task" | "question") =>
      Object.entries(guides).find(
        ([key, guide]) =>
          key.startsWith(`${kind} `) &&
          (key === `${kind} ${number}` || key.endsWith(`.${number}`)) &&
          samePart(guide.part),
      )?.[1];
    // A task first from a task, a question from a question; the other only
    // where the guide calls it something else and nothing else matches.
    return item.task ? (find("task") ?? find("question")) : (find("question") ?? find("task"));
  };
  const applyGuide = (merged: ParsedItem, sectionTitle: string) => {
    const guide = guideFor(merged, sectionTitle);
    if (!guide) return;
    if (!merged.markingGuide) merged.markingGuide = guide.text;
    merged.criterionCodes = [...new Set([...merged.criterionCodes, ...guide.codes])];
  };

  const sections = paper.sections.map((section) => {
    const printedMarks =
      section.markTotal ?? memo.sectionMarks[section.title] ?? guideMarksByLabel(memo, section.title);

    const items = section.items.map((item) => {
      const merged: ParsedItem = { ...item };

      // Nothing in the guide can key a question a person marks, and saying so
      // as a problem would bury the real ones.
      if (item.markedBy === "assessor") {
        applyGuide(merged, section.title);
        // Only where the paper printed none, and a task only from a task:
        // "Question 1" of Part C and "Task 1" of Part E share a number, not
        // their marks.
        if (item.task) {
          const marks = memo.taskMarks?.[item.number.toUpperCase()];
          if (marks !== undefined && merged.points === null) merged.points = marks;
          return merged;
        }
        const key = Object.keys(memo.questionMarks).find(
          (number) =>
            (number === item.number || number.endsWith(`.${item.number}`)) &&
            sameGuidePart(memo, number, section.title),
        );
        if (key && merged.points === null) merged.points = memo.questionMarks[key];
        return merged;
      }

      if (item.type === "multiple_choice") {
        const answer = byNumber.get(item.number);
        if (!answer?.correctLetter) {
          problems.push(
            `Question ${item.number} of "${section.title}" has no correct answer in the guide.`,
          );
          reportedMissing.add(merged);
        } else {
          const position = answer.correctLetter.charCodeAt(0) - 65;
          if (position < 0 || position >= item.options.length) {
            problems.push(
              `The guide gives ${answer.correctLetter} for question ${item.number} of "${section.title}", but that question has ${item.options.length} options.`,
            );
          } else {
            merged.correctIndex = position;
          }
          merged.markingGuide = answer.modelAnswer;
          merged.criterionCodes = [
            ...new Set([...merged.criterionCodes, ...answer.criterionCodes]),
          ];
        }
      }

      if (item.type === "true_false") {
        const answer = trueFalseAnswers[trueFalseIndex];
        trueFalseIndex += 1;
        if (!answer) {
          problems.push(
            `"${short(item.stem)}" has no TRUE or FALSE in the guide.`,
          );
          reportedMissing.add(merged);
        } else {
          merged.correctIndex = answer.trueFalse === "TRUE" ? 0 : 1;
          merged.markingGuide = answer.modelAnswer;
          merged.criterionCodes = [
            ...new Set([...merged.criterionCodes, ...answer.criterionCodes]),
          ];
        }
      }

      if (item.type === "long_answer" || item.type === "short_answer") {
        // Structured questions are numbered 1.3.1, 1.3.2 in the guide; the
        // workbook numbers them within the activity.
        const key = Object.keys(memo.questionMarks).find((number) =>
          number.endsWith(`.${item.number}`),
        );
        if (key) merged.points = memo.questionMarks[key];
        applyGuide(merged, section.title);
      }

      return merged;
    });

    // "Each question carries 1 mark", where the paper says so, decides it.
    // The paper's, or else the guide's "(3 Marks | 1 Mark Each)".
    const markEach = section.markEach ?? byTitleOrLabel(memo.sectionEach, section.title) ?? undefined;
    const unmarked = items.filter((item) => item.points === null);
    if (markEach && unmarked.length > 0) {
      for (const item of unmarked) item.points = markEach;
    }

    // Otherwise the printed total is shared out evenly among the questions
    // with no marks of their own, where the share is one a paper could print.
    if (printedMarks !== null && unmarked.length > 0 && !markEach) {
      const accounted = items.reduce((sum, item) => sum + (item.points ?? 0), 0);
      const each = (printedMarks - accounted) / unmarked.length;
      // A share a paper could print: whole, or to two decimals (2.5 each).
      if (each > 0 && isHundredths(each)) {
        for (const item of unmarked) item.points = each;
      }
    }

    const computed = roundMarks(items.reduce((sum, item) => sum + (item.points ?? 0), 0));
    if (printedMarks !== null && computed !== printedMarks) {
      problems.push(
        `"${section.title}" is printed as ${printedMarks} marks, but its questions add up to ${computed}.`,
      );
    }

    // No total printed anywhere, but every task has its marks from the guide:
    // then the section's total is known, and is theirs added up.
    const everyItemMarked = items.length > 0 && items.every((item) => item.points !== null);
    return { ...section, markTotal: printedMarks ?? (everyItemMarked ? computed : null), items };
  });

  // Every criterion the workbook claims to cover should be tested by something.
  const tested = new Set(
    sections.flatMap((section) =>
      section.items.flatMap((item) => item.criterionCodes),
    ),
  );
  const untested = paper.declaredCriteria.filter((code) => !tested.has(code));

  // Scope written in one scheme and questions tagged in another. Saying "no
  // question is tagged to IAC0101" reads as a forgotten tag and sends an
  // author looking for one; the actual fault is that the two halves of the
  // document disagree about which codes they are using.
  // Codes from the other schemes — practical skills, applied knowledge, module
  // codes — which a task may carry instead of an internal assessment
  // criterion. Read from the stems because they are not criteria as far as the
  // platform is concerned, and are not stripped out with them.
  const otherScheme = new Set(
    sections
      .flatMap((section) => section.items)
      .flatMap(
        (item) =>
          item.stem.match(/\b(?:PS|AK|KM|PM|WA|WK|SE)\d{2,6}\b/gi) ?? [],
      )
      .map((code) => code.toUpperCase()),
  );

  const taggedFamilies = new Set(
    [...tested, ...otherScheme].map((code) => code.replace(/[0-9].*$/, "")),
  );
  const declaredFamilies = new Set(
    paper.declaredCriteria.map((code) => code.replace(/[0-9].*$/, "")),
  );
  const familiesDiffer =
    // A paper with no scope line declares nothing, and nothing cannot
    // disagree with anything.
    paper.declaredCriteria.length > 0 &&
    untested.length === paper.declaredCriteria.length &&
    taggedFamilies.size > 0 &&
    [...declaredFamilies].every((family) => !taggedFamilies.has(family));

  // A criterion in the scope that no question names is not a fault. Heidi, 5
  // October 2026: workbook activities integrate the criteria as a whole, and
  // the platform takes a workbook as it is. Only codes that disagree in kind
  // (scope in one scheme, tasks in another) are still worth a word.
  if (familiesDiffer) {
    notes.push(
      `The scope lists ${[...declaredFamilies].join(" and ")} codes (${paper.declaredCriteria.join(", ")}), and the tasks name ${[...taggedFamilies].join(" and ")} codes (${[...otherScheme, ...tested].sort().join(", ")}).`,
    );
  }

  // The invariant that matters most: a question the App is meant to mark and
  // cannot is a silently wrong mark waiting to happen. Either the guide is
  // missing an answer, or the question belongs to an assessor after all — and
  // only the author knows which.
  for (const section of sections) {
    for (const item of section.items) {
      if (item.markedBy !== "app") continue;
      if (item.correctIndex !== null) continue;
      if (reportedMissing.has(item)) continue;
      problems.push(
        `"${short(item.stem)}" in "${section.title}" is set to be marked by the App, but no correct answer was found for it. Give it one, or mark it as assessor-marked.`,
      );
    }
  }

  // ---------------------------------------------------------------------
  // Faults in the material itself.
  //
  // These are not parsing failures — the document was read perfectly well. They
  // are things wrong with the paper, and the person uploading it is the one
  // who can fix them. Silence here means the fault reaches learners.
  // ---------------------------------------------------------------------

  for (const section of sections) {
    // Every correct answer in the same position. Real: all four multiple
    // choice questions in Curiosa's Workbook 1 key to B. A learner who spots
    // it scores full marks on the section without reading a question.
    const keyed = section.items.filter(
      (item) => item.markedBy === "app" && item.correctIndex !== null,
    );
    if (keyed.length >= 3) {
      const positions = new Set(keyed.map((item) => item.correctIndex));
      if (positions.size === 1) {
        const letter = String.fromCharCode(65 + keyed[0].correctIndex!);
        problems.push(
          `Every one of the ${keyed.length} answered questions in "${section.title}" has ${letter} as the correct answer. A learner who notices scores full marks without reading them. Shuffle the options.`,
        );
      }
    }

    // The same question twice, usually a copy-and-paste that was never edited.
    const seen = new Map<string, number>();
    for (const item of section.items) {
      const key = item.stem.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!key) continue;
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (count === 2) {
        problems.push(
          `"${short(item.stem)}" appears twice in "${section.title}". One of them is probably a copy that was never edited.`,
        );
      }
    }

    // A section that prints itself as worth nothing. Every question in it then
    // has nothing to share out, so they all come back unmarked.
    if (section.markTotal === 0) {
      problems.push(
        `"${section.title}" is printed as worth 0 marks, so none of its ${section.items.length} questions can carry any. Give the section a mark total.`,
      );
    }

    for (const item of section.items) {
      if (item.points !== null && item.points === 0) {
        problems.push(
          `"${short(item.stem)}" is worth no marks. Either give it marks or remove it.`,
        );
      }

      // Two options saying the same thing means the question has two right
      // answers or two wrong ones, and either way it does not discriminate.
      const options = item.options.map((option) =>
        option.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
      );
      const unique = new Set(options.filter(Boolean));
      if (options.length > 0 && unique.size < options.filter(Boolean).length) {
        problems.push(
          `"${short(item.stem)}" has two options that say the same thing.`,
        );
      }

      // An option far longer than the others is the classic tell: examiners
      // qualify the right answer and leave the wrong ones bare.
      if (item.markedBy === "app" && item.correctIndex !== null && item.options.length >= 3) {
        const lengths = item.options.map((option) => option.length);
        const correct = lengths[item.correctIndex];
        const others = lengths.filter((_, index) => index !== item.correctIndex);
        const longest = Math.max(...others);
        if (correct > longest * 1.8 && correct > 40) {
          notes.push(
            `In "${short(item.stem)}" the correct answer is much longer than the others, which can give the answer away. Consider making the options similar in length.`,
          );
        }
      }
    }
  }

  const grandTotal = roundMarks(sections.reduce(
    (sum, section) => sum + (section.markTotal ?? 0),
    0,
  ));
  const printsNoMarks = sections.every((section) => section.markTotal === null);

  if (memo.total !== null && printsNoMarks) {
    // Nothing to reconcile against: the workbook prints no marks anywhere, so
    // the two figures do not disagree — one of them simply is not there. Saying
    // "the sections add up to 0" invites somebody to look for the missing 100.
    problems.push(
      `The guide gives a total of ${memo.total} marks, but the workbook prints no marks against any of its ${sections.reduce((n, section) => n + section.items.length, 0)} tasks. Put the mark for each task on the task, or the App cannot share the total out.`,
    );
  } else if (memo.total !== null && grandTotal !== memo.total) {
    problems.push(
      `The guide gives a total of ${memo.total} marks; the sections add up to ${grandTotal}.`,
    );
  }

  // Files given each other's names. Every other complaint follows from that
  // one, so it is the only one shown: thirty lines about missing answers bury
  // the single thing to fix, which is to swap the files (job sheet D10).
  const swapped = problems.filter(
    (problem) =>
      problem.startsWith("This reads like a marking guide") ||
      problem.startsWith("The guide reads like the learner's paper"),
  );
  if (swapped.length > 0) {
    return { ...paper, sections, problems: swapped, notes };
  }

  return { ...paper, sections, problems, notes };
}
