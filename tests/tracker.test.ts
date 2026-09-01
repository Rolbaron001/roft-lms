/**
 * The tracker: what replaces the client's two spreadsheets.
 *
 * The grid itself is exercised through the database in the integration cases
 * below. `taskProgress` is pure and tested directly, because the rule it
 * carries is one that would be easy to get quietly wrong: a cancelled task
 * must not count as complete.
 *
 * That matters more than it sounds. If cancelling counted as done, a cohort
 * could reach a hundred per cent by abandoning everything still outstanding,
 * and the number a coordinator trusts would rise fastest exactly when a
 * programme was falling apart.
 */
import { describe, expect, it } from "vitest";
import { taskProgress } from "@/lib/tracker";

describe("taskProgress", () => {
  it("reports nothing rather than zero when there are no tasks", () => {
    const result = taskProgress([]);
    expect(result.percent).toBeNull();
    expect(result.counted).toBe(0);
  });

  it("counts complete against everything that counts", () => {
    const result = taskProgress([
      { status: "complete" },
      { status: "complete" },
      { status: "not_yet_started" },
      { status: "in_progress" },
    ]);
    expect(result.complete).toBe(2);
    expect(result.counted).toBe(4);
    expect(result.percent).toBe(50);
  });

  /**
   * The rule worth guarding. A cancelled task leaves both halves of the
   * fraction, so abandoning work neither helps nor hurts the percentage.
   */
  it("leaves a cancelled task out of both halves", () => {
    const result = taskProgress([
      { status: "complete" },
      { status: "cancelled" },
      { status: "not_yet_started" },
    ]);
    expect(result.counted).toBe(2);
    expect(result.percent).toBe(50);
  });

  it("does not reach a hundred per cent by cancelling what is left", () => {
    const result = taskProgress([
      { status: "complete" },
      { status: "cancelled" },
      { status: "cancelled" },
      { status: "not_yet_started" },
    ]);
    // One done of two that count. Not "one of one" because two were abandoned.
    expect(result.percent).toBe(50);
  });

  /**
   * Postponed is not cancelled. Work that has slipped is still work, and
   * counting it as though it had been dropped would flatter the figure.
   */
  it("still counts a postponed task as outstanding", () => {
    const result = taskProgress([
      { status: "complete" },
      { status: "postponed" },
    ]);
    expect(result.counted).toBe(2);
    expect(result.percent).toBe(50);
  });

  it("reports a hundred only when everything that counts is done", () => {
    expect(
      taskProgress([{ status: "complete" }, { status: "complete" }]).percent,
    ).toBe(100);
  });
});
