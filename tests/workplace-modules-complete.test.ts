/**
 * A work experience module with no assessment criteria is finished, not empty.
 *
 * It is proved by a logbook a coach signs and an assessor accepts, rather than
 * by criteria. The parser knows this — it does not report a workplace topic
 * for having none — and so does the importer. The qualification screen did
 * not.
 *
 * So a correctly imported QCTO qualification announced that a third of itself
 * was untranscribed. The HRM Officer read perfectly on 17 September and then
 * said "5 of 15 modules have no criteria yet", because five of its fifteen are
 * work experience modules. Somebody importing for the first time reads that as
 * the import having half failed — and this platform has already spent a week
 * on the difference between something being wrong and something looking wrong.
 *
 * Found by opening the screen, not by running the suite. Every count involved
 * was correct; what was wrong was which modules the count included.
 */
import { describe, expect, it } from "vitest";

type Module = {
  code: string;
  component: "knowledge" | "practical" | "workplace" | "general";
  topics: { criteria: unknown[] }[];
  looseCriteria: unknown[];
};

/**
 * The rule the screen applies, kept here so it can be stated once and checked.
 *
 * Deliberately a copy of the expression rather than an import: the screen is a
 * server component that reaches the database, and pulling it into a test would
 * drag Postgres in with it. The comment above the original names this file.
 */
function notCaptured(modules: Module[]): Module[] {
  return modules.filter(
    (m) =>
      m.component !== "workplace" &&
      m.topics.every((topic) => topic.criteria.length === 0) &&
      m.looseCriteria.length === 0,
  );
}

const withCriteria = (code: string, component: Module["component"]): Module => ({
  code,
  component,
  topics: [{ criteria: ["something to achieve"] }],
  looseCriteria: [],
});

const withNone = (code: string, component: Module["component"]): Module => ({
  code,
  component,
  topics: [{ criteria: [] }],
  looseCriteria: [],
});

describe("a qualification read in full", () => {
  /**
   * The shape of the HRM Officer: five knowledge, five practical, five work
   * experience. The work experience modules carry no criteria and the
   * qualification is complete.
   */
  it("reports nothing missing when only the workplace modules are bare", () => {
    const modules = [
      ...["KM01", "KM02", "KM03", "KM04", "KM05"].map((c) =>
        withCriteria(c, "knowledge"),
      ),
      ...["PM01", "PM02", "PM03", "PM04", "PM05"].map((c) =>
        withCriteria(c, "practical"),
      ),
      ...["WM01", "WM02", "WM03", "WM04", "WM05"].map((c) =>
        withNone(c, "workplace"),
      ),
    ];

    expect(notCaptured(modules)).toEqual([]);
  });
});

describe("a qualification genuinely half transcribed", () => {
  /**
   * The warning has to keep working, and this is why it exists: a knowledge
   * module with no criteria cannot be failed, so leaving it empty would make
   * every learner look finished.
   */
  it("still names a knowledge module with nothing to assess against", () => {
    const modules = [
      withCriteria("KM01", "knowledge"),
      withNone("KM02", "knowledge"),
      withNone("WM01", "workplace"),
    ];

    expect(notCaptured(modules).map((one) => one.code)).toEqual(["KM02"]);
  });

  it("still names a practical module with nothing to assess against", () => {
    const modules = [withNone("PM01", "practical"), withNone("WM01", "workplace")];

    expect(notCaptured(modules).map((one) => one.code)).toEqual(["PM01"]);
  });

  /**
   * A tenant outside the occupational qualification system may hang criteria
   * straight off a module rather than off a topic. Those count.
   */
  it("counts criteria that belong to the module rather than a topic", () => {
    const modules: Module[] = [
      {
        code: "KM01",
        component: "knowledge",
        topics: [{ criteria: [] }],
        looseCriteria: ["something to achieve"],
      },
    ];

    expect(notCaptured(modules)).toEqual([]);
  });
});
