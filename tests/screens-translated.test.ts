/**
 * Screens moved into the language catalogue carry no English of their own.
 * Job sheet D9, stage 4.
 *
 * Each section is added to MOVED when its screens are moved over; from then
 * on, English written straight into one of them fails here, so a later change
 * cannot quietly put a screen back into English only.
 *
 * What counts as English written in: text between tags, a line of plain words
 * in the markup, and a wording attribute (placeholder, title, description,
 * label, aria-label, alt, what, consequence) given as a literal. What does
 * not: code, class names, addresses, and anything in {braces}.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MOVED = [
  "app/assess",
  "app/learn",
  "app/notifications",
  "app/certificates",
  "app/workplace/page.tsx",
  "app/workplace/[id]",
  "app/moderate",
  "app/reassessments",
  "app/appeals",
  "app/recognition",
  "app/fisa",
  "app/eisa",
  "app/readiness",
  "app/statements",
  "app/papers",
];

/**
 * Screens that stay in the words of the document they reproduce, with why.
 * A regulator's form goes in the regulator's words (CLAUDE.md, "Design/").
 */
const EXEMPT: Record<string, string> = {
  "app/workplace/[id]/statement/page.tsx":
    "The Statement of Work Experience is Section 4D of the QCTO curriculum document, filed with the moderator in the curriculum's own words.",
  "app/statements/[id]/page.tsx":
    "The Statement of Results is the QCTO's template, carried to the assessment centre. Its controls (withdraw, print) are translated; the statement is not.",
  "app/fisa/[id]/agreement/[role]/page.tsx":
    "The FISA confidentiality agreement is the QCTO template's own wording, signed by hand.",
};

function tsxFiles(path: string): string[] {
  const full = join(process.cwd(), path);
  if (statSync(full).isFile()) return [path];
  return readdirSync(full).flatMap((entry) => {
    const child = join(path, entry);
    return statSync(join(process.cwd(), child)).isDirectory()
      ? tsxFiles(child)
      : child.endsWith(".tsx")
        ? [child]
        : [];
  });
}

/** Lines of markup with English in them, ignoring comments. */
export function englishIn(source: string): string[] {
  const found: string[] = [];
  const withoutComments = source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const lines = withoutComments.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // Text between tags on one line: >Some words<
    for (const match of line.matchAll(/>([^<>{}]*[A-Za-z]{2,}[^<>{}]*)</g)) {
      if (/[A-Za-z]{2,}/.test(match[1]) && !/^\s*[-=|&]/.test(match[1])) found.push(trimmed);
    }
    // A line that is nothing but words, as JSX text wrapped over lines.
    if (/^[A-Z][A-Za-z'’,.:;?!()\- ]*[a-z][A-Za-z'’,.:;?!()\- ]*$/.test(trimmed) && trimmed.includes(" ")) {
      found.push(trimmed);
    }
    // A wording attribute given as a literal.
    for (const match of line.matchAll(
      /\b(placeholder|title|description|label|aria-label|alt|what|consequence)="([^"]*[A-Za-z]{2,}[^"]*)"/g,
    )) {
      found.push(`${match[1]}="${match[2]}"`);
    }
  }
  return found;
}

describe("screens moved into the catalogue", () => {
  const exempt = new Set(Object.keys(EXEMPT).map((path) => join(path)));
  for (const path of MOVED.flatMap(tsxFiles).filter((path) => !exempt.has(join(path)))) {
    it(`${path} takes its wording from the catalogue`, () => {
      expect(englishIn(readFileSync(join(process.cwd(), path), "utf8"))).toEqual([]);
    });
  }
});

describe("the check itself", () => {
  it("finds English between tags, on a line of its own, and in a wording attribute", () => {
    expect(englishIn("<p>Save this mark</p>")).toHaveLength(1);
    expect(englishIn("        Nothing is waiting here.\n")).toHaveLength(1);
    expect(englishIn('<input placeholder="Your answer" />')).toHaveLength(1);
  });

  it("leaves code, classes and catalogue lookups alone", () => {
    expect(englishIn('<p className="text-sm font-medium">{t("marking.title")}</p>')).toEqual([]);
    expect(englishIn("  const grouped = items.filter(Boolean);")).toEqual([]);
    expect(englishIn("{/* A comment in the markup. */}")).toEqual([]);
  });
});
