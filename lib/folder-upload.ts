import { extname } from "node:path";

/**
 * A folder as the browser hands it over.
 *
 * The earlier design asked for a path and had the server read it off its own
 * disk. That was wrong twice over. It only works where the platform runs on
 * the same machine as the folder, which is a developer's laptop and not the
 * server; and it made every user's reach the service account's reach, so the
 * folders anybody could name had to be registered in Settings to stop the
 * platform being pointed at its own configuration.
 *
 * A folder picker removes both problems rather than managing them. The browser
 * gives up the files it was shown, the user can only offer what they can
 * already open, and no path on the server is involved at any point - so there
 * is nothing to register and nothing to restrict.
 *
 * `webkitRelativePath` keeps the shape of the folder, which is what the rest of
 * this depends on: `_control/blueprint.json` has to be recognisable as the
 * blueprint, and `05 Theory Guides/121151 SU1 Theory Guide.docx` has to keep
 * enough of itself to be filed under SU1.
 *
 * This module imports nothing beyond a path helper, so a form can use it.
 */

/** Read straight through as text. */
export const READABLE = new Set([".txt", ".md", ".csv", ".json", ".xml", ".html"]);
/** Converted first, with the extractors the platform already has. */
export const CONVERTIBLE = new Set([".pdf", ".docx"]);
/** Stored and indexed but not read for structure. */
export const STORABLE = new Set([".xlsx", ".pptx", ".png", ".jpg", ".jpeg"]);

/**
 * How many files, and how much, before it refuses.
 *
 * Generous against what a real programme folder holds - the client's is 67
 * files and 3.4 MB - and low enough that somebody who picked their Documents
 * folder by mistake is told so rather than waiting on a 4 GB upload.
 */
export const MAX_FILES = 2000;
export const MAX_TOTAL_BYTES = 250 * 1024 * 1024;
/** A single document larger than this is not a curriculum document. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export type UploadedFile = {
  /** Relative to the folder picked, with forward slashes. */
  path: string;
  filename: string;
  bytes: Uint8Array;
  kind: "text" | "convert" | "store" | "skip";
};

export function kindOf(filename: string): UploadedFile["kind"] {
  const extension = extname(filename).toLowerCase();
  if (READABLE.has(extension)) return "text";
  if (CONVERTIBLE.has(extension)) return "convert";
  if (STORABLE.has(extension)) return "store";
  return "skip";
}

/**
 * Strips the folder's own name off the front of every path.
 *
 * A browser reports "121151 HRM Officer/_control/blueprint.json" - the picked
 * folder included. Everything downstream expects paths relative to the folder,
 * so the common first segment comes off. Where files came from more than one
 * top-level folder nothing is stripped, because there is no single root to
 * strip.
 */
export function stripRoot(paths: string[]): (path: string) => string {
  const firstSegments = new Set(
    paths.map((path) => path.split("/")[0]).filter(Boolean),
  );

  if (firstSegments.size !== 1) return (path) => path;

  const root = `${[...firstSegments][0]}/`;
  return (path) => (path.startsWith(root) ? path.slice(root.length) : path);
}

export type ShapedUpload = {
  files: UploadedFile[];
  /** Anything left out, in words, so a short import is never a silent one. */
  warnings: string[];
};

/**
 * What of an upload is worth keeping.
 *
 * Nothing is dropped quietly. A file too large, a folder over the limit, a
 * type with no reader: each is named. An import that came up short without
 * saying so is the one outcome nobody can act on, because the missing workbook
 * looks exactly like a workbook that was never there.
 */
export function shapeUpload(
  incoming: { path: string; bytes: Uint8Array }[],
): ShapedUpload {
  const warnings: string[] = [];
  const strip = stripRoot(incoming.map((file) => file.path));

  const files: UploadedFile[] = [];
  let total = 0;

  for (const file of incoming) {
    const path = strip(file.path.split("\\").join("/"));
    const filename = path.split("/").pop() ?? path;

    // Noise a picked folder carries that is never a document.
    if (
      /(^|\/)(node_modules|\.git|__pycache__)\//.test(path) ||
      filename === ".DS_Store" ||
      filename === "Thumbs.db"
    ) {
      continue;
    }

    if (files.length >= MAX_FILES) {
      warnings.push(
        `More than ${MAX_FILES} files were offered and the rest were left out. Pick the qualification's own folder rather than the drive it sits on.`,
      );
      break;
    }

    if (file.bytes.byteLength > MAX_FILE_BYTES) {
      warnings.push(
        `${path} was left out: larger than ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`,
      );
      continue;
    }

    total += file.bytes.byteLength;
    if (total > MAX_TOTAL_BYTES) {
      warnings.push(
        `The folder is larger than ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)} MB and the rest was left out.`,
      );
      break;
    }

    files.push({ path, filename, bytes: file.bytes, kind: kindOf(filename) });
  }

  return {
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    warnings,
  };
}

/** A file by its path, for the blueprint and the manifest. */
export function fileAt(
  files: UploadedFile[],
  path: string,
): UploadedFile | null {
  const wanted = path.toLowerCase();
  return (
    files.find((file) => file.path.toLowerCase() === wanted) ??
    // A folder picked from inside `_control` would have the prefix stripped.
    files.find((file) => file.path.toLowerCase().endsWith(`/${wanted}`)) ??
    null
  );
}

export function textOf(file: UploadedFile | null): string | null {
  if (!file) return null;
  try {
    return new TextDecoder("utf-8").decode(file.bytes);
  } catch {
    return null;
  }
}
