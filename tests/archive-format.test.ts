/**
 * The cohort archive's format and fingerprint.
 *
 * Job sheet 4.3. The server takes the fingerprint while it writes the archive,
 * in whatever pieces the zip writer produces; the provider's browser takes it
 * again from the saved file, in 8 MiB slices. No file is removed from the
 * server unless the two agree, so agreeing regardless of how the bytes were cut
 * is the property everything else rests on.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CHUNK_BYTES,
  ChunkedFingerprint,
  escapeHtml,
  renderArchiveIndex,
  renderLearnerIndex,
  safeName,
  toHex,
  uniquePath,
  type ArchiveManifest,
} from "@/lib/archive-format";

const sha256 = async (bytes: Uint8Array) =>
  new Uint8Array(createHash("sha256").update(bytes).digest());

/** The fingerprint worked out independently, the long way round. */
function expected(bytes: Uint8Array): string {
  const digests: Buffer[] = [];
  for (let at = 0; at < bytes.length; at += CHUNK_BYTES) {
    digests.push(createHash("sha256").update(bytes.subarray(at, at + CHUNK_BYTES)).digest());
  }
  return `v1:${createHash("sha256").update(Buffer.concat(digests)).digest("hex")}`;
}

function bytes(length: number, seed = 7): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed;
  for (let i = 0; i < length; i += 1) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x & 0xff;
  }
  return out;
}

async function fingerprintInPieces(data: Uint8Array, sizes: number[]) {
  const f = new ChunkedFingerprint(sha256);
  let at = 0;
  let i = 0;
  while (at < data.length) {
    const size = sizes[i % sizes.length];
    await f.update(data.subarray(at, at + size));
    at += size;
    i += 1;
  }
  return f.finish();
}

describe("the fingerprint", () => {
  // Two full chunks and part of a third, so every boundary case is crossed.
  const data = bytes(2 * CHUNK_BYTES + 12345);

  it("matches the scheme worked out independently", async () => {
    const result = await fingerprintInPieces(data, [data.length]);
    expect(result.fingerprint).toBe(expected(data));
    expect(result.bytes).toBe(data.length);
  });

  it("does not depend on how the bytes were cut", async () => {
    // The server's pieces come from a zip writer; the browser's are 8 MiB
    // slices. Neither lines up with the other, and both must agree.
    const whole = (await fingerprintInPieces(data, [data.length])).fingerprint;
    const odd = (await fingerprintInPieces(data, [1, 65536, 3_000_001, 17])).fingerprint;
    const slices = (await fingerprintInPieces(data, [CHUNK_BYTES])).fingerprint;
    expect(odd).toBe(whole);
    expect(slices).toBe(whole);
  });

  it("changes when a single byte does", async () => {
    const altered = data.slice();
    altered[CHUNK_BYTES + 5] ^= 1;
    const a = (await fingerprintInPieces(data, [data.length])).fingerprint;
    const b = (await fingerprintInPieces(altered, [data.length])).fingerprint;
    expect(a).not.toBe(b);
  });

  it("changes when the file is cut short", async () => {
    const a = (await fingerprintInPieces(data, [data.length])).fingerprint;
    const b = (await fingerprintInPieces(data.subarray(0, data.length - 1), [data.length])).fingerprint;
    expect(a).not.toBe(b);
  });

  it("names its scheme, so a later one cannot be confused with it", async () => {
    const result = await fingerprintInPieces(bytes(10), [10]);
    expect(result.fingerprint).toMatch(/^v1:[0-9a-f]{64}$/);
  });

  it("writes hex the same way everywhere", () => {
    expect(toHex(new Uint8Array([0, 15, 16, 255]))).toBe("000f10ff");
  });
});

describe("names inside the archive", () => {
  it("removes what Windows refuses", () => {
    expect(safeName('a<b>c:d"e/f\\g|h?i*j')).toBe("a-b-c-d-e-f-g-h-i-j");
    expect(safeName("report. ")).toBe("report");
    expect(safeName("   ")).toBe("file");
  });

  it("keeps two files with one name apart", () => {
    const taken = new Set<string>();
    expect(uniquePath(taken, "Thandi", "photo.jpg")).toBe("Thandi/photo.jpg");
    expect(uniquePath(taken, "Thandi", "photo.jpg")).toBe("Thandi/photo (2).jpg");
    // Case matters on Linux and not on Windows, where these would collide.
    expect(uniquePath(taken, "Thandi", "PHOTO.JPG")).toBe("Thandi/PHOTO (3).JPG");
  });
});

describe("the pages in the archive", () => {
  const manifest: ArchiveManifest = {
    formatVersion: 1,
    archiveId: "arch-1",
    provider: "Curiosa Academy",
    cohort: { id: "c1", name: "HRM Officer 2026 A", code: "HRM-26A" },
    qualification: "Advanced Occupational Certificate: Human Resource Management Officer",
    builtAt: "2026-09-25T10:00:00.000Z",
    builtBy: "Roland Jones",
    retentionYears: 5,
    learners: [
      {
        userId: "u1",
        name: "Thandi <script>alert(1)</script> Mokoena",
        email: "thandi@example.org",
        folder: "Thandi Mokoena",
        certificates: [{ reference: "CUR-0001", title: "Certificate of competence", issuedAt: "2026-09-01T00:00:00Z" }],
        statements: [{ reference: "SOR-0001", issuedAt: "2026-08-30T00:00:00Z", statement: "Competent in SU1" }],
        decisions: [
          { assessment: "SU1 SA1", attempt: 1, outcome: "Competent", decidedAt: "2026-07-01T00:00:00Z", decidedBy: "A Assessor", moderation: "Upheld" },
        ],
        files: [
          {
            path: "Thandi Mokoena/evidence.pdf",
            sha256: "ab".repeat(32),
            sizeBytes: 2048,
            label: "Evidence for SU1 SA1",
            source: { table: "evidence_artifacts", id: "e1", storageKey: "k1" },
            removeFromServer: true,
          },
        ],
      },
    ],
  };

  it("never lets a name be read as markup", () => {
    const html = renderLearnerIndex(manifest, manifest.learners[0]);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(escapeHtml(`"'&`)).toBe("&quot;&#39;&amp;");
  });

  it("links each file from the learner's own folder", () => {
    const html = renderLearnerIndex(manifest, manifest.learners[0]);
    expect(html).toContain('href="evidence.pdf"');
    expect(html).toContain("ab".repeat(32));
  });

  it("says how long to keep it and that nothing else is needed to read it", () => {
    const html = renderArchiveIndex(manifest);
    expect(html).toContain("Keep this archive for 5 years");
    expect(html).toContain("Nothing in it needs the platform");
    expect(html).toContain('href="Thandi Mokoena/index.html"');
  });

  it("reads in house style", () => {
    // Heidi, 21 September: no em dashes, no sentence starting And or But.
    for (const html of [renderArchiveIndex(manifest), renderLearnerIndex(manifest, manifest.learners[0])]) {
      const text = html.replace(/<[^>]+>/g, " ");
      expect(text).not.toMatch(/—|&mdash;/);
      expect(text).not.toMatch(/(^|[.!?]\s+)(And|But)\s/);
    }
  });
});
