/**
 * The FISA examiner and moderator checklists, verbatim from the templates.
 *
 * Taken from `Design/Templates/Examiner Developer Report.docx` and
 * `FISA Pre-Moderator Report.docx`. These are the questions the two people
 * actually answer, in their own words and their own order, because the reports
 * are evidence a QCTO monitor reads and a paraphrase is not the same document.
 *
 * **FISA is not EISA, and the difference is the whole reason this exists.** An
 * EISA is set and administered by the Assessment Quality Partner; the provider
 * only registers learners for a sitting. A FISA is set by the provider's own
 * examiner, moderated by the provider's own moderator, and moderated *before
 * anybody sits it*. That last part is what "pre-moderator" means, and it is
 * unlike every other moderation in the platform, which samples learner work
 * after the fact.
 *
 * Three things in the source documents are wrong and are recorded here as they
 * are rather than quietly corrected, in the same way the part-qualification
 * parser records what a curriculum document actually says:
 *
 *   The pre-moderator report numbers two different sections "5" - Technical
 *   Aspects and Overall Quality. Internally they are 5 and 6 so they can be
 *   told apart, and `printedAs` carries the number the paper shows.
 *
 *   The examiner report still contains a previous drafter's placeholder text
 *   ("ELO 2: dufugohihjpo"), and a typo, "anove" for "above". Neither is
 *   reproduced; they are in the template, not in the checklist.
 *
 *   Item 1.1 on the moderator's report offers "n/a" where every other item
 *   offers only Yes or No. That one is honoured: see `allowsNotApplicable`.
 *
 * Pure on purpose - no imports, no database - so the forms can use it in the
 * browser without dragging the Postgres driver in with them.
 */

export type ChecklistAnswer = "yes" | "no" | "na";

export type ChecklistItem = {
  /** "1.1" - the number the paper shows, and what a monitor will cite. */
  code: string;
  text: string;
  /** Only item 1.1 offers it. Everything else is Yes or No. */
  allowsNotApplicable?: boolean;
};

export type ChecklistSection = {
  /** Our own number, so two sections numbered 5 can be told apart. */
  number: number;
  /** What the paper prints, which is not always our number. */
  printedAs: string;
  title: string;
  items: ChecklistItem[];
};

/**
 * Section 1 through 5, shared by both reports.
 *
 * The examiner asks them of their own instrument as they build it; the
 * moderator asks the same questions of the finished thing. The wording differs
 * in two places between the two documents and is reconciled below, with the
 * difference noted where it matters.
 */
const DEVELOPMENT: ChecklistItem[] = [
  {
    code: "1.1",
    text: "The correct Qualification Name has been indicated on the Assessment",
    // The only item on either report that offers a third answer.
    allowsNotApplicable: true,
  },
  {
    code: "1.2",
    text: "All Exit Level Outcomes of the qualification have been met in the FISA",
  },
  {
    code: "1.3",
    text: "Assessment complies with recommended cognitive application",
  },
  {
    code: "1.4",
    text: "The FISA assessment questions/task are relevant to applied knowledge and skills",
  },
  {
    code: "1.5",
    text: "There is a clear relationship between mark allocation and the level of difficulty",
  },
  {
    code: "1.6",
    text: "The required evidence is suitable to the corresponding ELO's",
  },
  {
    code: "1.7",
    text: "The following has been indicated on the Assessment: assessment requirements needed, and competence/pass requirements",
  },
];

const CONTENT_COVERAGE: ChecklistItem[] = [
  {
    code: "3.1",
    // The examiner's copy says "questions/tasks"; the moderator's says
    // "questions". Kept as the fuller of the two, which covers both.
    text: "The assessment instrument covers questions/tasks of various types",
  },
  {
    code: "3.2",
    text: "Examples, graphs or illustrations used are clear, suitable and appropriate (if used)",
  },
  { code: "3.3", text: "The content is pitched at the correct NQF level" },
  {
    code: "3.4",
    text: "Questions have not been repeated verbatim from previous questions, or there is a variety of questions/tasks in the item bank (eAssessment)",
  },
];

const MARKING_MEMORANDUM: ChecklistItem[] = [
  {
    code: "4.1",
    text: "The marking memorandum (numbers and content) corresponds with the assessment instrument",
  },
  {
    code: "4.2",
    text: "The marking memorandum facilitates consistent marking (provides clear guidelines, and clear mark allocation)",
  },
  {
    code: "4.3",
    text: "The marking memorandum totals correspond with the totals in the assessment instrument",
  },
];

const TECHNICAL: ChecklistItem[] = [
  {
    code: "5.1",
    text: "The assessment instrument has all the relevant information such as title of qualification, duration, date, total, and applicable instructions for the FISA",
  },
  { code: "5.2", text: "The instructions to candidates are clear and unambiguous" },
  { code: "5.3", text: "The questions have been correctly numbered" },
  {
    code: "5.4",
    text: "The pages are correctly numbered (if written assessment instrument)",
  },
  {
    code: "5.5",
    text: "Mark allocation has been clearly indicated for each question and section",
  },
  {
    code: "5.6",
    text: "The assessment instrument and memorandum is complete in all aspects, including any attachments",
  },
  {
    code: "5.7",
    text: "The same font is used throughout the paper / format used in eAssessment is user-friendly",
  },
  {
    code: "5.8",
    text: "Candidates will be able to complete the assessment in the given time allocation",
  },
];

/** What the examiner or developer answers about their own instrument. */
export const EXAMINER_SECTIONS: ChecklistSection[] = [
  {
    number: 1,
    printedAs: "1",
    title: "Development of assessment instrument",
    items: DEVELOPMENT,
  },
  { number: 3, printedAs: "3", title: "Content coverage", items: CONTENT_COVERAGE },
  {
    number: 4,
    printedAs: "4",
    title: "Marking memorandum",
    items: MARKING_MEMORANDUM,
  },
  { number: 5, printedAs: "5", title: "Technical aspects", items: TECHNICAL },
];

/**
 * What the moderator answers, before anybody sits the assessment.
 *
 * The same five sections, plus the two that make it a moderation rather than a
 * second opinion: the overall quality judgement, and the final sign-off that
 * the instrument is fit for purpose.
 */
export const MODERATOR_SECTIONS: ChecklistSection[] = [
  {
    number: 1,
    printedAs: "1",
    title: "Moderation of assessment instrument",
    items: DEVELOPMENT,
  },
  { number: 3, printedAs: "3", title: "Content coverage", items: CONTENT_COVERAGE },
  {
    number: 4,
    printedAs: "4",
    title: "Marking memorandum",
    items: MARKING_MEMORANDUM,
  },
  { number: 5, printedAs: "5", title: "Technical aspects", items: TECHNICAL },
  {
    /**
     * The paper numbers this "5" as well, immediately after Technical Aspects.
     * Ours is 6 so the two can be told apart; `printedAs` keeps the paper's.
     */
    number: 6,
    printedAs: "5",
    title: "Final moderation",
    items: [
      {
        code: "6.1",
        text: "This FISA has been approved as the final version by the Moderator (i.e. all final recommendations have been agreed upon by the examiner and moderator and have been applied)",
      },
      { code: "6.2", text: "This FISA is signed off as 'fit-for-purpose'" },
    ],
  },
];

/**
 * The two items that decide whether a FISA may be used at all.
 *
 * Separated out because they are not really checklist items: they are the gate.
 * Everything else on the report is a recommendation; these two are permission.
 */
export const SIGN_OFF_CODES = ["6.1", "6.2"] as const;

/** The overall judgement the moderator records, in the paper's own words. */
export const QUALITY_RATINGS = [
  { code: "excellent", label: "Excellent" },
  { code: "good", label: "Good" },
  { code: "satisfactory", label: "Satisfactory" },
  { code: "poor", label: "Poor" },
] as const;

export type QualityRating = (typeof QUALITY_RATINGS)[number]["code"];

/**
 * How demanding an exit level outcome is, in section 2 of both reports.
 *
 * The examiner's own template has "L,H" in one cell - two levels against a
 * single outcome - so this is recorded as free text rather than as one of
 * three values. Forcing a choice the paper does not force would lose what the
 * examiner meant.
 */
export const COMPETENCE_LEVELS = [
  { code: "H", label: "High" },
  { code: "M", label: "Medium" },
  { code: "L", label: "Low" },
] as const;

/** Every item on a given report, flattened. */
export function itemsFor(role: "examiner" | "moderator"): ChecklistItem[] {
  const sections = role === "examiner" ? EXAMINER_SECTIONS : MODERATOR_SECTIONS;
  return sections.flatMap((section) => section.items);
}

/** Whether a code belongs to that report at all. */
export function isKnownItem(
  role: "examiner" | "moderator",
  code: string,
): boolean {
  return itemsFor(role).some((item) => item.code === code);
}

/**
 * What is still unanswered on a report.
 *
 * Reported rather than enforced at save time: a report filled in over two
 * sittings has to be saveable half-done, the same way the learner enrolment
 * form is. What it may not do is reach sign-off incomplete, which
 * `readyToSignOff` below decides.
 */
export function unanswered(
  role: "examiner" | "moderator",
  answers: Record<string, ChecklistAnswer | undefined>,
): ChecklistItem[] {
  return itemsFor(role).filter((item) => !answers[item.code]);
}

/**
 * Whether a moderator may sign this off as fit for purpose.
 *
 * Both sign-off items answered yes, and nothing else left blank. A "no"
 * anywhere else does not block sign-off on its own - the moderator may accept
 * an instrument with a recommendation against it, and the report records that
 * they did - but an unanswered item means the question was never put.
 */
export function readyToSignOff(
  answers: Record<string, ChecklistAnswer | undefined>,
): { ready: boolean; why?: string } {
  const missing = unanswered("moderator", answers);

  if (missing.length > 0) {
    return {
      ready: false,
      why: `${missing.length} ${missing.length === 1 ? "item is" : "items are"} unanswered: ${missing
        .slice(0, 4)
        .map((item) => item.code)
        .join(", ")}${missing.length > 4 ? "…" : ""}`,
    };
  }

  for (const code of SIGN_OFF_CODES) {
    if (answers[code] !== "yes") {
      return {
        ready: false,
        why: `Item ${code} has to be answered yes before a FISA can be used.`,
      };
    }
  }

  return { ready: true };
}
