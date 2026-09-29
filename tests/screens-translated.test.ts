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
  "app/people",
  "app/cohorts",
  "app/qualifications",
  "app/courses",
  "app/settings",
  "app/capture",
  "app/imports",
  "app/reports",
  "app/statutory",
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
    .replace(/^\s*\/\/.*$/gm, "")
    // Monospace is code: a command, a module code, a web address. Not wording.
    .replace(/(<span className="font-mono">)[^<]*(<\/span>)/g, "$1$2");
  const lines = withoutComments.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // Text between tags on one line: >Some words<. The arrow of a function
    // type (=> Promise<State>) is not a tag, and a name with an underscore in
    // it (a folder called _control) is not wording.
    for (const match of line.matchAll(/(?<!=)>([^<>{}]*[A-Za-z]{2,}[^<>{}]*)</g)) {
      const text = match[1];
      if (/^\s*\w*_\w*\s*$/.test(text)) continue;
      // The name of a slot in a sentence: parts={{ total: <b/>, modules: <b/> }}.
      if (/^[\s,]*\w+:\s*$/.test(text)) continue;
      if (/[A-Za-z]{2,}/.test(text) && !/^\s*[-=|&]/.test(text)) found.push(trimmed);
    }
    // A line that is nothing but words, as JSX text wrapped over lines.
    if (/^[A-Z][A-Za-z'’,.:;?!()\- ]*[a-z][A-Za-z'’,.:;?!()\- ]*$/.test(trimmed) && trimmed.includes(" ")) {
      found.push(trimmed);
    }
    // A wording attribute given as a literal: words with a space between them,
    // or one capitalised word. An example value (an invoice number, a web
    // address, "18:30") is not wording and is left alone.
    for (const match of line.matchAll(
      /\b(placeholder|title|description|label|aria-label|alt|what|consequence)="([^"]*[A-Za-z]{2,}[^"]*)"/g,
    )) {
      const value = match[2];
      if (/[A-Za-z]{2,}\s+[A-Za-z]/.test(value) || /^[A-Z][a-z]{2,}$/.test(value)) {
        found.push(`${match[1]}="${value}"`);
      }
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

describe("reading a moved screen's English back for older tests", () => {
  it("puts each phrase's English where the screen asks for it", async () => {
    const { withPhrases } = await import("./helpers/phrases");
    expect(withPhrases('<h1>{t("appeals.title")}</h1>')).toBe("<h1>Appeals</h1>");
    expect(withPhrases('<p>{t("appeals.late", { count: overdue.length })}</p>')).toBe(
      "<p>{count} not acknowledged in time</p>",
    );
    expect(withPhrases('placeholder={t("people.search")}')).toBe("placeholder=Search by name or email");
    expect(withPhrases('const label = t("people.search");')).toBe('const label = "Search by name or email";');
    expect(withPhrases('t("people.intro", { provider })')).toBe(
      't("Everyone in {provider}, their roles, and whether their record carries what a statutory return needs.", { provider })',
    );
    expect(withPhrases('{maybe(t, `x.${y}`)}')).toBe("{maybe(t, `x.${y}`)}");
  });
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
    expect(englishIn('<input placeholder="INV-2026-0041" />')).toEqual([]);
    expect(englishIn('<input placeholder="https://…" />')).toEqual([]);
    expect(englishIn('<input placeholder="Recommendation" />')).toHaveLength(1);
  });
});
