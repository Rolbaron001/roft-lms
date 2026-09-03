import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Sealing a secret the platform has to keep.
 *
 * The platform holds almost nothing of this kind on purpose. Passwords are
 * hashed and never recoverable; session tokens are stored as hashes too. This
 * module exists for the one thing that genuinely has to come back out in its
 * original form: a person's AI extension token, which is useless unless it can
 * be handed to the provider exactly as issued.
 *
 * So this is encryption rather than hashing, and that is a real difference in
 * kind. Anything sealed here can be unsealed by anything holding the key. It is
 * used for one column and should stay that way; a second caller is a reason to
 * ask whether that thing needs storing at all.
 *
 * AES-256-GCM, which authenticates as well as encrypts: a ciphertext altered in
 * the database fails to open rather than opening as something else.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * The key, derived once per process.
 *
 * A dedicated `AI_TOKEN_KEY` if there is one, otherwise derived from
 * `AUTH_SECRET` with HKDF under its own label. Deriving is not a shortcut: the
 * label means this key cannot be used to forge a session and a session secret
 * cannot open these, even though one secret is behind both.
 *
 * Deriving rather than requiring a new variable is a deliberate trade. It means
 * this works on an existing deployment without anybody editing an `.env` file
 * first, at the cost of tying token lifetime to `AUTH_SECRET`: rotate that and
 * every stored token stops opening. That is survivable - each person pastes
 * theirs again - and `unseal` reports it as exactly that rather than as
 * corruption.
 */
function key(): Buffer {
  const dedicated = process.env.AI_TOKEN_KEY;
  if (dedicated) {
    const raw = Buffer.from(dedicated, "base64");
    if (raw.length !== KEY_BYTES) {
      throw new Error(
        `AI_TOKEN_KEY must be ${KEY_BYTES} bytes of base64. Generate one with: openssl rand -base64 32`,
      );
    }
    return raw;
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "Neither AI_TOKEN_KEY nor AUTH_SECRET is set, so there is nothing to encrypt with.",
    );
  }

  return Buffer.from(
    hkdfSync("sha256", secret, "roft-lms-ai-token", "ai-extension-token", KEY_BYTES),
  );
}

/** Whether a key exists at all, so a form can say so rather than throwing. */
export function sealingAvailable(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/**
 * Seals a secret. The result is base64 and carries its own IV and tag.
 *
 * A fresh IV per call, which is not optional with GCM: the same IV used twice
 * under one key leaks the relationship between the two plaintexts.
 */
export function seal(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

/**
 * Opens a sealed secret, or null if it will not open.
 *
 * Null rather than a throw, because every reason it fails is a reason the
 * caller has to handle anyway: the key rotated, the row predates the current
 * secret, somebody edited the column. All of them mean the same thing to the
 * person - paste it again - and none of them should take a page down.
 */
export function unseal(sealed: string | null | undefined): string | null {
  if (!sealed) return null;

  try {
    const raw = Buffer.from(sealed, "base64");
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;

    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      raw.subarray(0, IV_BYTES),
    );
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));

    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * The last four characters, for telling one token from another.
 *
 * Shown back to the person so they can see which token is stored without the
 * platform ever displaying it. Four characters of a token this long identify it
 * to the person who pasted it and are no use to anybody else.
 */
export function hintOf(secret: string): string {
  const trimmed = secret.trim();
  return trimmed.length <= 4 ? "" : trimmed.slice(-4);
}

/** Constant-time comparison, for anywhere a secret is checked against another. */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
