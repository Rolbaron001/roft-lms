/**
 * The words a provider may call things.
 *
 * Roland and Heidi agreed on 8 September that the platform should let a
 * provider use its own vocabulary, so that a deployment in the United Kingdom
 * or the United States is not forced to say "programme" where its people say
 * "pathway" or "track".
 *
 * The whole feature turns on one distinction, and the platform already draws
 * it. `lib/dictionary.ts` classifies every term by who defines it:
 *
 *   authority   A body owns the meaning - QCTO, SAQA, the Skills Development
 *               Act. Changing the word puts a submission or an accreditation
 *               at risk.
 *   practice    Widely used in the sector, owned by nobody.
 *   platform    The platform picked the word. Ours to change.
 *
 * Only the second and third kinds appear below. "Qualification", "Curriculum
 * Module", "Exit Level Outcome", "NQF" and the rest are absent on purpose: a
 * provider who renamed those would have quietly broken their own QCTO
 * submission, and a platform that allowed it would be helping. A test asserts
 * that nothing in this registry collides with an authority term, so the rule
 * survives somebody adding a word here in a hurry.
 *
 * This module imports nothing, so a form can use it.
 */

export type TermKey =
  | "course"
  | "programme"
  | "cohort"
  | "lesson"
  | "studyUnit"
  | "enrolment"
  | "learner"
  | "facilitator"
  | "assessor"
  | "moderator"
  | "workplaceRecord";

export type TermShape = {
  /** One of the thing, as a provider would write it at the start of a line. */
  one: string;
  many: string;
  /** Shown beside the field, so somebody renaming it knows what it governs. */
  note: string;
  /**
   * Why it is safe to rename, from the dictionary's own classification.
   *
   * Surfaced on the screen rather than kept here, because "the sector uses
   * this word but nobody owns it" and "we chose this word" are different
   * invitations to a person deciding whether to change it.
   */
  definedBy: "platform" | "practice";
};

export const TERMS: Record<TermKey, TermShape> = {
  course: {
    one: "Course",
    many: "Courses",
    note: "A single body of learning a person is enrolled onto.",
    definedBy: "platform",
  },
  programme: {
    one: "Programme",
    many: "Programmes",
    note: "A sequence of courses taken in order.",
    definedBy: "platform",
  },
  cohort: {
    one: "Cohort",
    many: "Cohorts",
    note: "A group of people moving through a course together.",
    definedBy: "platform",
  },
  lesson: {
    one: "Lesson",
    many: "Lessons",
    note: "One step inside a course.",
    definedBy: "platform",
  },
  studyUnit: {
    one: "Study unit",
    many: "Study units",
    note: "How a curriculum's modules are grouped for delivery.",
    definedBy: "platform",
  },
  enrolment: {
    one: "Enrolment",
    many: "Enrolments",
    note: "A person's place on a course or programme.",
    definedBy: "platform",
  },
  learner: {
    one: "Learner",
    many: "Learners",
    note: "The person doing the learning. Some providers say student, or candidate.",
    definedBy: "practice",
  },
  facilitator: {
    one: "Facilitator",
    many: "Facilitators",
    note: "The person delivering. Some providers say trainer, tutor, or instructor.",
    definedBy: "practice",
  },
  assessor: {
    one: "Assessor",
    many: "Assessors",
    note: "The person judging evidence against the criteria.",
    definedBy: "practice",
  },
  moderator: {
    one: "Moderator",
    many: "Moderators",
    note: "The person checking a sample of those judgements.",
    definedBy: "practice",
  },
  /**
   * Curiosa call this workplace experience sign-off, not a logbook (27 August).
   *
   * Renameable rather than simply corrected, because both words are in use and
   * neither belongs to anybody: another provider really does call it a
   * logbook, and the QCTO curriculum documents say "logbook" in places. What
   * was wrong was not the word but that the platform insisted on it.
   */
  workplaceRecord: {
    one: "Workplace experience sign-off",
    many: "Workplace experience sign-offs",
    note: "The record of work a learner did, that a coach signs and an assessor accepts.",
    definedBy: "practice",
  },
};

export const TERM_KEYS = Object.keys(TERMS) as TermKey[];

/** What a tenant has chosen to call things. Absent keys keep the default. */
export type TermOverrides = Partial<Record<TermKey, { one: string; many: string }>>;

export type Vocabulary = {
  /** "Course" - for a heading, or the start of a sentence. */
  one(key: TermKey): string;
  many(key: TermKey): string;
  /** "course" - for the middle of a sentence. */
  lowerOne(key: TermKey): string;
  lowerMany(key: TermKey): string;
  /** True where this provider has renamed anything at all. */
  customised: boolean;
};

/**
 * Lowercases a term for use mid-sentence, without flattening a proper noun.
 *
 * A provider who calls a course a "SETA Module" means the capitals; one who
 * typed "Course" out of habit does not. So only a leading capital followed by
 * lowercase is treated as sentence case and folded - anything with a second
 * capital in it is left exactly as written.
 */
function midSentence(value: string): string {
  const [first, ...rest] = value;
  if (!first) return value;
  const tail = rest.join("");
  if (tail !== tail.toLowerCase()) return value;
  return first.toLowerCase() + tail;
}

/**
 * The vocabulary a provider reads the platform in.
 *
 * Falls back per key rather than wholesale, so a provider who renamed only
 * "course" still gets every other word, and a key added to the platform later
 * appears with its default rather than as an empty string.
 */
export function vocabulary(overrides: TermOverrides | null | undefined): Vocabulary {
  const chosen = overrides ?? {};

  const resolve = (key: TermKey, form: "one" | "many"): string => {
    const override = chosen[key]?.[form]?.trim();
    return override || TERMS[key][form];
  };

  return {
    one: (key) => resolve(key, "one"),
    many: (key) => resolve(key, "many"),
    lowerOne: (key) => midSentence(resolve(key, "one")),
    lowerMany: (key) => midSentence(resolve(key, "many")),
    customised: TERM_KEYS.some(
      (key) =>
        (chosen[key]?.one?.trim() && chosen[key]!.one.trim() !== TERMS[key].one) ||
        (chosen[key]?.many?.trim() && chosen[key]!.many.trim() !== TERMS[key].many),
    ),
  };
}

/** The default vocabulary, for anywhere a tenant is not in hand. */
export const DEFAULT_VOCABULARY = vocabulary(null);
