/**
 * Writes the platform's English wording as a numbered Word document for
 * translating. Job sheet D9.
 *
 *   npm run translations:export             every phrase
 *   npm run translations:export -- zu       only what isiZulu does not yet have
 *
 * The document lands in translations/. Put it through a translator (Google
 * Translate's Document tab takes a .docx and gives one back), then read the
 * result in with `npm run translations:import -- zu <file>`.
 *
 * A phrase added to the platform since the last run is given the next
 * reference number here, in lib/i18n/refs.json. Numbers are never changed or
 * reused, so an older translated document still reads back correctly.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { af } from "../lib/i18n/af";
import { en } from "../lib/i18n/en";
import { LOCALES, isLocale, localeOf } from "../lib/i18n/locales";
import { assignRefs, buildPhraseDocument, type Translation } from "../lib/i18n/phrase-document";

const REFS = join("lib", "i18n", "refs.json");
const TRANSLATED = join("lib", "i18n", "translated.json");

const target = process.argv[2];
if (target && (!isLocale(target) || target === "en")) {
  console.error(`"${target}" is not one of the platform's languages. Use one of: ${LOCALES.filter((l) => l.code !== "en").map((l) => l.code).join(", ")}.`);
  process.exit(1);
}

const before = JSON.parse(readFileSync(REFS, "utf8")) as Record<string, number>;
const refs = assignRefs(before, Object.keys(en));
const added = Object.keys(refs).length - Object.keys(before).length;
if (added > 0) writeFileSync(REFS, `${JSON.stringify(refs, null, 2)}\n`);

const translated = JSON.parse(readFileSync(TRANSLATED, "utf8")) as Record<string, Record<string, Translation>>;
const english = en as Record<string, string>;
const has = (key: string) =>
  translated[target!]?.[key]?.from === english[key] || (target === "af" && key in af);

const keys = Object.keys(english).filter((key) => !target || !has(key));
if (keys.length === 0) {
  console.log(`${localeOf(target).english} already has every phrase. Nothing to translate.`);
  process.exit(0);
}

const date = new Date().toISOString().slice(0, 10);
const title = target
  ? `Platform wording for translation into ${localeOf(target).english}, ${date}`
  : `Platform wording for translation, ${date}`;
const document = buildPhraseDocument(
  keys.map((key) => ({ ref: refs[key], key, english: english[key] })),
  title,
);

mkdirSync("translations", { recursive: true });
const file = join("translations", `phrases-${target ?? "all"}-${date}.docx`);
writeFileSync(file, document);

console.log(`${file}: ${keys.length} phrases.`);
if (added > 0) console.log(`${added} new reference number${added === 1 ? "" : "s"} given in ${REFS}.`);
