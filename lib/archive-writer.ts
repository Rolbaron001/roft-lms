import { Zip, ZipPassThrough } from "fflate";
import { ChunkedFingerprint, type Digest } from "./archive-format";

/**
 * Writes a cohort archive as a stream, and fingerprints it as it goes.
 *
 * The server has 929 MB of memory and an archive can pass a gigabyte, so
 * nothing here holds the archive: each file is added, its compressed bytes are
 * handed to the sink and awaited before the next file is read. At any moment
 * the memory in use is one file, at most the 25 MB a single upload may be.
 *
 * Files are stored rather than compressed. Evidence is overwhelmingly
 * photographs and PDFs, already compressed, and deflating them again would
 * spend the one processor this server has for almost nothing back.
 */

/**
 * The most one archive may hold.
 *
 * fflate writes the original zip format, whose offsets are 32-bit, and does not
 * write Zip64: an archive over 4 GB would be damaged in a way nothing reports
 * until somebody tries to open it years later. Held well under, so a cohort
 * that would pass it is archived in two parts rather than one broken one.
 * Checked against fflate's own documentation on 25 September.
 */
export const MAX_ARCHIVE_BYTES = 3.5 * 1024 * 1024 * 1024;

export class ArchiveTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(
      `These learners' files come to ${(bytes / 1024 ** 3).toFixed(1)} GB, over the ${(MAX_ARCHIVE_BYTES / 1024 ** 3).toFixed(1)} GB one archive can hold safely. Archive some of them now and the rest in a second archive.`,
    );
    this.name = "ArchiveTooLargeError";
  }
}

export type ArchiveEntry = {
  path: string;
  /** Read only when the entry is written, so one file is in memory at a time. */
  read: () => Promise<Uint8Array>;
};

/**
 * Streams the entries into a zip, calling `sink` with each piece in order.
 *
 * Returns the fingerprint of exactly the bytes handed to the sink, which is
 * what the provider's browser will compute from the file they saved.
 */
export async function writeArchive(
  entries: Iterable<ArchiveEntry> | AsyncIterable<ArchiveEntry>,
  sink: (piece: Uint8Array) => Promise<void>,
  digest: Digest,
): Promise<{ fingerprint: string; bytes: number }> {
  const fingerprint = new ChunkedFingerprint(digest);

  // fflate calls back synchronously, and the sink and the fingerprint are
  // asynchronous. Every piece is chained onto one promise so they are written
  // and fingerprinted in exactly the order produced, and the first failure
  // stops everything after it.
  let chain: Promise<void> = Promise.resolve();
  let failure: unknown = null;

  const zip = new Zip((error, piece) => {
    if (error) {
      failure = error;
      return;
    }
    chain = chain.then(async () => {
      await fingerprint.update(piece);
      await sink(piece);
    });
    chain.catch((e) => {
      failure = e;
    });
  });

  for await (const entry of entries as AsyncIterable<ArchiveEntry>) {
    const bytes = await entry.read();
    const file = new ZipPassThrough(entry.path);
    zip.add(file);
    file.push(bytes, true);
    // Backpressure: the next file is not read until this one is on disk.
    await chain;
    if (failure) throw failure;
  }

  zip.end();
  await chain;
  if (failure) throw failure;

  return fingerprint.finish();
}
