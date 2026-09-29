/**
 * Collects the sentences the server writes, for translating. Job sheet D9,
 * stage 5.
 *
 *   npm run translations:server           rewrites lib/i18n/en-server.ts
 *
 * (scripts/translations-server.mts runs it; this module is what the test reads.)
 *
 * Screens look their wording up by key. The server's messages are different:
 * about a thousand of them are raised deep in lib/ as English ("Person not
 * found.", "That case is closed."), and tests check many of them word for
 * word. So for these the English sentence is itself the key, the convention
 * gettext uses. This script finds every one, and `lib/i18n/said.ts` puts one
 * into the reader's language at the point it reaches them.
 *
 * `${...}` inside a message becomes a named `{slot}`. A choice between two
 * pieces of wording (`${n === 1 ? "day" : "days"}`) becomes one phrase for
 * each, so a translator sees whole sentences rather than a sentence with a
 * hole where English goes.
 *
 * tests/server-phrases.test.ts fails when the catalogue is behind the code.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { en } from "../lib/i18n/en";

export const OUTPUT = join("lib", "i18n", "en-server.ts");

/**
 * Files whose wording stays English, and why. Everything else in lib/, and
 * every server action and route handler, is read.
 */
export const KEPT_ENGLISH: Record<string, string> = {
  "lib/document-fields.ts": "The layouts of issued documents and their sample values: a document is produced in English.",
  "lib/fisa-checklist.ts": "The QCTO's own checklist wording, reproduced as the regulator's instrument.",
  "lib/learner-codes.ts": "The labels of the QCTO's published code lists, which are official values.",
  "lib/public-holidays.ts": "The official names of public holidays.",
  "lib/rbac.ts": "An internal error, never shown as it stands.",
  "lib/secret-box.ts": "A message for whoever runs the server.",
  "lib/dictionary.ts": "The dictionary's entries are content, and its errors are for whoever edits the file.",
  "lib/navigation.ts": "The menu's labels are translated by their nav.* keys.",
  "lib/naming-convention.ts": "A filename pattern, not wording.",
};

/**
 * Single strings that read as wording but are not: an instruction to an AI
 * model, a list of its tools, a name built for a record.
 */
const NOT_WORDING = [
  /JSON object|Reply with that JSON|Write your answer to a file/,
  /^\{programmeName\} Cohort /,
];

/**
 * Files where only messages count: what is raised as an error or returned as
 * one. The rest of their English is something else: headings a parser looks
 * for, instructions to an AI model, the columns of a regulator's file, the
 * wording of an archive or an export.
 */
export const MESSAGES_ONLY = new Set([
  "lib/curriculum-parse.ts",
  "lib/qualification-document-parse.ts",
  "lib/alignment-document.ts",
  "lib/alignment-matrix.ts",
  "lib/capture-parse.ts",
  "lib/capture-assist.ts",
  "lib/extensions/index.ts",
  "lib/extensions/claude-code.ts",
  "lib/extensions/gemini.ts",
  "lib/extensions/openai.ts",
  "lib/provisioning.ts",
  "lib/statutory.ts",
  "lib/qcto-recipients.ts",
  "lib/xapi.ts",
  "lib/cohort-archive.ts",
  "lib/archive-writer.ts",
  "lib/moderation-pack.ts",
  "lib/blueprint-export.ts",
  "lib/declaration.ts",
  "lib/dictionary.ts",
]);

/** Properties whose value is something a person reads. */
const MESSAGE_PROPERTIES = new Set([
  "error",
  "notice",
  "done",
  "message",
  "warning",
  "reason",
  "detail",
  "note",
  "problem",
  "what",
  "why",
  "summary",
  "title",
  "body",
  "label",
  "description",
  "hint",
  "explanation",
  "state",
  "action",
  "status",
  "text",
  "subject",
  "gap",
  "fix",
  "consequence",
]);

/** Methods whose string argument is a message, as zod's are. */
const MESSAGE_METHODS = new Set(["min", "max", "length", "email", "url", "regex", "refine", "nonempty", "int", "positive", "nonnegative", "uuid", "datetime", "date", "startsWith", "endsWith"]);

/** Calls whose string arguments are never wording. */
const NOT_WORDING_CALLS = new Set([
  "join", "split", "replace", "replaceAll", "startsWith", "endsWith", "includes", "indexOf", "match", "matchAll",
  "test", "get", "getAll", "set", "has", "append", "delete", "revalidatePath", "redirect", "query", "execute",
  "select", "where", "from", "log", "warn", "error", "info", "debug", "assertSessionCan", "requirePermission",
  "requireCapability", "requireAnyPermission", "hasPermission", "can", "localeCompare", "padStart", "padEnd",
  "toLocaleDateString", "toLocaleString", "toLocaleTimeString", "Intl", "DateTimeFormat", "NumberFormat",
  "RegExp", "Date", "parse", "createHash", "update", "digest", "fetch", "header", "headers", "cookies",
  "readFileSync", "writeFileSync", "join", "resolve", "encodeURIComponent", "decodeURIComponent", "slug", "sql",
]);

export type Phrase = { key: string; english: string; file: string };

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== "node_modules" && name !== ".next" && name !== "i18n") walk(full);
      } else if (/\.ts$/.test(name) && !/\.d\.ts$/.test(name)) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

function isServerAppFile(path: string): boolean {
  return /(^|\/)(actions|[\w-]+-actions|route)\.ts$/.test(path);
}

/** The files read, as forward-slashed paths from the project root. */
export function filesToRead(root = "."): string[] {
  const lib = sourceFiles(join(root, "lib"));
  const app = sourceFiles(join(root, "app")).filter((path) => isServerAppFile(relative(root, path).split(sep).join("/")));
  return [...lib, ...app]
    .map((path) => relative(root, path).split(sep).join("/"))
    .filter((path) => !(path in KEPT_ENGLISH))
    .sort();
}

/** A name for the value in a slot, from the code that fills it. */
function slotName(expression: ts.Expression): string {
  const skip = new Set(["length", "join", "map", "toLowerCase", "toUpperCase", "trim", "toFixed", "toString", "slice", "toISOString", "toLocaleString", "toLocaleDateString", "filter", "replace", "String", "Math", "round", "floor", "ceil", "size", "current", "value"]);
  const names: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) names.push(node.text);
    node.forEachChild(visit);
  };
  visit(expression);
  const useful = names.filter((name) => !skip.has(name));
  const lengthOf = /\.length\b/.test(expression.getText()) && useful.length > 0;
  const base = useful.length > 0 ? useful[useful.length - 1] : "value";
  return lengthOf && !/count|number|total/i.test(base) ? `${base}Count` : base;
}

type Piece = { text: string } | { slot: ts.Expression } | { choice: Piece[][] };

/** The pieces of a string expression: fixed text, values, and choices of wording. */
function piecesOf(node: ts.Expression): Piece[] | null {
  if (ts.isParenthesizedExpression(node)) return piecesOf(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [{ text: node.text }];
  if (ts.isTemplateExpression(node)) {
    const pieces: Piece[] = [{ text: node.head.text }];
    for (const span of node.templateSpans) {
      pieces.push(...inner(span.expression));
      pieces.push({ text: span.literal.text });
    }
    return pieces;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = piecesOf(node.left) ?? [{ slot: node.left }];
    const right = piecesOf(node.right) ?? [{ slot: node.right }];
    if (!left.some((p) => "text" in p) && !right.some((p) => "text" in p)) return null;
    return [...left, ...right];
  }
  return null;
}

/** What goes inside `${...}`: a choice between two wordings, or a value. */
function inner(expression: ts.Expression): Piece[] {
  const bare = ts.isParenthesizedExpression(expression) ? expression.expression : expression;
  if (ts.isConditionalExpression(bare)) {
    const whenTrue = piecesOf(bare.whenTrue);
    const whenFalse = piecesOf(bare.whenFalse);
    if (whenTrue && whenFalse) return [{ choice: [whenTrue, whenFalse] }];
  }
  return [{ slot: expression }];
}

/** Every wording a list of pieces can produce, at most `limit` of them. */
function expand(pieces: Piece[], limit = 8): Piece[][] {
  let results: Piece[][] = [[]];
  for (const piece of pieces) {
    if ("choice" in piece) {
      const next: Piece[][] = [];
      for (const sofar of results) for (const option of piece.choice) for (const tail of expand(option, limit)) next.push([...sofar, ...tail]);
      if (next.length > limit) return [];
      results = next;
    } else {
      results = results.map((sofar) => [...sofar, piece]);
    }
  }
  return results;
}

function render(pieces: Piece[]): string {
  const used = new Map<string, number>();
  let out = "";
  for (const piece of pieces) {
    if ("text" in piece) out += piece.text.replace(/\{/g, "(").replace(/\}/g, ")");
    else if ("slot" in piece) {
      const base = slotName(piece.slot);
      const count = (used.get(base) ?? 0) + 1;
      used.set(base, count);
      out += `{${count === 1 ? base : `${base}${count}`}}`;
    }
  }
  return out;
}

/** Reads as wording: words, not an identifier, a path, an address or code. */
function isWording(english: string, positional: boolean): boolean {
  if (NOT_WORDING.some((pattern) => pattern.test(english))) return false;
  const text = english.replace(/\{\w+\}/g, "").trim();
  if (!/[A-Za-z]{2,}/.test(text)) return false;
  // One token: a word ("Saved.", "Uploads"), not a list or a name with dots.
  if (!/\s/.test(text) && !/^[A-Za-z'’-]+[.!?]?$/.test(text)) return false;
  // A filename.
  if (/\.(csv|xlsx|docx|pdf|zip|json|txt)$/i.test(text)) return false;
  if (/^(https?:|\/|\.|#|[a-z]+:[a-z])/.test(text)) return false;
  if (/\{\{|=>|<\/?[a-z]|;$|^\w+(\.\w+)+$|^[a-z]+(_[a-z]+)+$|^[a-z]+([A-Z][a-z]+)+$/.test(text)) return false;
  if (!/^[\s{]*(\{\w+\}\s*)?[A-Z"“'(]/.test(english.trim())) return false;
  const words = text.split(/\s+/).filter((word) => /[A-Za-z]/.test(word));
  if (positional) return words.length >= 1 && /[a-z]/.test(text);
  return words.length >= 3 && /\b[a-z]{3,}\b/.test(text);
}

/** Where a string sits decides whether it is a message. */
function position(node: ts.Node): "message" | "wording" | "never" {
  let child: ts.Node = node;
  let parent = node.parent;
  // Up through the expression the string is part of.
  while (
    parent &&
    (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.PlusToken ||
      ts.isParenthesizedExpression(parent) ||
      ts.isConditionalExpression(parent) && parent.condition !== child ||
      ts.isBinaryExpression(parent) && (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || parent.operatorToken.kind === ts.SyntaxKind.BarBarToken) ||
      ts.isTemplateSpan(parent) ||
      ts.isTemplateExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent))
  ) {
    child = parent;
    parent = parent.parent;
  }
  if (!parent) return "wording";
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isLiteralTypeNode(parent) || ts.isExternalModuleReference(parent)) return "never";
  if (ts.isCaseClause(parent) || ts.isElementAccessExpression(parent) || ts.isTaggedTemplateExpression(parent)) return "never";
  if (ts.isBinaryExpression(parent)) {
    const kind = parent.operatorToken.kind;
    if (kind === ts.SyntaxKind.EqualsEqualsEqualsToken || kind === ts.SyntaxKind.ExclamationEqualsEqualsToken || kind === ts.SyntaxKind.EqualsEqualsToken || kind === ts.SyntaxKind.ExclamationEqualsToken || kind === ts.SyntaxKind.InKeyword) return "never";
  }
  if (ts.isPropertyAssignment(parent)) {
    if (parent.name === child) return "never";
    const name = parent.name.getText().replace(/["']/g, "");
    return MESSAGE_PROPERTIES.has(name) ? "message" : "wording";
  }
  if (ts.isNewExpression(parent)) {
    const callee = parent.expression.getText();
    if (/Error$/.test(callee)) return "message";
    if (/^(RegExp|Date|URL|Response|Headers|Map|Set)$/.test(callee)) return "never";
  }
  if (ts.isCallExpression(parent)) {
    const callee = parent.expression;
    const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
    const target = ts.isPropertyAccessExpression(callee) ? callee.expression.getText() : "";
    if (target === "console" || target === "JSON" || target === "Object" || target === "path") return "never";
    if (MESSAGE_METHODS.has(name) && ts.isPropertyAccessExpression(callee)) return "message";
    if (name === "said" || name === "say") return "message";
    if (NOT_WORDING_CALLS.has(name)) return "never";
    if (name === "push" || name === "unshift") return "message";
  }
  if (ts.isThrowStatement(parent) || ts.isReturnStatement(parent)) return "message";
  if (ts.isArrayLiteralExpression(parent)) {
    let holder: ts.Node = parent.parent;
    while (holder && (ts.isAsExpression(holder) || ts.isSatisfiesExpression(holder) || ts.isParenthesizedExpression(holder))) holder = holder.parent;
    if (holder && ts.isPropertyAssignment(holder)) {
      const name = holder.name.getText().replace(/["']/g, "");
      if (MESSAGE_PROPERTIES.has(name)) return "message";
    }
  }
  return "wording";
}

/** The top of the expression a string is part of, so "a " + b + " c" is read once. */
function topOf(node: ts.Node): ts.Expression {
  let top = node as ts.Expression;
  let parent = node.parent;
  while (
    parent &&
    (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.PlusToken ||
      ts.isParenthesizedExpression(parent) && ts.isBinaryExpression(parent.parent) && parent.parent.operatorToken.kind === ts.SyntaxKind.PlusToken)
  ) {
    top = parent as ts.Expression;
    parent = parent.parent;
  }
  return top;
}

export function keyFor(file: string, english: string): string {
  const area = file.replace(/^(lib|app)\//, "").replace(/\.ts$/, "").replace(/\/(actions|route)$/, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `said.${area}.${createHash("sha1").update(english).digest("hex").slice(0, 8)}`;
}

/** Every message in one file. */
export function phrasesIn(file: string, source: string): Phrase[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const messagesOnly = MESSAGES_ONLY.has(file);
  const seen = new Set<ts.Node>();
  const found: Phrase[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      // A string inside a ${...} is read with the template around it.
      const insideTemplate = (() => {
        for (let up = node.parent; up; up = up.parent) if (ts.isTemplateSpan(up)) return true;
        return false;
      })();
      const top = topOf(node);
      if (!seen.has(top) && !insideTemplate) {
        seen.add(top);
        const where = position(top);
        if (where !== "never" && !(messagesOnly && where !== "message")) {
          const pieces = piecesOf(top);
          if (pieces) {
            for (const option of expand(pieces)) {
              const english = render(option).replace(/\s+/g, " ").trim();
              if (english && isWording(english, where === "message")) found.push({ key: keyFor(file, english), english, file });
            }
          }
        }
      }
    }
    if (ts.isTemplateExpression(node)) {
      // Strings in a template's values that are not choices of wording, such
      // as a fallback, are messages in their own right.
      for (const span of node.templateSpans) span.expression.forEachChild(visit);
      return;
    }
    node.forEachChild(visit);
  };
  visit(tree);
  return found;
}

/**
 * Every message the server writes, one per distinct English sentence. A
 * sentence a screen already has in the catalogue is left out: the lookup finds
 * it there, so a translator meets it once.
 */
export function collect(root = ".", screens: Record<string, string> = en): Phrase[] {
  const already = new Set(Object.values(screens));
  const byEnglish = new Map<string, Phrase>();
  for (const file of filesToRead(root)) {
    for (const phrase of phrasesIn(file, readFileSync(join(root, file), "utf8"))) {
      if (!byEnglish.has(phrase.english) && !already.has(phrase.english)) byEnglish.set(phrase.english, phrase);
    }
  }
  return [...byEnglish.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function renderCatalogue(phrases: Phrase[]): string {
  const lines = [
    "/**",
    " * The sentences the server writes, in English. Job sheet D9, stage 5.",
    " *",
    " * Generated by `npm run translations:server` from lib/ and the server",
    " * actions: do not edit by hand. The English is the key here (see",
    " * scripts/server-phrases.mts), so changing a message in the code and",
    " * running the script is all a change takes.",
    " *",
    " * Imported only on the server: this is a thousand phrases a browser never",
    " * needs.",
    " */",
    "export const server = {",
    ...phrases.map((phrase) => `  ${JSON.stringify(phrase.key)}: ${JSON.stringify(phrase.english)},`),
    "} as const;",
    "",
  ];
  return lines.join("\n");
}
