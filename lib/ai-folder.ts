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

/** How deep to go. Deeper than this is somebody's working directory. */
const MAX_DEPTH = 4;
/** More than this in one folder is not a programme, it is a drive. */
const MAX_FILES = 500;

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
export async function walkFolder(root: string): Promise<FoundFile[]> {
  const found: FoundFile[] = [];

  async function descend(directory: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (found.length >= MAX_FILES) return;

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
  return found.sort((a, b) => a.path.localeCompare(b.path));
}
