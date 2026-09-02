import { describe, expect, it } from "vitest";
import {
  DAYS_TO_LODGE,
  HOURS_TO_ACKNOWLEDGE,
  acknowledgementDue,
} from "@/lib/appeals";
import { withinWorkingDays } from "@/lib/working-days";

describe("acknowledgementDue", () => {
  const lodgedAt = new Date("2026-03-10T08:00:00.000Z");

  it("is not due once it has been acknowledged", () => {
    const result = acknowledgementDue({
      lodgedAt,
      acknowledgedAt: new Date("2026-03-10T09:00:00.000Z"),
      now: new Date("2026-03-12T08:00:00.000Z"),
    });
    expect(result.due).toBe(false);
    expect(result.overdueBySeconds).toBe(0);
  });

  it("is due but not yet overdue inside the two hours", () => {
    const result = acknowledgementDue({
      lodgedAt,
      acknowledgedAt: null,
      now: new Date("2026-03-10T09:30:00.000Z"),
    });
    expect(result.due).toBe(true);
    expect(result.overdueBySeconds).toBe(0);
    expect(result.dueAt.toISOString()).toBe("2026-03-10T10:00:00.000Z");
  });

  /**
   * The boundary. An acknowledgement owed at 10:00 is not overdue at 10:00,
   * and is overdue a second later. Written out because "within two hours" is
   * the kind of phrase that becomes an off-by-one in a report somebody is
   * measured on.
   */
  it("is not overdue on the deadline itself", () => {
    expect(
      acknowledgementDue({
        lodgedAt,
        acknowledgedAt: null,
        now: new Date("2026-03-10T10:00:00.000Z"),
      }).overdueBySeconds,
    ).toBe(0);

    expect(
      acknowledgementDue({
        lodgedAt,
        acknowledgedAt: null,
        now: new Date("2026-03-10T10:00:01.000Z"),
      }).overdueBySeconds,
    ).toBe(1);
  });

  it("reports how far past two hours it has run", () => {
    const result = acknowledgementDue({
      lodgedAt,
      acknowledgedAt: null,
      now: new Date("2026-03-10T13:00:00.000Z"),
    });
    expect(result.overdueBySeconds).toBe(3 * 3600);
  });

  it("takes a tenant's own number of hours", () => {
    // A provider whose procedure says four hours is not yet overdue at three.
    const result = acknowledgementDue({
      lodgedAt,
      acknowledgedAt: null,
      now: new Date("2026-03-10T11:00:00.000Z"),
      hours: 4,
    });
    expect(result.overdueBySeconds).toBe(0);
  });
});

describe("the window to lodge", () => {
  /**
   * The rule the working-day arithmetic exists for, stated in the terms the
   * procedure states it: two working days from receiving the result.
   */
  it("gives a learner the same two days whatever day results land", () => {
    // Results on Friday: Monday and Tuesday.
    expect(
      withinWorkingDays({
        from: "2026-03-13",
        done: "2026-03-17",
        count: DAYS_TO_LODGE,
      }).inTime,
    ).toBe(true);

    // Results on Monday: Tuesday and Wednesday.
    expect(
      withinWorkingDays({
        from: "2026-03-09",
        done: "2026-03-11",
        count: DAYS_TO_LODGE,
      }).inTime,
    ).toBe(true);
  });

  it("treats the third working day as late", () => {
    const result = withinWorkingDays({
      from: "2026-03-09",
      done: "2026-03-12",
      count: DAYS_TO_LODGE,
    });
    expect(result.inTime).toBe(false);
    expect(result.lateByWorkingDays).toBe(1);
  });
});

describe("the constants", () => {
  /**
   * Pinned because they come from the client's written procedure rather than
   * from anything the code implies, and because a silent change to either
   * would alter what the platform reports as compliant.
   */
  it("match the procedure", () => {
    expect(DAYS_TO_LODGE).toBe(2);
    expect(HOURS_TO_ACKNOWLEDGE).toBe(2);
  });
});
