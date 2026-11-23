/**
 * PowerPoint decks turned into PDFs (job sheet D56).
 *
 * Roland, 19 November 2026: study material that learners read should not
 * depend on their office software. Twelve of SP-260508's fourteen decks would
 * not open in LibreOffice at all, and many learners use LibreOffice, Google
 * Slides or a phone. So a deck is converted to a PDF when it is filed, the PDF
 * is what the page reader shows, and the deck stays as the download.
 *
 * His choice of how (option A): LibreOffice inside the application's image,
 * one deck at a time, in the background. The server has one processor and
 * little memory to spare beside live, development and two databases, so a
 * conversion never runs alongside another, is given a time limit, and its
 * failure never touches the upload it follows.
 *
 * Before converting, the package is checked for the fault described in
 * PPTX-LIBREOFFICE-COMPATIBILITY.md: a script had rewritten three package
 * parts with "ns0:" prefixes, which PowerPoint tolerates and LibreOffice
 * refuses. Those parts are put back into the standard form, everything else
 * left as it was; the original file is never changed.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { programmeDocuments } from "@/db/schema";
import { buildStorageKey, getObject, putObject } from "./storage";
import type { AuthenticatedSession } from "./session";

export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const TIME_LIMIT_MS = 180_000;

export function isDeck(filename: string, mimeType: string | null): boolean {
  return mimeType === PPTX_MIME || /\.pptx$/i.test(filename);
}

/**
 * Package parts whose root element carries a generated prefix ("<ns0:Types
 * xmlns:ns0=...>"), rewritten to the default namespace. Returns the repaired
 * deck and the parts it changed; the same bytes and no parts when there was
 * nothing to repair.
 */
export async function repairDeck(bytes: Uint8Array): Promise<{ bytes: Uint8Array; repaired: string[] }> {
  const zip = await JSZip.loadAsync(bytes);
  const repaired: string[] = [];
  for (const name of Object.keys(zip.files)) {
    if (!/\.(xml|rels)$/i.test(name) || zip.files[name].dir) continue;
    const text = await zip.files[name].async("string");
    const root = /<(ns\d+):[A-Za-z]/.exec(text.slice(0, 600));
    if (!root) continue;
    const prefix = root[1];
    // Only the generated prefix of the root element, as it was written; any
    // other prefix in the part is left alone.
    const fixed = text
      .replaceAll(`xmlns:${prefix}=`, "xmlns=")
      .replaceAll(`<${prefix}:`, "<")
      .replaceAll(`</${prefix}:`, "</");
    zip.file(name, fixed);
    repaired.push(name);
  }
  if (repaired.length === 0) return { bytes, repaired };
  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { bytes: out, repaired };
}

/** How many slides a deck has, from its package. */
export async function slideCount(bytes: Uint8Array): Promise<number> {
  const zip = await JSZip.loadAsync(bytes);
  return Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
}

/** How many pages a PDF has, counted from its page objects. */
export function pdfPageCount(bytes: Uint8Array): number {
  const text = Buffer.from(bytes).toString("latin1");
  return (text.match(/\/Type\s*\/Page(?!s)\b/g) ?? []).length;
}

/** Converts a deck with LibreOffice. Throws with a reason a person can act on. */
export async function convertDeck(bytes: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "deck-"));
  try {
    const input = join(dir, "deck.pptx");
    await writeFile(input, bytes);
    await new Promise<void>((resolve, reject) => {
      execFile(
        "soffice",
        [
          "--headless",
          "--norestore",
          "--nologo",
          // A profile of its own, in the temporary folder: the application
          // runs unprivileged and two conversions never share one.
          `-env:UserInstallation=${pathToFileURL(join(dir, "profile")).href}`,
          "--convert-to",
          "pdf",
          "--outdir",
          dir,
          input,
        ],
        { timeout: TIME_LIMIT_MS, killSignal: "SIGKILL" },
        (error) => {
          if (!error) return resolve();
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") reject(new Error("The converter is not installed on this server."));
          else if (error.killed) reject(new Error("The conversion took longer than three minutes and was stopped."));
          else reject(new Error("The converter could not open the slides."));
        },
      );
    });
    return new Uint8Array(await readFile(join(dir, "deck.pdf")).catch(() => {
      throw new Error("The converter could not open the slides.");
    }));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ------------------------------------------------------------------ the queue

/** One conversion at a time, across the whole application. */
let queue: Promise<void> = Promise.resolve();
const waiting = new Set<string>();

/**
 * Converts one filed deck in the background, after whatever is already
 * waiting. Safe to call more than once for the same document.
 */
export function convertInBackground(session: AuthenticatedSession, documentId: string): void {
  if (waiting.has(documentId)) return;
  waiting.add(documentId);
  queue = queue
    .then(() => convertFiled(session, documentId))
    .catch((error: unknown) => console.error("deck conversion failed", documentId, error))
    .finally(() => waiting.delete(documentId));
}

async function convertFiled(session: AuthenticatedSession, documentId: string): Promise<void> {
  const [row] = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ storageKey: programmeDocuments.storageKey, filename: programmeDocuments.filename, mimeType: programmeDocuments.mimeType, pdf: programmeDocuments.pdfStorageKey })
      .from(programmeDocuments)
      .where(eq(programmeDocuments.id, documentId)),
  );
  if (!row || row.pdf || !isDeck(row.filename, row.mimeType)) return;

  let note: string | null = null;
  let pdfKey: string | null = null;
  try {
    const original = await getObject(row.storageKey);
    const { bytes, repaired } = await repairDeck(original);
    const pdf = await convertDeck(bytes);
    const slides = await slideCount(bytes);
    const pages = pdfPageCount(pdf);
    if (slides > 0 && pages !== slides) {
      throw new Error(`The PDF has ${pages} pages for ${slides} slides.`);
    }
    pdfKey = buildStorageKey(session.organisationId, documentId, `${row.filename.replace(/\.pptx$/i, "")}.pdf`, "programme");
    await putObject(pdfKey, pdf, "application/pdf");
    note = repaired.length > 0
      ? `Converted to a PDF of ${pages} pages. The deck's package had a fault some software cannot open (${repaired.join(", ")}); a repaired copy was converted and the original is unchanged.`
      : `Converted to a PDF of ${pages} pages.`;
  } catch (error) {
    note = `Not converted to a PDF: ${error instanceof Error ? error.message : "the conversion failed."} Learners can still download the slides.`;
  }

  await withTenant(session.organisationId, (tx) =>
    tx.update(programmeDocuments).set({ pdfStorageKey: pdfKey, pdfNote: note }).where(eq(programmeDocuments.id, documentId)),
  );
}

/**
 * Every deck filed against a qualification that has not been converted or
 * tried yet, queued. Called when the qualification's pages are opened, so
 * decks filed before conversion existed are converted too.
 */
export async function convertWaitingDecks(session: AuthenticatedSession, qualificationId: string): Promise<number> {
  const rows = await withTenant(session.organisationId, (tx) =>
    tx
      .select({ id: programmeDocuments.id, filename: programmeDocuments.filename, mimeType: programmeDocuments.mimeType })
      .from(programmeDocuments)
      .where(and(eq(programmeDocuments.qualificationId, qualificationId), isNull(programmeDocuments.pdfStorageKey), isNull(programmeDocuments.pdfNote))),
  );
  const decks = rows.filter((row) => isDeck(row.filename, row.mimeType));
  for (const deck of decks) convertInBackground(session, deck.id);
  return decks.length;
}
