import { readdir, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

/**
 * Walking a folder that was pointed at.
 *
 * Separate from the import itself because the rules about what may be read are
 * a security matter and belong somewhere they can be read on their own, and
 * because walking a real programme folder is not the flat listing the first
 * version assumed - the client's folders are `01 Foundation`, `02 Alignment`,
 * `05 Theory Guides` and so on, and everything interesting is one level down.
 */

/** Read straight through as text. */
export const READABLE = new Set([".txt", ".md", ".csv", ".json", ".xml", ".html"]);
/** Converted first, with the extractors the platform already has. */
export const CONVERTIBLE = new Set([".pdf", ".docx"]);
/** Stored and indexed but not read for structure. */
export const STORABLE = new Set([".xlsx", ".pptx", ".png", ".jpg", ".jpeg"]);

/**
 * How deep to go.
 *
 * Six, which is generous: the client's own programme folders use two, and a
 * qualification split into programmes, courses and their material would use
 * four or five. Beyond six somebody has pointed this at a drive rather than a
 * programme, and walking it would take minutes to find nothing.
 */
const MAX_DEPTH = 6;

/**
 * How many files before it stops.
 *
 * Two thousand, and - this is the part that matters - it says so when it stops.
 * The first version cut off silently at five hundred, which would have imported
 * part of a large folder and reported success. A missing workbook nobody was
 * told about is worse than a refusal.
 */
const MAX_FILES = 2000;

export type WalkResult = {
  files: FoundFile[];
  /**
   * Anything the walk could not do, in words.
   *
   * A walk that quietly stopped is the one outcome nobody can act on: a folder
   * would import missing half its material and report success.
   */
  warnings: string[];
};

export type FoundFile = {
  /** Relative to the folder pointed at, with forward slashes. */
  path: string;
  filename: string;
  bytes: number;
  kind: "text" | "convert" | "store" | "skip";
};

/**
 * Whether a folder is one this tenant has said may be read.
 *
 * An allow-list rather than a free path. "Point it at a folder", given to a
 * server process, otherwise means "read any file the service account can
 * reach" - which on the production server includes the platform's own
 * configuration. Compared on the resolved path so a `..` cannot climb out.
 */
export function isAllowedRoot(candidate: string, roots: string[]): boolean {
  if (roots.length === 0) return false;

  const target = resolve(candidate);
  return roots.some((root) => {
    const allowed = resolve(root);
    return target === allowed || target.startsWith(allowed + sep);
  });
}

function kindOf(filename: string): FoundFile["kind"] {
  const extension = extname(filename).toLowerCase();
  if (READABLE.has(extension)) return "text";
  if (CONVERTIBLE.has(extension)) return "convert";
  if (STORABLE.has(extension)) return "store";
  return "skip";
}

/**
 * Everything in the folder and its subfolders.
 *
 * `_control` is walked, because that is where the blueprint and the manifest
 * live and they are the most valuable things in the folder. Its build scripts
 * are not documents and fall out as "skip" on their extension, which is the
 * right way for them to be excluded - by what they are rather than by where
 * they sit.
 */
export async function walkFolder(root: string): Promise<WalkResult> {
  const found: FoundFile[] = [];
  const tooDeep: string[] = [];
  let truncated = false;

  async function descend(directory: string, depth: number): Promise<void> {
    if (found.length >= MAX_FILES) {
      truncated = true;
      return;
    }
    if (depth > MAX_DEPTH) {
      tooDeep.push(relative(root, directory).split(sep).join("/"));
      return;
    }

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (found.length >= MAX_FILES) {
        truncated = true;
        return;
      }

      const full = join(directory, entry.name);

      if (entry.isDirectory()) {
        // Nothing good is in these, and a node_modules would blow the limit
        // before reaching a single document.
        if (
          entry.name === "node_modules" ||
          entry.name === ".git" ||
          entry.name === "__pycache__"
        ) {
          continue;
        }
        await descend(full, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;

      let bytes = 0;
      try {
        bytes = (await stat(full)).size;
      } catch {
        continue;
      }

      found.push({
        path: relative(root, full).split(sep).join("/"),
        filename: entry.name,
        bytes,
        kind: kindOf(entry.name),
      });
    }
  }

  await descend(root, 0);

  const warnings: string[] = [];
  if (truncated) {
    warnings.push(
      `This folder holds more than ${MAX_FILES} files and only the first ${MAX_FILES} were read. Everything below is what was found; the rest was not. Point at a narrower folder, or say so and the limit can be raised.`,
    );
  }
  for (const directory of tooDeep) {
    warnings.push(
      `${directory} is nested more than ${MAX_DEPTH} folders deep and was not read.`,
    );
  }

  return {
    files: found.sort((a, b) => a.path.localeCompare(b.path)),
    warnings,
  };
}
