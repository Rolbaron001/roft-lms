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
};

export type ParsedSection = {
  title: string;
  instruction: string | null;
  /** As the paper prints it, which is checked against the items. */
  markTotal: number | null;
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

const SECTION_HEADING =
  /^(?:(Activity\s+[\d.]+)|(SECTION\s+[A-Z])|(PART\s+\d+))\s*[::]\s*(.+)$/i;
const NUMBERED = /^(\d+)\.\s+(.+)$/;
const OPTION = /^([A-H])\.\s+(.+)$/;
const TRUE_FALSE = /\[\s*True\s*\/\s*False\s*\]\s*$/i;
const MARKS_IN_HEADING = /\((\d+)\s*Marks?\b/i;
const CRITERIA_TRAILING = /\(((?:IAC|AC)\d{3,6}(?:\s*,\s*(?:IAC|AC)\d{3,6})*)\)\s*$/i;
const CRITERIA_ANY = /\b(?:IAC|AC)\d{3,6}\b/gi;
const SCOPE_LINE = /^Internal Assessment Criteria\s*[::]\s*(.+)$/i;

const ITEM_HEADING =
  /^Question\s+([A-Z]?[0-9]+(?:[.][0-9]+)*)\s*[::]\s*(.+)$/i;

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
  /^Task\s+(\d+)\s*[::]\s*(.+)$/i;

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

  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  let pending: ParsedItem | null = null;

  const closeItem = () => {
    if (current && pending) current.items.push(pending);
    pending = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;

    // A set of tasks under a case study. The stimulus is the lines between the
    // scenario heading above and this one: the tasks are meaningless without
    // it, and it is stated once rather than repeated on each.
    const taskSection = TASK_SECTION.exec(line);
    if (taskSection) {
      closeItem();

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
      const label = (heading[1] ?? heading[2] ?? heading[3]).trim();
      const rest = heading[4].trim();
      const marks = MARKS_IN_HEADING.exec(rest);

      current = {
        title: `${label}: ${rest.replace(/\s*\([^)]*\)\s*$/, "").trim()}`,
        instruction: null,
        markTotal: marks ? Number(marks[1]) : null,
        items: [],
      };
      sections.push(current);
      continue;
    }

    if (!current) continue;

    // An option belongs to the question above it.
    const option = OPTION.exec(line);
    if (option && pending) {
      pending.options.push(option[2].trim());
      continue;
    }

    const numbered = NUMBERED.exec(line);
    if (numbered) {
      closeItem();
      pending = {
        number: numbered[1],
        // Assumed multiple choice until the following lines say otherwise;
        // corrected below if no options arrive.
        type: "multiple_choice",
        stem: stripCriteria(numbered[2]),
        options: [],
        correctIndex: null,
        points: null,
        criterionCodes: criteriaOf(numbered[2]),
        markingGuide: null,
        markedBy: "app",
      };
      continue;
    }

    // "Task 2: Job Analysis (IAC0201, IAC0202) — Formulate a procedure…"
    const task = TASK_ITEM.exec(line);
    if (task && current) {
      closeItem();
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
        points: marks ? Number(marks[1]) : null,
        criterionCodes:
          taskCriteria.length > 0 ? taskCriteria : criteriaOf(rest),
        markingGuide: null,
        markedBy: "assessor",
      };
      continue;
    }

    // "Question C1: Work Profiling (20 Marks) [PM-01, PS0101]" opens a
    // question in its own right, and the lines under it are its context
    // rather than more questions.
    const itemHeading = ITEM_HEADING.exec(line);
    if (itemHeading) {
      closeItem();
      const rest = itemHeading[2];
      const marks = MARKS_IN_HEADING.exec(rest);
      const bracket = BRACKET_CRITERIA.exec(rest);

      pending = {
        number: itemHeading[1],
        type: "long_answer",
        stem: rest
          .replace(MARKS_IN_HEADING, "")
          .replace(BRACKET_CRITERIA, "")
          .replace(/[()]\s*$/, "")
          .trim(),
        options: [],
        correctIndex: null,
        points: marks ? Number(marks[1]) : null,
        criterionCodes: bracket ? codesIn(bracket[1]) : criteriaOf(rest),
        markingGuide: null,
        markedBy: "assessor",
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
        continue;
      }
    }

    // A bare sentence inside a structured activity is a question in its own
    // right. Recognised by carrying criteria, or by being long enough that it
    // cannot be a stray label.
    if (!pending && (CRITERIA_TRAILING.test(line) || line.length > 60)) {
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

  // A question that never collected options is not multiple choice.
  for (const section of sections) {
    for (const item of section.items) {
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
  answers: MemoAnswer[];
  total: number | null;
  problems: string[];
};

const MEMO_ACTIVITY =
  /^(Activity\s+[\d.]+|SECTION\s+[A-Z])\s*[::]\s*(.+?)\s*\((\d+)\s*Marks?/i;
const MEMO_QUESTION =
  /^Question\s+([\d.]+)\s*[::]\s*(.+?)\s*\((\d+)\s*Marks?\)/i;
const LETTER_ONLY = /^([A-H])$/;
const TRUE_FALSE_ONLY = /^(TRUE|FALSE)$/i;
const NUMBER_ONLY = /^(\d+)$/;

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
  const answers: MemoAnswer[] = [];
  const problems: string[] = [];
  let total: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const activity = MEMO_ACTIVITY.exec(line);
    if (activity) {
      const label = activity[1].trim();
      const rest = activity[2].replace(/\s*\([^)]*\)\s*$/, "").trim();
      sectionMarks[`${label}: ${rest}`] = Number(activity[3]);
      continue;
    }

    const question = MEMO_QUESTION.exec(line);
    if (question) {
      questionMarks[question[1]] = Number(question[3]);
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

  // The true/false table: statement, TRUE or FALSE, rationale, criteria.
  for (let index = 0; index < lines.length; index += 1) {
    const verdict = TRUE_FALSE_ONLY.exec(lines[index]);
    if (!verdict) continue;

    const statement = lines[index - 1] ?? "";
    // The header row is "Answer"; a statement is a sentence.
    if (statement.length < 20) continue;

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

  return { sectionMarks, questionMarks, answers, total, problems };
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
      "The guide carries no answer key, which is right for this paper: every task is written work an assessor reads.",
    );
  }

  const byNumber = new Map(
    memo.answers.filter((a) => a.number).map((a) => [a.number, a]),
  );
  const trueFalseAnswers = memo.answers.filter((a) => a.trueFalse);
  let trueFalseIndex = 0;

  const sections = paper.sections.map((section) => {
    const printedMarks =
      section.markTotal ?? memo.sectionMarks[section.title] ?? null;

    const items = section.items.map((item) => {
      const merged: ParsedItem = { ...item };

      // Nothing in the guide can key a question a person marks, and saying so
      // as a problem would bury the real ones.
      if (item.markedBy === "assessor") {
        const key = Object.keys(memo.questionMarks).find(
          (number) => number === item.number || number.endsWith(`.${item.number}`),
        );
        if (key) merged.points = memo.questionMarks[key];
        return merged;
      }

      if (item.type === "multiple_choice") {
        const answer = byNumber.get(item.number);
        if (!answer?.correctLetter) {
          problems.push(
            `Question ${item.number} of "${section.title}" has no correct answer in the guide.`,
          );
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
      }

      return merged;
    });

    // Selected-response questions carry one mark each unless the guide says
    // otherwise; that is what "1 Mark Each" in every heading means.
    const unmarked = items.filter((item) => item.points === null);
    if (printedMarks !== null && unmarked.length > 0) {
      const accounted = items.reduce((sum, item) => sum + (item.points ?? 0), 0);
      const each = (printedMarks - accounted) / unmarked.length;
      if (Number.isInteger(each) && each > 0) {
        for (const item of unmarked) item.points = each;
      }
    }

    const computed = items.reduce((sum, item) => sum + (item.points ?? 0), 0);
    if (printedMarks !== null && computed !== printedMarks) {
      problems.push(
        `"${section.title}" is printed as ${printedMarks} marks, but its questions add up to ${computed}.`,
      );
    }

    return { ...section, markTotal: printedMarks, items };
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

  if (familiesDiffer) {
    problems.push(
      `The scope lists ${[...declaredFamilies].join(" and ")} codes (${paper.declaredCriteria.join(", ")}), but the tasks are tagged to ${[...taggedFamilies].join(" and ")} codes (${[...otherScheme, ...tested].sort().join(", ")}). One of the two is wrong, and until they agree nothing in this workbook evidences anything.`,
    );
  } else {
    for (const code of untested) {
      problems.push(
        `${code} is listed in the workbook's scope but no question is tagged to it.`,
      );
    }
  }

  // The invariant that matters most: a question the App is meant to mark and
  // cannot is a silently wrong mark waiting to happen. Either the guide is
  // missing an answer, or the question belongs to an assessor after all — and
  // only the author knows which.
  for (const section of sections) {
    for (const item of section.items) {
      if (item.markedBy !== "app") continue;
      if (item.correctIndex !== null) continue;
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
          `"${short(item.stem)}" is worth no marks. Either give it some or take it out — a question worth nothing still costs a learner time.`,
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
            `In "${short(item.stem)}" the correct answer is much longer than the others, which is a well-known giveaway. Worth evening them up.`,
          );
        }
      }
    }
  }

  const grandTotal = sections.reduce(
    (sum, section) => sum + (section.markTotal ?? 0),
    0,
  );
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

  return { ...paper, sections, problems, notes };
}
