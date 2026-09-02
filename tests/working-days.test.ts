import { describe, expect, it } from "vitest";
import {
  addWorkingDays,
  isWeekend,
  isWorkingDay,
  withinWorkingDays,
  workingDaysBetween,
} from "@/lib/working-days";

// 2026-03-09 is a Monday, 2026-03-13 a Friday, 2026-03-14 a Saturday.

describe("isWeekend", () => {
  it("knows the weekend", () => {
    expect(isWeekend("2026-03-13")).toBe(false);
    expect(isWeekend("2026-03-14")).toBe(true);
    expect(isWeekend("2026-03-15")).toBe(true);
    expect(isWeekend("2026-03-16")).toBe(false);
  });
});

describe("isWorkingDay", () => {
  it("excludes a holiday that is passed in", () => {
    expect(isWorkingDay("2026-03-16")).toBe(true);
    expect(isWorkingDay("2026-03-16", ["2026-03-16"])).toBe(false);
  });
});

describe("addWorkingDays", () => {
  /**
   * The case the whole module exists for. A result handed back on a Friday and
   * one handed back on a Monday must give the learner the same two days.
   */
  it("carries a deadline over the weekend", () => {
    // Friday plus two working days is Tuesday, not Sunday.
    expect(addWorkingDays("2026-03-13", 2)).toBe("2026-03-17");
    // Monday plus two is Wednesday.
    expect(addWorkingDays("2026-03-09", 2)).toBe("2026-03-11");
  });

  it("does not count the starting day", () => {
    expect(addWorkingDays("2026-03-09", 1)).toBe("2026-03-10");
  });

  it("starts counting from the next working day when it begins on a weekend", () => {
    // Saturday plus one working day is Monday.
    expect(addWorkingDays("2026-03-14", 1)).toBe("2026-03-16");
  });

  it("skips a public holiday it is told about", () => {
    // Human Rights Day observed on Monday 2026-03-16 would push this on a day.
    expect(addWorkingDays("2026-03-13", 2, ["2026-03-16"])).toBe("2026-03-18");
  });

  it("returns the same day for a count of zero or less", () => {
    expect(addWorkingDays("2026-03-13", 0)).toBe("2026-03-13");
    expect(addWorkingDays("2026-03-13", -3)).toBe("2026-03-13");
  });

  it("handles a span longer than a month", () => {
    // Ten working days from a Monday is a fortnight later, same weekday.
    expect(addWorkingDays("2026-03-09", 10)).toBe("2026-03-23");
  });
});

describe("workingDaysBetween", () => {
  it("counts across a weekend", () => {
    expect(workingDaysBetween("2026-03-13", "2026-03-17")).toBe(2);
    expect(workingDaysBetween("2026-03-09", "2026-03-13")).toBe(4);
  });

  it("is zero for the same day", () => {
    expect(workingDaysBetween("2026-03-13", "2026-03-13")).toBe(0);
  });

  it("is zero across a weekend with no working day between", () => {
    expect(workingDaysBetween("2026-03-14", "2026-03-15")).toBe(0);
  });

  it("goes negative backwards", () => {
    expect(workingDaysBetween("2026-03-17", "2026-03-13")).toBe(-2);
  });
});

describe("withinWorkingDays", () => {
  /**
   * "Students should submit an appeal within two working days after receiving
   * results." Results on a Friday, appeal on the Tuesday: in time.
   */
  it("accepts an appeal lodged on the deadline", () => {
    const result = withinWorkingDays({
      from: "2026-03-13",
      done: "2026-03-17",
      count: 2,
    });
    expect(result.deadline).toBe("2026-03-17");
    expect(result.inTime).toBe(true);
    expect(result.lateByWorkingDays).toBe(0);
  });

  it("counts the weekend as no time at all", () => {
    // Saturday and Sunday are not late; the deadline has not arrived.
    const result = withinWorkingDays({
      from: "2026-03-13",
      done: "2026-03-15",
      count: 2,
    });
    expect(result.inTime).toBe(true);
  });

  it("reports how late a missed deadline is, in working days", () => {
    const result = withinWorkingDays({
      from: "2026-03-13",
      done: "2026-03-19",
      count: 2,
    });
    expect(result.deadline).toBe("2026-03-17");
    expect(result.inTime).toBe(false);
    expect(result.lateByWorkingDays).toBe(2);
  });

  it("does not make a deadline later because of a weekend in the lateness", () => {
    // Deadline Tuesday, lodged the following Monday: four working days late,
    // not six calendar days.
    const result = withinWorkingDays({
      from: "2026-03-13",
      done: "2026-03-23",
      count: 2,
    });
    expect(result.lateByWorkingDays).toBe(4);
  });
});
