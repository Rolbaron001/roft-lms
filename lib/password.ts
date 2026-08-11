import { compare, hash } from "bcryptjs";

/**
 * bcrypt silently ignores anything past 72 bytes, which would make a long
 * passphrase weaker than it looks. Reject rather than truncate.
 */
const MAX_PASSWORD_BYTES = 72;
const MIN_PASSWORD_LENGTH = 12;
const BCRYPT_COST = 12;

export class WeakPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeakPasswordError";
  }
}

export function assertPasswordAcceptable(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    throw new WeakPasswordError(
      `Password must be at most ${MAX_PASSWORD_BYTES} bytes.`,
    );
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordAcceptable(password);
  return hash(password, BCRYPT_COST);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return compare(password, passwordHash);
}

/**
 * Spends the same time verifying a password for an email address that does not
 * exist as for one that does. Without this, response time tells an attacker
 * which addresses hold accounts.
 *
 * The hash is generated once, at the same cost factor as a real one, from a
 * value nobody knows — including us.
 */
let decoyHash: Promise<string> | undefined;

export async function burnPasswordVerificationTime(
  password: string,
): Promise<false> {
  decoyHash ??= hash(crypto.randomUUID() + crypto.randomUUID(), BCRYPT_COST);
  await compare(password, await decoyHash);
  return false;
}
