import { describe, expect, it } from "vitest";
import {
  ASSIST_THRESHOLD,
  questionCount,
  shouldAssist,
} from "@/lib/capture-assist";
import type { ParsedPaper } from "@/lib/capture-parse";

function paper(counts: number[]): ParsedPaper {
  return {
    title: "A paper",
    declaredCriteria: [],
    problems: [],
    notes: [],
    sections: counts.map((count, index) => ({
      title: `Section ${index + 1}`,
      instruction: null,
      markTotal: null,
      items: Array.from({ length: count }, (_, position) => ({
        number: `${index + 1}.${position + 1}`,
        type: "short_answer" as const,
        stem: "A question",
        options: [],
        correctIndex: null,
        points: null,
        criterionCodes: [],
        markingGuide: null,
        markedBy: "assessor" as const,
      })),
    })),
  };
}

describe("questionCount", () => {
  it("counts across every section", () => {
    expect(questionCount(paper([3, 4, 2]))).toBe(9);
    expect(questionCount(paper([]))).toBe(0);
  });
});

describe("shouldAssist", () => {
  /**
   * The point of the threshold. A paper the house-style parser read twenty
   * questions out of is a paper it understood, and asking a model to read it
   * again would replace a deterministic reading with a probabilistic one for
   * nothing.
   */
  it("does not ask a model about a paper the parser read", () => {
    expect(shouldAssist(paper([20]))).toBe(false);
    expect(shouldAssist(paper([5, 5]))).toBe(false);
  });

  it("asks about a paper the parser found nothing in", () => {
    expect(shouldAssist(paper([]))).toBe(true);
    expect(shouldAssist(paper([0, 0]))).toBe(true);
  });

  it("asks where the parser found a single stray question", () => {
    // One question out of a whole paper is a false positive, not a reading.
    expect(shouldAssist(paper([1]))).toBe(true);
  });

  it("stops asking at the threshold", () => {
    expect(ASSIST_THRESHOLD).toBe(1);
    expect(shouldAssist(paper([ASSIST_THRESHOLD + 1]))).toBe(false);
  });
});
