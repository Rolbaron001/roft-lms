/**
 * "1 decision", not "1 decisions" (Roland, 19 November 2026).
 */
import { describe, expect, it } from "vitest";
import { fillPhrase } from "@/lib/i18n/fill";
import { translator } from "@/lib/i18n";

describe("filling a phrase", () => {
  it("makes the noun after a count of one singular, and its verb agree", () => {
    expect(fillPhrase("{count} modules are in no study unit.", { count: 1 }, true)).toBe("1 module is in no study unit.");
    expect(fillPhrase("{count} modules are in no study unit.", { count: 3 }, true)).toBe("3 modules are in no study unit.");
    expect(fillPhrase("{count} items hold it back.", { count: 1 }, true)).toBe("1 item holds it back.");
    expect(fillPhrase("{modules} modules, {criteria} assessment criteria", { modules: 1, criteria: 1 }, true)).toBe("1 module, 1 assessment criterion");
    expect(fillPhrase("{steps} steps dated, {sessions} class sessions", { steps: 2, sessions: 1 }, true)).toBe("2 steps dated, 1 class session");
    expect(fillPhrase("{count} criteria", { count: "1" }, true)).toBe("1 criterion");
    expect(fillPhrase("{count} activities to do", { count: 1 }, true)).toBe("1 activity to do");
  });

  it("leaves words it does not know, and other languages, as written", () => {
    expect(fillPhrase("{count} classes", { count: 1 }, true)).toBe("1 classes");
    expect(fillPhrase("{count} leerders", { count: 1 }, false)).toBe("1 leerders");
    expect(fillPhrase("{held} of {countable} sessions held", { held: 1, countable: 1 }, true)).toBe("1 of 1 session held");
  });

  it("is what the screens use", () => {
    const t = translator("en");
    expect(t("dash.learners", { count: 1 })).toBe("1 learner");
    expect(t("dash.learners", { count: 2 })).toBe("2 learners");
  });
});
