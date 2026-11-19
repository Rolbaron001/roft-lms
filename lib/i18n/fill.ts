/**
 * Filling a phrase's {placeholders}, with "1 decision" rather than "1 decisions".
 *
 * Roland, 19 November 2026: the moderation report read "1 decisions". About
 * seventy English phrases put a count straight before a plural noun, and each
 * would otherwise need a second phrase for one. So in an English phrase, when
 * the value filled in is 1, the noun right after it becomes singular, and a
 * verb right after that agrees ("1 module is in no study unit"). Only the
 * nouns listed here change; any other word is left as written.
 *
 * Applied to English only: a translation carries its own grammar. Imports
 * nothing, so the browser can use it.
 */
const SINGULAR: Record<string, string> = {
  activities: "activity",
  answers: "answer",
  bytes: "byte",
  certificates: "certificate",
  cohorts: "cohort",
  courses: "course",
  credits: "credit",
  criteria: "criterion",
  days: "day",
  decisions: "decision",
  documents: "document",
  entries: "entry",
  files: "file",
  hours: "hour",
  items: "item",
  learners: "learner",
  lines: "line",
  logbooks: "logbook",
  marks: "mark",
  minutes: "minute",
  modules: "module",
  people: "person",
  questions: "question",
  records: "record",
  seconds: "second",
  sessions: "session",
  steps: "step",
  submissions: "submission",
  things: "thing",
  topics: "topic",
  units: "unit",
  weeks: "week",
  words: "word",
};

const AGREE: Record<string, string> = { are: "is", were: "was", have: "has", hold: "holds", belong: "belongs" };

const isOne = (value: unknown) => value === 1 || value === "1";

export function fillPhrase(phrase: string, values: Record<string, string | number> | undefined, english: boolean): string {
  if (!values) return phrase;
  const agreed = english
    ? phrase.replace(
        // A few qualifiers may stand between: "1 internal assessment criterion", "1 class session".
        /\{(\w+)\} ((?:(?:internal|assessment|class|work|study) )*)([a-z]+)(?: (are|were|have|hold|belong)\b)?/g,
        (all, name: string, between: string, noun: string, verb?: string) => {
          if (!isOne(values[name]) || !(noun in SINGULAR)) return all;
          return `{${name}} ${between}${SINGULAR[noun]}${verb ? ` ${AGREE[verb]}` : ""}`;
        },
      )
    : phrase;
  return agreed.replace(/\{(\w+)\}/g, (all, name: string) => (name in values ? String(values[name]) : all));
}
