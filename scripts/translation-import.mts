/**
 * Reads a translated copy of the numbered wording document back into the
 * platform. Job sheet D9.
 *
 *   npm run translations:import -- zu translations/phrases-all-2026-09-27-zu.docx
 *
 * Each numbered line is put against its phrase by its number. A line whose
 * {1}, {2} do not match the English is refused and that phrase stays in
 * English; the list of what was refused, and why, is printed. The result goes
 * into lib/i18n/translated.json, replacing any earlier translation of the same
 * phrases and keeping the rest.
 *
 * A document that comes back mostly unchanged was probably not translated (the
 * English document read in by mistake), and is refused unless --force.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { en } from "../lib/i18n/en";
import { server } from "../lib/i18n/en-server";
import { isLocale, localeOf } from "../lib/i18n/locales";
import { placeTranslations, readPhraseLines, refLabel, type Translation } from "../lib/i18n/phrase-document";
import { readDocxText } from "../lib/office";

const REFS = join("lib", "i18n", "refs.json");
const TRANSLATED = join("lib", "i18n", "translated.json");

const [code, file] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const force = process.argv.includes("--force");

if (!code || !file || !isLocale(code) || code === "en") {
  console.error("Give the language and the translated file: npm run translations:import -- zu <file.docx>");
  process.exit(1);
}

// The screens' phrases and the messages the server writes (stage 5).
const english = { ...en, ...server } as Record<string, string>;
const refs = JSON.parse(readFileSync(REFS, "utf8")) as Record<string, number>;
const lines = readPhraseLines(readDocxText(new Uint8Array(readFileSync(file))));
if (lines.size === 0) {
  console.error(`${file} has no numbered lines. Is it the translated wording document?`);
  process.exit(1);
}

const result = placeTranslations(lines, refs, english);
const placed = Object.entries(result.translations);
const unchanged = placed.filter(([, entry]) => entry.text === entry.from).length;
if (!force && placed.length > 10 && unchanged / placed.length > 0.5) {
  console.error(
    `${unchanged} of ${placed.length} lines are still in English. This looks like the untranslated document. Nothing was changed. Add --force if it really is ${localeOf(code).english}.`,
  );
  process.exit(1);
}

const store = JSON.parse(readFileSync(TRANSLATED, "utf8")) as Record<string, Record<string, Translation>>;
const merged = { ...(store[code] ?? {}), ...result.translations };
store[code] = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => refs[a] - refs[b]));
writeFileSync(TRANSLATED, `${JSON.stringify(store, null, 2)}\n`);

const missing = Object.keys(english).filter((key) => store[code][key]?.from !== english[key]);
console.log(`${localeOf(code).english}: ${placed.length} phrases placed from ${file}.`);
if (result.refused.length > 0) {
  console.log(`\n${result.refused.length} refused, and left in English:`);
  for (const reason of result.refused) console.log(`  ${reason}`);
}
if (result.unknown.length > 0) {
  console.log(`\n${result.unknown.length} numbers the platform does not have: ${result.unknown.map(refLabel).join(" ")}`);
}
console.log(
  missing.length === 0
    ? `\n${localeOf(code).english} now has every phrase.`
    : `\n${missing.length} phrases still in English. npm run translations:export -- ${code} writes a document of just those.`,
);
