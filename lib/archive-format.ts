/**
 * The shape of a cohort archive, and how its fingerprint is taken.
 *
 * Job sheet 4.3. Once a cohort has its certificates and statements of results,
 * its evidence leaves the server. Roland decided on 25 September that the
 * provider keeps the archive, and that no file is removed until the provider's
 * own copy has been checked and found intact.
 *
 * This module imports nothing from the server on purpose. The provider's
 * browser runs the same fingerprint code against the copy on their own
 * machine, and a second implementation of the same arithmetic would be a
 * second thing that could disagree with the first.
 *
 * WHY A CHUNKED FINGERPRINT
 *
 * "Hand the archive back" cannot mean uploading it: an archive can exceed a
 * gigabyte, the proxy refuses uploads over 512 MB, and the server has 929 MB of
 * memory. So the browser reads the saved file where it sits, in pieces, and
 * sends only the fingerprint. The file never travels, its size does not
 * matter, and a match proves the same thing a re-upload would have: the
 * provider holds a byte-for-byte intact copy.
 *
 * The fingerprint is the SHA-256 of the SHA-256s of successive 8 MiB pieces,
 * prefixed with the scheme's version. Pieces rather than one digest of the
 * whole, because a browser can digest 8 MiB comfortably and cannot hold a
 * gigabyte in one buffer; and because the server can take the same pieces as
 * it writes the archive, without reading it back.
 */

export const ARCHIVE_FORMAT_VERSION = 1;
export const FINGERPRINT_SCHEME = "v1";
export const CHUNK_BYTES = 8 * 1024 * 1024;

/** SHA-256 of some bytes. Node's crypto on the server, SubtleCrypto in a browser. */
export type Digest = (bytes: Uint8Array) => Promise<Uint8Array>;

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Takes bytes in pieces of any size and produces the archive fingerprint.
 *
 * Pieces arrive as the zip writer produces them, which is never on an 8 MiB
 * boundary, so this carries the remainder over. Updates are awaited in order;
 * the caller must not start one before the last has finished.
 */
export class ChunkedFingerprint {
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private readonly digests: Uint8Array[] = [];
  private total = 0;

  constructor(private readonly digest: Digest) {}

  async update(bytes: Uint8Array): Promise<void> {
    this.total += bytes.length;
    let offset = 0;
    while (offset < bytes.length) {
      const take = Math.min(CHUNK_BYTES - this.pendingBytes, bytes.length - offset);
      this.pending.push(bytes.subarray(offset, offset + take));
      this.pendingBytes += take;
      offset += take;
      if (this.pendingBytes === CHUNK_BYTES) await this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.pendingBytes === 0) return;
    this.digests.push(await this.digest(concat(this.pending)));
    this.pending = [];
    this.pendingBytes = 0;
  }

  /** The fingerprint, and how many bytes it covers. */
  async finish(): Promise<{ fingerprint: string; bytes: number }> {
    await this.flush();
    const whole = await this.digest(concat(this.digests));
    return { fingerprint: `${FINGERPRINT_SCHEME}:${toHex(whole)}`, bytes: this.total };
  }
}

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

/** Where a file in the archive came from, so a restore can put it back. */
export type ArchivedFileSource =
  | { table: "evidence_artifacts"; id: string; storageKey: string }
  | { table: "enrolment_documents"; id: string; storageKey: string }
  | { table: "certificates"; id: string; storageKey: string };

export type ArchivedFile = {
  /** Path inside the archive. */
  path: string;
  /** SHA-256 of the file's bytes, hex. */
  sha256: string;
  sizeBytes: number;
  /** What a person sees against it on the learner's page. */
  label: string;
  source: ArchivedFileSource;
  /**
   * Whether the server's copy is removed once the archive is checked.
   *
   * False for an enrolment document the learner still needs: an identity
   * document copied for this qualification may be what another enrolment of
   * theirs, still running, depends on. It is carried in the archive either way.
   */
  removeFromServer: boolean;
};

export type ArchivedLearner = {
  userId: string;
  name: string;
  email: string;
  /** Folder inside the archive. */
  folder: string;
  certificates: { reference: string; title: string; issuedAt: string }[];
  statements: { reference: string; issuedAt: string; statement: string }[];
  /** Every assessment the learner was judged on, in words. */
  decisions: {
    assessment: string;
    attempt: number;
    outcome: string;
    decidedAt: string | null;
    decidedBy: string | null;
    moderation: string | null;
    /** Each criterion the assessor judged, with what they said about it. */
    criteria?: {
      code: string;
      description: string;
      judgement: string;
      note: string | null;
    }[];
  }[];
  files: ArchivedFile[];
};

export type ArchiveManifest = {
  formatVersion: typeof ARCHIVE_FORMAT_VERSION;
  archiveId: string;
  provider: string;
  cohort: { id: string; name: string; code: string | null };
  qualification: string | null;
  builtAt: string;
  builtBy: string;
  /** Years the records are kept after each certificate is issued. */
  retentionYears: number;
  learners: ArchivedLearner[];
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * A name safe inside a zip on every system it might be opened on.
 *
 * Windows refuses a handful of characters and trailing dots; a name that
 * cannot be extracted is a file the provider cannot open four years from now.
 */
export function safeName(value: string, fallback = "file"): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

/**
 * Makes each path unique within a folder, keeping the extension.
 *
 * Two uploads both called "photo.jpg" are two pieces of evidence, and the
 * second must not overwrite the first when the archive is opened.
 */
export function uniquePath(taken: Set<string>, folder: string, filename: string): string {
  const name = safeName(filename);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = `${folder}/${name}`;
  for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) {
    candidate = `${folder}/${stem} (${n})${ext}`;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

// ---------------------------------------------------------------------------
// Pages a person can read without the platform
// ---------------------------------------------------------------------------

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;color:#1f2933;line-height:1.5}
h1{font-size:1.5rem;margin-bottom:.25rem}h2{font-size:1.1rem;margin-top:2rem;border-bottom:1px solid #d9dee3;padding-bottom:.25rem}
table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{text-align:left;padding:.35rem .5rem;border-bottom:1px solid #eef1f3;vertical-align:top}
th{background:#f4f6f8}.muted{color:#52606d;font-size:.85rem}code{font-size:.8rem;word-break:break-all}`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>\n`;
}

function relativeFromFolder(path: string, folder: string): string {
  return path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : `../${path}`;
}

/** The page at the top of the archive: who is in it, and how to check it. */
export function renderArchiveIndex(manifest: ArchiveManifest): string {
  const rows = manifest.learners
    .map(
      (learner) =>
        `<tr><td><a href="${escapeHtml(learner.folder)}/index.html">${escapeHtml(learner.name)}</a></td><td>${escapeHtml(learner.email)}</td><td>${learner.files.length}</td><td>${learner.certificates.map((c) => escapeHtml(c.issuedAt.slice(0, 10))).join(", ")}</td></tr>`,
    )
    .join("");

  return page(
    `${manifest.cohort.name}: archived evidence`,
    `<h1>${escapeHtml(manifest.cohort.name)}</h1>
<p class="muted">${escapeHtml(manifest.provider)}${manifest.qualification ? ` &middot; ${escapeHtml(manifest.qualification)}` : ""}${manifest.cohort.code ? ` &middot; ${escapeHtml(manifest.cohort.code)}` : ""}</p>
<p>The Portfolio of Evidence of each learner below, as it stood when this archive was made on ${escapeHtml(manifest.builtAt.slice(0, 10))} by ${escapeHtml(manifest.builtBy)}. Each learner's page lists their certificates, statements of results, assessment decisions and every file, with the fingerprint recorded when the file was uploaded.</p>
<p>Keep this archive for ${manifest.retentionYears} years after the last certificate in it was issued. Nothing in it needs the platform to be read: open this page in a browser.</p>
<h2>Learners</h2>
<table><thead><tr><th>Learner</th><th>Email</th><th>Files</th><th>Certificate issued</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Checking the archive</h2>
<p class="muted"><code>manifest.json</code> lists every file with its SHA-256 fingerprint. A file whose fingerprint no longer matches has been changed since it was uploaded. Archive ${escapeHtml(manifest.archiveId)}, format ${manifest.formatVersion}.</p>`,
  );
}

function renderCriteria(criteria: ArchivedLearner["decisions"][number]["criteria"]): string {
  if (!criteria?.length) return "";
  return `<ul class="muted">${criteria
    .map(
      (c) =>
        `<li>${escapeHtml(c.code)} ${escapeHtml(c.description)}: <strong>${escapeHtml(c.judgement)}</strong>${c.note ? `. ${escapeHtml(c.note)}` : ""}</li>`,
    )
    .join("")}</ul>`;
}

/** One learner's page: their record, in words, and every file. */
export function renderLearnerIndex(manifest: ArchiveManifest, learner: ArchivedLearner): string {
  const certificates = learner.certificates.length
    ? `<table><thead><tr><th>Certificate</th><th>Reference</th><th>Issued</th></tr></thead><tbody>${learner.certificates
        .map((c) => `<tr><td>${escapeHtml(c.title)}</td><td>${escapeHtml(c.reference)}</td><td>${escapeHtml(c.issuedAt.slice(0, 10))}</td></tr>`)
        .join("")}</tbody></table>`
    : `<p class="muted">No certificate recorded.</p>`;

  const statements = learner.statements.length
    ? `<table><thead><tr><th>Statement of results</th><th>Reference</th><th>Issued</th></tr></thead><tbody>${learner.statements
        .map((s) => `<tr><td>${escapeHtml(s.statement)}</td><td>${escapeHtml(s.reference)}</td><td>${escapeHtml(s.issuedAt.slice(0, 10))}</td></tr>`)
        .join("")}</tbody></table>`
    : `<p class="muted">No statement of results recorded.</p>`;

  const decisions = learner.decisions.length
    ? `<table><thead><tr><th>Assessment</th><th>Attempt</th><th>Outcome</th><th>Decided</th><th>Moderation</th></tr></thead><tbody>${learner.decisions
        .map(
          (d) =>
            `<tr><td>${escapeHtml(d.assessment)}${renderCriteria(d.criteria)}</td><td>${d.attempt}</td><td>${escapeHtml(d.outcome)}</td><td>${escapeHtml([d.decidedAt?.slice(0, 10), d.decidedBy].filter(Boolean).join(", "))}</td><td>${escapeHtml(d.moderation ?? "")}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : `<p class="muted">No assessment decisions recorded.</p>`;

  const files = learner.files.length
    ? `<table><thead><tr><th>File</th><th>What it is</th><th>Size</th><th>Fingerprint (SHA-256)</th></tr></thead><tbody>${learner.files
        .map(
          (f) =>
            `<tr><td><a href="${escapeHtml(relativeFromFolder(f.path, learner.folder))}">${escapeHtml(f.path.split("/").pop() ?? f.path)}</a></td><td>${escapeHtml(f.label)}</td><td>${Math.max(1, Math.round(f.sizeBytes / 1024))} KB</td><td><code>${escapeHtml(f.sha256)}</code></td></tr>`,
        )
        .join("")}</tbody></table>`
    : `<p class="muted">No files.</p>`;

  return page(
    `${learner.name}: Portfolio of Evidence`,
    `<p class="muted"><a href="../index.html">${escapeHtml(manifest.cohort.name)}</a></p>
<h1>${escapeHtml(learner.name)}</h1>
<p class="muted">${escapeHtml(learner.email)}</p>
<h2>Certificates</h2>${certificates}
<h2>Statements of results</h2>${statements}
<h2>Assessment decisions</h2>${decisions}
<h2>Files</h2>${files}`,
  );
}
