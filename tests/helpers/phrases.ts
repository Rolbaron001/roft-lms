/**
 * A screen's source with its catalogue phrases put back in English.
 *
 * Many tests were written against the English a screen carried in its own
 * code ("expect(page).toMatch(/Qualifications awarded/)"). Job sheet D9, stage
 * 4 moved that English into the language catalogue, and the screen now says
 * `{t("personPage.awarded")}`. Reading the source through this puts the
 * English back where each phrase is asked for, so those tests go on checking
 * what the screen says rather than how it looks it up.
 *
 *   {t("key")} or {t("key", { ... })}   becomes the English itself
 *   t("key")                            becomes "the English"
 *   t("key", { ... })                   becomes t("the English", { ... })
 *
 * A phrase looked up by a key built at run time (maybe(t, `x.${y}`)) is left
 * as it is: there is no one English to put back.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { en } from "@/lib/i18n/en";

const english = en as Record<string, string>;

export function withPhrases(source: string): string {
  return source
    .replace(
      /\{t\(\s*"([\w./-]+)"(?:\s*,\s*\{(?:[^{}]|\{[^{}]*\})*\})?\s*\)\}/g,
      (all, key: string) => (key in english ? english[key] : all),
    )
    .replace(/\bt\(\s*"([\w./-]+)"\s*\)/g, (all, key: string) =>
      key in english ? JSON.stringify(english[key]) : all,
    )
    .replace(/\bt\(\s*"([\w./-]+)"/g, (all, key: string) =>
      key in english ? `t(${JSON.stringify(english[key])}` : all,
    );
}

/** A file under the project, read with its phrases in English. */
export function screenSource(path: string): string {
  return withPhrases(readFileSync(join(process.cwd(), path), "utf8"));
}
