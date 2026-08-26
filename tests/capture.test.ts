/**
 * Reading a workbook out of Word.
 *
 * The fixtures below are the real text of Curiosa's Workbook 1 and its answer
 * guide, as the platform's own docx reader returns them — one line per
 * paragraph, table cells one per line. Testing against invented text would
 * prove nothing: every hard part of this is a quirk of how the real documents
 * are laid out.
 *
 * The tests that matter most are the refusals. A parser that guesses a correct
 * answer produces confidently wrong marking, found only when a moderator looks
 * or a learner appeals — so every test here that expects a problem is guarding
 * against a silent wrong answer.
 */
import { describe, expect, it } from "vitest";
import {
  classifyFilename,
  DEFAULT_CONVENTION,
  type NamingConvention,
} from "@/lib/capture";
import {
  mergeMemorandum,
  parseMemorandum,
  parseWorkbook,
} from "@/lib/capture-parse";

const WORKBOOK = `
WORKBOOK 1: Strategic HRM & Job Architecture
WORKBOOK SCOPE & Internal Assessment Criteria COVERAGE
Covers KM0101 (Fundamentals of Business & Strategic HRM) and KM0102 (Job Design & Organisational Structuring).
Internal Assessment Criteria: IAC0101, IAC0102, IAC0103, IAC0203, IAC0204.

Activity 1.1: Multiple Choice Questions (KM0101 & KM0102)
Select the most appropriate answer for each question.
1. How does an organisation's strategic purpose directly influence its HR architecture design?
A. It dictates standard payroll tax percentages.
B. It aligns job roles, structural reporting, and talent practices to achieve strategic intent.
C. It replaces the need for formal job evaluation systems.
D. It eliminates organised labour input.

2. In the HRM value chain, which leadership principle ensures operational alignment?
A. Autocratic command structures
B. Strategic HRM integration
C. Transactional attendance tracking
D. Informal task delegation

Activity 1.2: True / False Statements
Labour economics principles directly affect an HR Officer's workforce planning decisions.  [True / False]

The organizational value chain operates completely independently of the HRM value chain.  [True / False]

Activity 1.3: Short Answer & Structured Questions
Answer the following questions in detail, referencing theoretical principles where appropriate.
Discuss how different organisational structures impact the implementation of HR architecture. Provide specific examples. (IAC0101)

Explain how micro-economic and macro-economic factors influence an HR Officer's daily responsibilities. (IAC0103, IAC0104)
`.trim();

const GUIDE = `
ASSESSOR GUIDE & MEMORANDUM
2. ASSESSMENT STRUCTURE & MARK DISTRIBUTION
TOTAL
Workbook 1 Aggregate Allocation
Combined Assessment
22 Marks

3. DETAILED MEMORANDUM & MODEL ANSWERS
Activity 1.1: Multiple Choice Questions (2 Marks | 1 Mark Each)
Q#
Correct Option
Model Answer / Explanation
IAC Alignment
1
B
It aligns job roles, structural reporting and talent practices to strategic intent.
IAC0101
2
B
Strategic HRM integration links macro business objectives with line execution.
IAC0102

Activity 1.2: True / False Statements (2 Marks | 1 Mark Each)
Statement Summary
Answer
Assessor Rationale / Justification
IAC Ref
Labour economics principles affect workforce planning decisions.
TRUE
Elasticity and scarcity dictate recruitment difficulty and pay.
IAC0103
The organizational value chain operates independently of the HRM value chain.
FALSE
They are deeply interdependent.
IAC0102

Activity 1.3: Short Answer & Structured Questions (18 Marks Total)
Question 1.3.1: Organizational Structure Impact (9 Marks) [IAC0101]
Question 1.3.2: Economic Factors (9 Marks) [IAC0103, IAC0104]
`.trim();

describe("reading the learner's copy", () => {
  const parsed = parseWorkbook(WORKBOOK);

  it("finds the activities and what each one asks", () => {
    expect(parsed.sections.map((section) => section.title)).toEqual([
      "Activity 1.1: Multiple Choice Questions",
      "Activity 1.2: True / False Statements",
      "Activity 1.3: Short Answer & Structured Questions",
    ]);
    expect(parsed.sections[0].instruction).toBe(
      "Select the most appropriate answer for each question.",
    );
  });

  it("reads a multiple-choice question with its options", () => {
    const item = parsed.sections[0].items[0];
    expect(item.type).toBe("multiple_choice");
    expect(item.stem).toContain("strategic purpose");
    expect(item.options).toHaveLength(4);
    expect(item.options[1]).toContain("aligns job roles");
    // The learner's copy carries no answers, and the parser invents none.
    expect(item.correctIndex).toBeNull();
  });

  it("reads a true/false statement and drops the marker", () => {
    const item = parsed.sections[1].items[0];
    expect(item.type).toBe("true_false");
    expect(item.stem).not.toContain("[True");
    expect(item.options).toEqual(["True", "False"]);
    // A bare true/false has one right answer, so the App can mark it.
    expect(item.markedBy).toBe("app");
  });

  /**
   * The distinction that decides whether a question can be marked at all. A
   * statement with a space to write in asks for a verdict *and* a
   * justification: the verdict might be checkable, but the marks are for the
   * reasoning, and no engine can judge that.
   */
  it("sends a statement with an answer space to an assessor", () => {
    const withSpace = parseWorkbook(
      [
        "SECTION B: TRUE / FALSE STATEMENTS (15 Marks)",
        "Indicate whether each statement is TRUE or FALSE. Provide a justification.",
        "Statement 1: 1. Micro-economic principles focus exclusively on national inflation rates.",
        "Answer: ____________",
        "Statement 2: 2. High absenteeism directly increases operational cost per unit.",
        "Answer: ____________",
      ].join("\n"),
    );

    const items = withSpace.sections[0].items;
    expect(items).toHaveLength(2);
    expect(items[0].markedBy).toBe("assessor");
    expect(items[0].type).toBe("short_answer");
    expect(items[0].stem).toContain("Micro-economic");
    // And the blank line the learner writes on is not a question.
    expect(items.some((item) => /^Answer/i.test(item.stem))).toBe(false);
  });

  it("sends a numbered task with no options to an assessor", () => {
    const tasks = parseWorkbook(
      [
        "SECTION C: PRACTICAL QUESTIONS (20 Marks)",
        "1. Draft the Job Description profile including Job Purpose and key result areas.",
        "2. Formulate the Employee Specification detailing formal NQF qualifications.",
      ].join("\n"),
    );

    const items = tasks.sections[0].items;
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.markedBy === "assessor")).toBe(true);
    expect(items.every((item) => item.type === "short_answer")).toBe(true);
  });

  it("takes criteria straight off a structured question", () => {
    const items = parsed.sections[2].items;
    expect(items).toHaveLength(2);
    expect(items[0].type).toBe("long_answer");
    expect(items[0].criterionCodes).toEqual(["IAC0101"]);
    // The question the document tags to two at once.
    expect(items[1].criterionCodes).toEqual(["IAC0103", "IAC0104"]);
    // And the tag is not left in the question a learner reads.
    expect(items[1].stem).not.toContain("IAC");
  });

  it("reads the scope table", () => {
    expect(parsed.declaredCriteria).toContain("IAC0101");
    expect(parsed.declaredCriteria).toContain("IAC0204");
  });
});

describe("reading the answer guide", () => {
  const memo = parseMemorandum(GUIDE);

  it("finds the correct option for each question", () => {
    const first = memo.answers.find((answer) => answer.number === "1");
    expect(first?.correctLetter).toBe("B");
    expect(first?.criterionCodes).toEqual(["IAC0101"]);
  });

  it("finds each true or false verdict", () => {
    const verdicts = memo.answers
      .filter((answer) => answer.trueFalse)
      .map((answer) => answer.trueFalse);
    expect(verdicts).toEqual(["TRUE", "FALSE"]);
  });

  it("reads the marks per activity and per question", () => {
    expect(memo.sectionMarks["Activity 1.1: Multiple Choice Questions"]).toBe(2);
    expect(memo.questionMarks["1.3.1"]).toBe(9);
    expect(memo.total).toBe(22);
  });
});

describe("putting the two together", () => {
  const merged = mergeMemorandum(parseWorkbook(WORKBOOK), parseMemorandum(GUIDE));

  it("keys every selected-response question", () => {
    expect(merged.sections[0].items.map((item) => item.correctIndex)).toEqual([
      1, 1,
    ]);
    // TRUE is the first option, FALSE the second.
    expect(merged.sections[1].items.map((item) => item.correctIndex)).toEqual([
      0, 1,
    ]);
  });

  it("gives every question its marks, and they reconcile", () => {
    const marks = merged.sections.map((section) =>
      section.items.reduce((sum, item) => sum + (item.points ?? 0), 0),
    );
    expect(marks).toEqual([2, 2, 18]);
    expect(marks.reduce((a, b) => a + b, 0)).toBe(22);
  });

  it("brings criteria across from the guide as well as the question", () => {
    // Question 2 is tagged nowhere in the workbook and IAC0102 in the guide.
    expect(merged.sections[0].items[1].criterionCodes).toEqual(["IAC0102"]);
  });

  it("carries the model answer as marking guidance", () => {
    expect(merged.sections[0].items[0].markingGuide).toContain(
      "strategic intent",
    );
  });

  /**
   * A real finding in Curiosa's own Workbook 1: its scope claims criteria that
   * no question in it is tagged to. Reported rather than corrected — only the
   * author knows whether the scope is wrong or a question is missing.
   */
  it("reports a criterion the scope claims but nothing tests", () => {
    expect(
      merged.problems.some((problem) => problem.includes("IAC0204")),
    ).toBe(true);
  });
});

describe("what it refuses to guess", () => {
  it("reports a question the guide has no answer for", () => {
    const paper = parseWorkbook(WORKBOOK);
    const thin = parseMemorandum(
      GUIDE.replace(/^2\nB\n.+$/m, "").replace("2\nB", ""),
    );
    const merged = mergeMemorandum(paper, thin);

    expect(
      merged.problems.some((problem) =>
        /has no correct answer in the guide/.test(problem),
      ),
    ).toBe(true);
  });

  it("reports a correct option the question does not have", () => {
    const paper = parseWorkbook(WORKBOOK);
    const memo = parseMemorandum(GUIDE.replace("1\nB\n", "1\nG\n"));
    const merged = mergeMemorandum(paper, memo);

    expect(
      merged.problems.some((problem) =>
        /that question has 4 options/.test(problem),
      ),
    ).toBe(true);
  });

  it("reports marks that do not add up", () => {
    const paper = parseWorkbook(WORKBOOK);
    const memo = parseMemorandum(
      GUIDE.replace(
        "Activity 1.1: Multiple Choice Questions (2 Marks | 1 Mark Each)",
        "Activity 1.1: Multiple Choice Questions (7 Marks | 1 Mark Each)",
      ),
    );
    const merged = mergeMemorandum(paper, memo);

    expect(
      merged.problems.some((problem) => /printed as 7 marks/.test(problem)),
    ).toBe(true);
  });

  /**
   * The invariant that matters most. A question the App is set to mark and
   * cannot is a silently wrong mark waiting to happen.
   */
  it("refuses to leave an App-marked question without an answer", () => {
    const paper = parseWorkbook(WORKBOOK);
    const merged = mergeMemorandum(paper, {
      sectionMarks: {},
      questionMarks: {},
      answers: [],
      total: null,
      problems: [],
    });

    const unanswerable = merged.problems.filter((problem) =>
      /marked by the App, but no correct answer/.test(problem),
    );
    expect(unanswerable.length).toBeGreaterThan(0);
  });

  it("counts what an assessor will have to mark, as a note not a fault", () => {
    const merged = mergeMemorandum(
      parseWorkbook(WORKBOOK),
      parseMemorandum(GUIDE),
    );
    expect(merged.notes.some((note) => /marked by an assessor/.test(note))).toBe(
      true,
    );
    // And it is not counted among the things needing correction.
    expect(
      merged.problems.some((problem) => /marked by an assessor/.test(problem)),
    ).toBe(false);
  });

  it("says so plainly when the document is not a paper at all", () => {
    const parsed = parseWorkbook("Just some prose with no activities in it.");
    expect(parsed.sections).toHaveLength(0);
    expect(parsed.problems[0]).toContain("No activities or sections");
  });
});

describe("what the filename says", () => {
  it("reads Curiosa's convention", () => {
    const classified = classifyFilename("CA 121151 SU1 WB1.docx");
    expect(classified).toMatchObject({
      provider: "CA",
      qualification: "121151",
      studyUnit: "SU1",
      artefact: "workbook",
      number: "1",
      isMemorandum: false,
    });
    expect(classified.unread).toEqual([]);
  });

  it("spots the memorandum beside it", () => {
    expect(classifyFilename("CA 121151 SU1 WB1 AG.docx").isMemorandum).toBe(true);
    expect(classifyFilename("CA 121151 SU1 SA1 V1 AG.docx")).toMatchObject({
      artefact: "summative_assessment",
      isMemorandum: true,
    });
  });

  /** A tenant filing differently is slowed down, never blocked. */
  it("says what it could not read rather than refusing", () => {
    const classified = classifyFilename("Workbook one final draft.docx");
    expect(classified.artefact).toBeNull();
    expect(classified.unread).toContain("qualification");
    expect(classified.unread).toContain("study unit");
  });

  it("follows a tenant's own codes", () => {
    const convention: NamingConvention = {
      ...DEFAULT_CONVENTION,
      artefactCodes: { WKB: "workbook", EXAM: "summative_assessment" },
      memorandumMarker: "MEMO",
    };

    expect(classifyFilename("ACME 654321 SU3 WKB2 MEMO.docx", convention)).toMatchObject(
      {
        provider: "ACME",
        qualification: "654321",
        studyUnit: "SU3",
        artefact: "workbook",
        number: "2",
        isMemorandum: true,
      },
    );

    // And the built-in codes stop applying, because they are not this tenant's.
    expect(classifyFilename("ACME 654321 SU3 WB2.docx", convention).artefact).toBeNull();
  });
});

describe("faults in the material rather than the parse", () => {
  const paperWith = (lines: string[]) => parseWorkbook(lines.join("\n"));

  const keyed = (letters: string[]) =>
    parseMemorandum(
      [
        "Activity 1.1: Multiple Choice Questions (3 Marks | 1 Mark Each)",
        "Q#",
        "Correct Option",
        "Model Answer",
        "IAC Alignment",
        ...letters.flatMap((letter, index) => [
          String(index + 1),
          letter,
          "Because of the reason given.",
          "IAC0101",
        ]),
      ].join("\n"),
    );

  const threeQuestions = [
    "Activity 1.1: Multiple Choice Questions (3 Marks)",
    "1. First question about organisational structure and its effects?",
    "A. First option",
    "B. Second option",
    "C. Third option",
    "2. Second question about the HRM value chain and leadership?",
    "A. First option",
    "B. Second option",
    "C. Third option",
    "3. Third question about labour economics and workforce planning?",
    "A. First option",
    "B. Second option",
    "C. Third option",
  ];

  /**
   * A real finding in Curiosa's Workbook 1: all four multiple choice answers
   * are B. A learner who notices scores the section without reading it.
   */
  it("shouts when every correct answer is in the same position", () => {
    const merged = mergeMemorandum(
      paperWith(threeQuestions),
      keyed(["B", "B", "B"]),
    );

    expect(
      merged.problems.some((problem) =>
        /has B as the correct answer/.test(problem),
      ),
    ).toBe(true);
  });

  it("says nothing when the answers are spread", () => {
    const merged = mergeMemorandum(
      paperWith(threeQuestions),
      keyed(["A", "B", "C"]),
    );

    expect(
      merged.problems.some((problem) => /correct answer/.test(problem)),
    ).toBe(false);
  });

  it("spots the same question asked twice", () => {
    const merged = mergeMemorandum(
      paperWith([
        "Activity 2.1: Structured Questions (20 Marks)",
        "Discuss how organisational structure affects HR architecture in practice. (IAC0101)",
        "Discuss how organisational structure affects HR architecture in practice. (IAC0102)",
      ]),
      parseMemorandum(""),
    );

    expect(
      merged.problems.some((problem) => /appears twice/.test(problem)),
    ).toBe(true);
  });

  it("spots two options that say the same thing", () => {
    const merged = mergeMemorandum(
      paperWith([
        "Activity 1.1: Multiple Choice Questions (1 Mark)",
        "1. Which structure has employees reporting to more than one manager?",
        "A. A matrix organisation",
        "B. A matrix organisation",
        "C. A flat organisation",
      ]),
      keyed(["A"]),
    );

    expect(
      merged.problems.some((problem) =>
        /two options that say the same thing/.test(problem),
      ),
    ).toBe(true);
  });

  /** A giveaway, not a fault — so it is a note rather than a problem. */
  it("notes a correct answer far longer than its distractors", () => {
    const merged = mergeMemorandum(
      paperWith([
        "Activity 1.1: Multiple Choice Questions (1 Mark)",
        "1. What does a Service Level Agreement attached to a contract define?",
        "A. Performance metrics, quality standards, review cycles and the remedies available where the standard is not met",
        "B. The tax rate",
        "C. Office hours",
      ]),
      keyed(["A"]),
    );

    expect(
      merged.notes.some((note) => /much longer than the others/.test(note)),
    ).toBe(true);
    expect(
      merged.problems.some((problem) => /much longer/.test(problem)),
    ).toBe(false);
  });

  it("spots a section printed as worth nothing", () => {
    const merged = mergeMemorandum(
      paperWith([
        "Activity 1.1: Multiple Choice Questions (0 Marks)",
        "1. Which structure has employees reporting to more than one manager?",
        "A. Matrix",
        "B. Flat",
      ]),
      parseMemorandum(
        [
          "Activity 1.1: Multiple Choice Questions (0 Marks)",
          "Q#",
          "Correct Option",
          "Model",
          "IAC",
          "1",
          "A",
          "Because of the reason.",
          "IAC0101",
        ].join("\n"),
      ),
    );

    expect(
      merged.problems.some((problem) =>
        /printed as worth 0 marks/.test(problem),
      ),
    ).toBe(true);
  });
});
