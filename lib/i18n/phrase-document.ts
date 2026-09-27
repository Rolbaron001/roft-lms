import { strToU8, zipSync } from "fflate";

/**
 * The platform's wording as a numbered document for translating, and the
 * translated document read back. Job sheet D9, Roland's method, 27 September
 * 2026: every English phrase in a Word document under a fixed reference
 * number; the document goes through a translator, a service or a person; each
 * translated line is put back in place by its number.
 *
 * Numbers rather than the platform's own keys, because a translator would
 * translate a key ("learn.markComplete") along with everything else, and a
 * number comes through unchanged. The numbers never change and are never
 * reused (`refs.json`), so a document translated months ago still lands in
 * the right places.
 *
 * A value the platform fills in, such as a count or a name, is written {1},
 * {2} in the document rather than {count}: an English word inside the braces
 * would be translated too, and the platform would no longer find it. A
 * translation that loses one, or invents one, is refused and that phrase stays
 * in English, because a sentence with a hole in it is worse than English.
 *
 * Nothing here reaches the database.
 */

export type PhraseItem = { ref: number; key: string; english: string };

/** A translated phrase and the English it was translated from. */
export type Translation = { text: string; from: string };

/** The reference as printed: "[0042]". */
export function refLabel(ref: number): string {
  return `[${String(ref).padStart(4, "0")}]`;
}

/** "{count} of {total}" to "{1} of {2}", with the names in order. */
export function numberPlaceholders(english: string): { text: string; names: string[] } {
  const names: string[] = [];
  const text = english.replace(/\{(\w+)\}/g, (_all, name: string) => {
    if (!names.includes(name)) names.push(name);
    return `{${names.indexOf(name) + 1}}`;
  });
  return { text, names };
}

/** Back again, in whatever order the translation put them. */
export function namePlaceholders(translated: string, names: string[]): string {
  return translated.replace(/\{\s*(\d+)\s*\}/g, (all, number: string) => names[Number(number) - 1] ? `{${names[Number(number) - 1]}}` : all);
}

/** The part of the platform a phrase belongs to, as a heading for a translator. */
const AREAS: [RegExp, string][] = [
  [/^(shell|nav)\./, "The page frame and menu"],
  [/^term\./, "Names for things"],
  [/^login\./, "Signing in"],
  [/^(account|language)\./, "Your account"],
  [/^learn\./, "A learner's course"],
  [/^(role|status|home)\./, "The home page"],
  [/^(assess|evidence)\./, "Taking an assessment"],
  [/^paper\./, "Sitting a paper"],
  [/^notify\./, "Notifications"],
  [/^cert\./, "A certificate"],
  [/^work\./, "Work experience"],
  [/^scorm\./, "Course packages"],
];

export function areaOf(key: string): string {
  return AREAS.find(([pattern]) => pattern.test(key))?.[1] ?? "Other";
}

const INSTRUCTIONS = [
  "Each line starts with a number in square brackets. Keep the number exactly as it is, at the start of the line, and translate only the text after it.",
  "Keep anything in curly brackets, such as {1} or {2}, exactly as it is, in the right place in the translated sentence. The platform puts a value there, such as a number or a name.",
  "Keep these names as they are: EISA, FISA, QCTO, SAQA.",
  "The headings say where on the platform the lines below them appear. They do not need translating.",
];

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function paragraph(text: string, style?: "heading" | "title" | "muted"): string {
  const size = style === "title" ? 32 : style === "heading" ? 26 : 22;
  const bold = style === "title" || style === "heading" ? "<w:b/>" : "";
  const colour = style === "muted" ? '<w:color w:val="666666"/>' : "";
  const spacing = style === "heading" ? '<w:spacing w:before="240" w:after="80"/>' : '<w:spacing w:after="60"/>';
  return `<w:p><w:pPr>${spacing}</w:pPr><w:r><w:rPr>${bold}${colour}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

/**
 * The Word document. One paragraph per phrase, so a translation service keeps
 * each on its own line, and nothing but plain paragraphs, which every service
 * and every word processor handles the same way.
 */
export function buildPhraseDocument(items: PhraseItem[], title: string): Uint8Array {
  const body: string[] = [paragraph(title, "title")];
  for (const line of INSTRUCTIONS) body.push(paragraph(line, "muted"));

  let area = "";
  for (const item of [...items].sort((a, b) => a.ref - b.ref)) {
    const heading = areaOf(item.key);
    if (heading !== area) {
      body.push(paragraph(heading, "heading"));
      area = heading;
    }
    body.push(paragraph(`${refLabel(item.ref)} ${numberPlaceholders(item.english).text}`));
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  return zipSync({
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    "word/document.xml": strToU8(document),
  });
}

/**
 * The numbered lines of a translated document, by reference. A line without a
 * number (the title, the instructions, the headings, in whatever language
 * they came back) is ignored. "[ 0042 ]" and "【0042】" are read too, since a
 * translation service may space or restyle the brackets.
 */
export function readPhraseLines(text: string): Map<number, string> {
  const lines = new Map<number, string>();
  for (const raw of text.split("\n")) {
    const found = /^\s*[[【［]\s*(\d{1,5})\s*[\]】］]\s*(.*)$/.exec(raw);
    if (found && found[2].trim()) lines.set(Number(found[1]), found[2].trim());
  }
  return lines;
}

export type ImportResult = {
  translations: Record<string, Translation>;
  /** Phrases refused, each with the reason, in the document's order. */
  refused: string[];
  /** References in the document that the platform does not have. */
  unknown: number[];
};

/**
 * Puts each translated line back against its phrase. Checked, per phrase, that
 * the translation carries the same values as the English: the same {1}, {2},
 * no more and no fewer.
 */
export function placeTranslations(
  lines: Map<number, string>,
  refs: Record<string, number>,
  english: Record<string, string>,
): ImportResult {
  const byRef = new Map(Object.entries(refs).map(([key, ref]) => [ref, key]));
  const translations: Record<string, Translation> = {};
  const refused: string[] = [];
  const unknown: number[] = [];

  for (const [ref, translated] of [...lines.entries()].sort((a, b) => a[0] - b[0])) {
    const key = byRef.get(ref);
    if (!key || !(key in english)) {
      unknown.push(ref);
      continue;
    }
    const { names } = numberPlaceholders(english[key]);
    const wanted = names.map((_name, index) => index + 1).join(",");
    const found = [...new Set([...translated.matchAll(/\{\s*(\d+)\s*\}/g)].map((m) => Number(m[1])))]
      .sort((a, b) => a - b)
      .join(",");
    if (found !== wanted) {
      refused.push(
        `${refLabel(ref)} should carry ${wanted ? names.map((_n, i) => `{${i + 1}}`).join(" ") : "no {values}"} and carries ${found ? found.split(",").map((n) => `{${n}}`).join(" ") : "none"}: "${translated}"`,
      );
      continue;
    }
    translations[key] = { text: namePlaceholders(translated, names), from: english[key] };
  }

  return { translations, refused, unknown };
}

/**
 * The next references: every phrase without one gets the next number after
 * the highest ever given. A phrase that has gone keeps its number, unused.
 */
export function assignRefs(refs: Record<string, number>, keys: string[]): Record<string, number> {
  const next = { ...refs };
  let highest = Math.max(0, ...Object.values(refs));
  for (const key of keys) {
    if (next[key] === undefined) next[key] = ++highest;
  }
  return next;
}
