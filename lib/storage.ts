import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  getObjectS3,
  putObjectS3,
  s3ConfigFromEnv,
  type S3Config,
} from "./storage-s3";

/**
 * Where uploaded evidence lives.
 *
 * Local disk in development, S3-compatible object storage in deployment,
 * chosen by STORAGE_DRIVER. The interface is the same in both, which is what
 * lets one set of containers run as a shared cloud tenant or inside a client's
 * own network — and what makes moving evidence off the application server a
 * change of configuration rather than a change of code.
 *
 * Every stored object is hashed with SHA-256 on the way in. The hash is what
 * makes a Portfolio of Evidence defensible: if a stored file is ever altered,
 * its hash stops matching the one recorded at submission and the record is
 * flagged. Nobody has to trust that the file was left alone — it can be
 * checked.
 */

const STORAGE_ROOT = resolve(process.env.STORAGE_LOCAL_ROOT ?? "storage");

/**
 * Read once, on first use, rather than at import.
 *
 * Reading at import would make every command that touches this module — a
 * migration, a backup, a test — fail at startup on a machine with no bucket
 * configured, including the local ones that will never need it.
 */
let cachedS3: S3Config | null = null;

function usingS3(): boolean {
  return (process.env.STORAGE_DRIVER ?? "local") === "s3";
}

function s3(): S3Config {
  cachedS3 ??= s3ConfigFromEnv();
  return cachedS3;
}

/** Test seam: forget the cached configuration. */
export function resetStorageConfig(): void {
  cachedS3 = null;
}

export type StoredObject = {
  storageKey: string;
  sha256: string;
  sizeBytes: number;
};

export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Keys are scoped by tenant so that an on-premise deployment, or an inspection
 * of the bucket, shows plainly which client an object belongs to.
 */
export function buildStorageKey(
  organisationId: string,
  submissionId: string,
  filename: string,
  /**
   * The area of the bucket. Evidence and programme documents have very
   * different retention and access rules, so they are kept apart from the
   * start rather than separated later by prefix archaeology.
   */
  area: "evidence" | "programme" = "evidence",
): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120);
  return `${organisationId}/${area}/${submissionId}/${randomUUID()}-${safe}`;
}

export async function putObject(
  storageKey: string,
  bytes: Uint8Array,
  contentType?: string,
): Promise<StoredObject> {
  // Hashed before it is sent, and the same hash is what signs the request.
  // One value, computed once: a file whose recorded hash and whose transmitted
  // hash could differ is exactly the doubt the hash exists to remove.
  const sha256 = hashBytes(bytes);

  if (usingS3()) {
    await putObjectS3(s3(), storageKey, bytes, contentType);
  } else {
    const path = join(STORAGE_ROOT, storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  return { storageKey, sha256, sizeBytes: bytes.byteLength };
}

export async function getObject(storageKey: string): Promise<Uint8Array> {
  if (usingS3()) return getObjectS3(s3(), storageKey);

  const path = join(STORAGE_ROOT, storageKey);
  return new Uint8Array(await readFile(path));
}

/**
 * Re-hashes a stored object and compares it with the hash recorded when it was
 * submitted. Used by the integrity check an auditor can run over a portfolio.
 */
export async function verifyIntegrity(
  storageKey: string,
  expectedSha256: string,
): Promise<boolean> {
  try {
    const bytes = await getObject(storageKey);
    return hashBytes(bytes) === expectedSha256;
  } catch {
    return false;
  }
}
