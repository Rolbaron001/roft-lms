/**
 * The two new question types, and the marking rule that goes with each.
 *
 * `markResponses` is a pure function, so it is tested directly rather than
 * through a database. What matters here is not that the arithmetic runs but
 * that two specific wrong answers are refused:
 *
 *   - A matching item marked as though a partly correct pairing were correct.
 *   - A true-or-false-with-justification item awarded on the box alone, which
 *     hands full marks to a guess and records it as evidence of competence.
 *
 * Both would produce a plausible number rather than a visible failure, which
 * is the kind of fault that survives a review.
 */
import { describe, expect, it } from "vitest";
import { markResponses } from "@/lib/assessment";

const matchingItem = {
  id: "match-1",
  type: "matching",
  points: 4,
  correctOptionIds: null,
  correctMatches: { p1: "o1", p2: "o2", p3: "o3" },
};

describe("matching items", () => {
  it("awards the marks when every pair is right", () => {
    const result = markResponses(
      [matchingItem],
      { "match-1": ["p1:o1", "p2:o2", "p3:o3"] },
    );
    expect(result.score).toBe(4);
    expect(result.maxScore).toBe(4);
  });

  it("does not care what order the pairs arrive in", () => {
    const result = markResponses(
      [matchingItem],
      { "match-1": ["p3:o3", "p1:o1", "p2:o2"] },
    );
    expect(result.score).toBe(4);
  });

  /**
   * All or nothing, the same way a multiple-response item is already marked
   * here. Partial credit on one type and not the others would be a second
   * marking philosophy hiding inside the first.
   */
  it("awards nothing when one pair is wrong", () => {
    const result = markResponses(
      [matchingItem],
      { "match-1": ["p1:o1", "p2:o3", "p3:o2"] },
    );
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(4);
  });

  /**
   * A prompt left unpaired is not the same as one paired wrongly, and neither
   * is a correct answer. Leaving one out must not round up.
   */
  it("awards nothing when a prompt is left unpaired", () => {
    const result = markResponses(
      [matchingItem],
      { "match-1": ["p1:o1", "p2:o2"] },
    );
    expect(result.score).toBe(0);
  });

  it("awards nothing when nothing was answered", () => {
    expect(markResponses([matchingItem], {}).score).toBe(0);
  });

  /**
   * An item nobody has finished writing has no mark scheme, and guessing one
   * is how a half-built assessment starts passing people.
   */
  it("leaves an item with no mark scheme unmarked", () => {
    const unfinished = { ...matchingItem, correctMatches: {} };
    const result = markResponses([unfinished], { "match-1": ["p1:o1"] });
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(4);
  });
});

describe("true or false, with a justification", () => {
  const item = {
    id: "tfj-1",
    type: "true_false_justified",
    points: 5,
    correctOptionIds: ["true"],
    correctMatches: null,
  };

  /**
   * The point of the type. Half of it could be marked by the engine, and
   * marking that half automatically would award the whole item to a learner
   * who picked the right box for the wrong reason. The box is precisely the
   * half a guess gets right.
   */
  it("is never awarded automatically, even when the box is right", () => {
    const result = markResponses([item], { "tfj-1": ["true"] });
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(5);
  });

  it("still counts towards the total, so the paper is not shortened", () => {
    const result = markResponses(
      [item, { id: "mc-1", type: "multiple_choice", points: 2, correctOptionIds: ["a"], correctMatches: null }],
      { "tfj-1": ["true"], "mc-1": ["a"] },
    );
    expect(result.score).toBe(2);
    expect(result.maxScore).toBe(7);
  });
});

describe("the existing types are unchanged", () => {
  it("still marks multiple choice", () => {
    const result = markResponses(
      [{ id: "q", type: "multiple_choice", points: 3, correctOptionIds: ["b"], correctMatches: null }],
      { q: ["b"] },
    );
    expect(result.score).toBe(3);
  });

  it("still requires every option of a multiple response", () => {
    const item = {
      id: "q",
      type: "multiple_response",
      points: 3,
      correctOptionIds: ["a", "b"],
      correctMatches: null,
    };
    expect(markResponses([item], { q: ["a", "b"] }).score).toBe(3);
    expect(markResponses([item], { q: ["a"] }).score).toBe(0);
    expect(markResponses([item], { q: ["a", "b", "c"] }).score).toBe(0);
  });

  /**
   * A written answer has no mark scheme the engine can apply, so it counts
   * towards the total and waits for a person. That was true before these
   * changes and has to stay true.
   */
  it("still leaves a written answer for a person", () => {
    const result = markResponses(
      [{ id: "q", type: "long_answer", points: 10, correctOptionIds: null, correctMatches: null }],
      { q: ["An essay."] },
    );
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(10);
  });

  /**
   * Callers that predate the two new fields still work: the older shape omits
   * `type` and `correctMatches` entirely.
   */
  it("still marks an item described the old way", () => {
    const result = markResponses(
      [{ id: "q", points: 1, correctOptionIds: ["yes"] }],
      { q: ["yes"] },
    );
    expect(result.score).toBe(1);
  });
});
