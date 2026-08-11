import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Where uploaded evidence lives.
 *
 * Local disk in development, S3-compatible object storage in deployment. The
 * interface is the same in both, which is what lets one set of containers run
 * as a shared cloud tenant or inside a client's own network.
 *
 * Every stored object is hashed with SHA-256 on the way in. The hash is what
 * makes a Portfolio of Evidence defensible: if a stored file is ever altered,
 * its hash stops matching the one recorded at submission and the record is
 * flagged. Nobody has to trust that the file was left alone — it can be
 * checked.
 */

const STORAGE_ROOT = resolve(process.env.STORAGE_LOCAL_ROOT ?? "storage");

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
): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120);
  return `${organisationId}/evidence/${submissionId}/${randomUUID()}-${safe}`;
}

export async function putObject(
  storageKey: string,
  bytes: Uint8Array,
): Promise<StoredObject> {
  if ((process.env.STORAGE_DRIVER ?? "local") !== "local") {
    throw new Error(
      "Only the local storage driver is implemented. S3 is configured at deployment.",
    );
  }

  const path = join(STORAGE_ROOT, storageKey);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);

  return {
    storageKey,
    sha256: hashBytes(bytes),
    sizeBytes: bytes.byteLength,
  };
}

export async function getObject(storageKey: string): Promise<Uint8Array> {
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
