/**
 * Tab accepts a field's suggestion (Roland, 12 October 2026): what it fills,
 * and which fields offer one.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { suggestionOf } from "@/components/suggestion-tab";

const field = (placeholder: string, suggest = "") =>
  ({ placeholder, dataset: { suggest } }) as unknown as HTMLInputElement;

describe("what Tab fills", () => {
  it("fills the placeholder itself", () => {
    expect(suggestionOf(field("INV-2026-0041"))).toBe("INV-2026-0041");
  });

  it("takes only what follows e.g.", () => {
    expect(suggestionOf(field("Sitting name, e.g. March 2027"))).toBe("March 2027");
    expect(suggestionOf(field("e.g. Intake 1, 2026"))).toBe("Intake 1, 2026");
  });

  it("reads a bare data-suggest, which React writes as \"true\", as the placeholder", () => {
    expect(suggestionOf(field("INV-2026-0041", "true"))).toBe("INV-2026-0041");
  });

  it("prefers a value given outright", () => {
    expect(suggestionOf(field("anything", "Exact value"))).toBe("Exact value");
  });
});

describe("which fields offer one", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  it("offers the payment reference, as in Roland's example", () => {
    expect(read("app/cohorts/[id]/payment-form.tsx")).toMatch(/placeholder="INV-2026-0041"\s+data-suggest/);
  });

  it("is mounted in the page frame, so every signed-in page has it", () => {
    expect(read("components/app-shell.tsx")).toContain("<SuggestionTab />");
  });

  it("does not offer an instruction as a value", () => {
    // "Reason, if refusing" is a prompt, not something to keep.
    expect(read("app/cohorts/[id]/sessions/[sessionId]/sitting.tsx")).not.toMatch(/reasonIfRefusing[^\n]*data-suggest/);
  });
});
