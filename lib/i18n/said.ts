import { af } from "./af";
import { en } from "./en";
import { server } from "./en-server";
import { DEFAULT_LOCALE, isLocale } from "./locales";
import type { Translation } from "./phrase-document";
import translatedData from "./translated.json";

/**
 * Putting a message the server wrote into the reader's language. Job sheet
 * D9, stage 5.
 *
 * lib/ raises its messages in English ("Person not found.", "That case is
 * closed.") and tests check them word for word. So a message is not looked up
 * by a key at the point it is raised: it is recognised by its English at the
 * point it reaches somebody, the way gettext works. `lib/i18n/en-server.ts`
 * holds every one, and scripts/server-phrases.mts keeps it up to date.
 *
 * A message with values in it ("You have used all 3 attempts") is matched
 * against its pattern ("You have used all {maxAttempts} attempts"), and the
 * values are carried into the translation, each put into the reader's
 * language too where it is itself a message. A message built from several
 * ("Not ready to publish. The course has no lessons yet.") is taken a
 * sentence at a time. Anything not recognised is returned exactly as it came,
 * so the worst case is English, never a blank.
 *
 * Imported only on the server: the catalogue is a thousand phrases a browser
 * never needs.
 */

type Pattern = { key: string; regex: RegExp; names: string[]; fixed: number };
type Index = { exact: Map<string, string>; patterns: Pattern[] };

const english: Record<string, string> = { ...(en as Record<string, string>), ...(server as Record<string, string>) };
const translated = translatedData as Record<string, Record<string, Translation>>;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every phrase, by its English, and the ones with values as patterns. */
export function buildIndex(phrases: Record<string, string>): Index {
  const exact = new Map<string, string>();
  const patterns: Pattern[] = [];
  for (const [key, text] of Object.entries(phrases)) {
    if (!/\{\w+\}/.test(text)) {
      if (!exact.has(text)) exact.set(text, key);
      continue;
    }
    // A pattern that is nearly all values would match almost anything.
    if (text.replace(/\{\w+\}/g, "").replace(/[\s.,:;()"“”-]/g, "").length < 4) continue;
    const names: string[] = [];
    const source = text
      .split(/(\{\w+\})/)
      .map((part) => {
        const slot = /^\{(\w+)\}$/.exec(part);
        if (!slot) return escape(part);
        names.push(slot[1]);
        return "([\\s\\S]*?)";
      })
      .join("");
    patterns.push({ key, regex: new RegExp(`^${source}$`), names, fixed: text.replace(/\{\w+\}/g, "").length });
  }
  // The most specific first: more fixed wording, less left to the values.
  patterns.sort((a, b) => b.fixed - a.fixed);
  return { exact, patterns };
}

const INDEX = buildIndex(english);

/** The sentences of a message, keeping their punctuation. */
function sentences(message: string): string[] {
  return message.split(/(?<=[.?!:])\s+(?=["“(A-Z0-9])/);
}

export type Say = (message: string) => string;

/**
 * A function that puts a message into one language, given that language's
 * phrases by key. Exported for testing; `sayer` is what the platform uses.
 */
export function sayWith(index: Index, phrases: Record<string, string>, depth = 0): Say {
  const one = (message: string): string | null => {
    const key = index.exact.get(message);
    if (key) return phrases[key] ?? null;
    for (const pattern of index.patterns) {
      const match = pattern.regex.exec(message);
      if (!match) continue;
      const phrase = phrases[pattern.key];
      if (!phrase) return null;
      const inner = depth < 2 ? sayWith(index, phrases, depth + 1) : (value: string) => value;
      const values = Object.fromEntries(pattern.names.map((name, i) => [name, inner(match[i + 1])]));
      return phrase.replace(/\{(\w+)\}/g, (all, name: string) => (name in values ? values[name] : all));
    }
    return null;
  };

  return (message) => {
    if (!message) return message;
    const whole = one(message);
    if (whole !== null) return whole;
    // A sentence at a time, taking the longest run that is one phrase.
    const parts = sentences(message);
    if (parts.length < 2) return message;
    const out: string[] = [];
    let changed = false;
    for (let start = 0; start < parts.length; ) {
      let done = false;
      for (let end = parts.length; end > start; end--) {
        const run = parts.slice(start, end).join(" ");
        const said = one(run);
        if (said !== null) {
          out.push(said);
          changed = true;
          start = end;
          done = true;
          break;
        }
      }
      if (!done) out.push(parts[start++]);
    }
    return changed ? out.join(" ") : message;
  };
}

/**
 * The fields a person reads, wherever they sit in a result: a string, or a
 * list of strings. Titles, names and anything a person typed live under other
 * names and are never touched.
 */
const MESSAGE_FIELDS = new Set([
  "error", "notice", "done", "message", "warning", "detail", "reason", "why", "what", "because", "note",
  "gap", "problem", "fix", "consequence", "summary", "explanation", "hint", "field",
  "warnings", "notes", "problems", "errors", "reasons", "gaps", "blockedBy",
]);

/** A code ("overdue", "due_soon") rather than wording: never a message. */
const CODE = /^[a-z0-9_:.-]+$/;

function within(value: unknown, say: Say, depth: number): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => within(item, say, depth + 1));
  // Only plain objects: a Response, a Date or a Map goes back as it came.
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (MESSAGE_FIELDS.has(key) && typeof field === "string") out[key] = CODE.test(field) ? field : say(field);
    else if (MESSAGE_FIELDS.has(key) && Array.isArray(field)) {
      out[key] = field.map((item) =>
        typeof item === "string" ? (CODE.test(item) ? item : say(item)) : within(item, say, depth + 1),
      );
    } else out[key] = within(field, say, depth + 1);
  }
  return out;
}

/**
 * A message, or a result with its messages, in one language: a string is put
 * into the language; an object has its message fields put into it, at any
 * depth, and everything else copied as it was.
 */
export function sayWithin<T>(value: T, say: Say): T {
  if (typeof value === "string") return say(value) as T;
  return within(value, say, 0) as T;
}

const SAYERS = new Map<string, Say>();

/** Messages put into one language. English, and a language with no phrases yet, pass straight through. */
export function sayer(locale: string | null | undefined): Say {
  const code = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const cached = SAYERS.get(code);
  if (cached) return cached;

  const phrases: Record<string, string> = {};
  for (const [key, entry] of Object.entries(translated[code] ?? {})) {
    if (english[key] !== undefined && entry.from === english[key]) phrases[key] = entry.text;
  }
  if (code === "af") Object.assign(phrases, af);
  const say: Say = code === DEFAULT_LOCALE || Object.keys(phrases).length === 0 ? (message) => message : sayWith(INDEX, phrases);
  SAYERS.set(code, say);
  return say;
}
