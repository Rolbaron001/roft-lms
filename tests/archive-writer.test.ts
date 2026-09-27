/**
 * Writing a cohort archive.
 *
 * What comes out has to open with any ordinary tool and give back exactly the
 * bytes that went in, and the fingerprint taken while writing has to equal the
 * one taken afterwards from the finished file, because that second one is what
 * the provider's browser computes before anything is removed from the server.
 */
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ChunkedFingerprint } from "@/lib/archive-format";
import { MAX_ARCHIVE_BYTES, writeArchive, type ArchiveEntry } from "@/lib/archive-writer";

const sha256 = async (bytes: Uint8Array) =>
  new Uint8Array(createHash("sha256").update(bytes).digest());

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function sample(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

describe("writing an archive", () => {
  const files: Record<string, Uint8Array> = {
    "index.html": new TextEncoder().encode("<!doctype html><p>Cohort</p>"),
    "manifest.json": new TextEncoder().encode(JSON.stringify({ formatVersion: 1 })),
    "Thandi Mokoena/evidence.pdf": sample(3_000_000, 1),
    "Thandi Mokoena/photo.jpg": sample(9_500_000, 2),
    "Sipho Dlamini/logbook.pdf": sample(123_457, 3),
  };

  async function build(readOrder: string[] = []) {
    const pieces: Uint8Array[] = [];
    const entries: ArchiveEntry[] = Object.entries(files).map(([path, bytes]) => ({
      path,
      read: async () => {
        readOrder.push(path);
        return bytes;
      },
    }));
    const result = await writeArchive(entries, async (piece) => {
      pieces.push(piece.slice());
    }, sha256);
    return { archive: concat(pieces), ...result };
  }

  it("opens with an ordinary unzip and gives back every byte", async () => {
    const { archive } = await build();
    const opened = unzipSync(archive);
    expect(Object.keys(opened).sort()).toEqual(Object.keys(files).sort());
    for (const [path, bytes] of Object.entries(files)) {
      expect(createHash("sha256").update(opened[path]).digest("hex"), path).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
    }
  });

  it("fingerprints exactly what it wrote", async () => {
    // The server's figure, taken while writing, against a fresh one taken from
    // the finished file in 8 MiB slices, as the browser will.
    const { archive, fingerprint, bytes } = await build();
    const again = new ChunkedFingerprint(sha256);
    for (let at = 0; at < archive.length; at += 8 * 1024 * 1024) {
      await again.update(archive.subarray(at, at + 8 * 1024 * 1024));
    }
    expect((await again.finish()).fingerprint).toBe(fingerprint);
    expect(bytes).toBe(archive.length);
  });

  it("reads one file at a time, in order", async () => {
    const order: string[] = [];
    await build(order);
    expect(order).toEqual(Object.keys(files));
  });

  it("stops at the first failure to write, rather than carrying on", async () => {
    const entries: ArchiveEntry[] = [
      { path: "a.txt", read: async () => sample(10, 1) },
      { path: "b.txt", read: async () => sample(10, 2) },
    ];
    let calls = 0;
    await expect(
      writeArchive(entries, async () => {
        calls += 1;
        throw new Error("disk full");
      }, sha256),
    ).rejects.toThrow("disk full");
    expect(calls).toBe(1);
  });

  it("stays well under the size the zip format cannot pass", () => {
    // fflate does not write Zip64, so past 4 GB the archive would be damaged.
    expect(MAX_ARCHIVE_BYTES).toBeLessThan(4 * 1024 ** 3);
  });
});
