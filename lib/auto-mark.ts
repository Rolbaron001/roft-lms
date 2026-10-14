/**
 * What the platform awards a question by itself, if anything.
 *
 * The same rules as `markResponses` in lib/assessment.ts, for one question at
 * a time, so a paper is marked the way a platform quiz always has been: a
 * selected answer counts only when it matches the key exactly, a matching item
 * only when every pair is right, and true or false with a justification goes
 * to a person whole. Null means a person marks it.
 *
 * Imports nothing, so a client screen can use it to say which questions the
 * platform marks without pulling the database into the browser.
 */
export type AutoMarkable = {
  type: string | null;
  points: number;
  correctOptionIds: string[] | null;
  correctMatches?: Record<string, string> | null;
};

export type GivenAnswer = {
  selectedOptionIds?: string[] | null;
  matchedPairs?: Record<string, string> | null;
};

export function platformMarks(item: AutoMarkable): boolean {
  if (item.type === "true_false_justified") return false;
  if (item.type === "matching") return Object.keys(item.correctMatches ?? {}).length > 0;
  return (item.correctOptionIds ?? []).length > 0;
}

export function autoMark(item: AutoMarkable, answer: GivenAnswer | undefined): number | null {
  if (!platformMarks(item)) return null;

  if (item.type === "matching") {
    const correct = Object.entries(item.correctMatches ?? {});
    const given = answer?.matchedPairs ?? {};
    const right =
      Object.keys(given).length === correct.length &&
      correct.every(([prompt, option]) => given[prompt] === option);
    return right ? item.points : 0;
  }

  const correct = item.correctOptionIds ?? [];
  const given = answer?.selectedOptionIds ?? [];
  const right = given.length === correct.length && correct.every((option) => given.includes(option));
  return right ? item.points : 0;
}

/** Words in an answer, counted the way a reader would count them. */
export function wordCount(text: string | null | undefined): number {
  const trimmed = (text ?? "").trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}
