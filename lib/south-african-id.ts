/**
 * South African national identity numbers.
 *
 * A 13-digit number: YYMMDD SSSS C A Z
 *
 *   YYMMDD  date of birth
 *   SSSS    sequence within that birth date; 0000-4999 female, 5000-9999 male
 *   C       citizenship: 0 South African, 1 permanent resident
 *   A       historically a race classifier, now almost always 8
 *   Z       check digit, Luhn over the preceding twelve
 *
 * Validated here because the NLRD rejects a submission containing a malformed
 * identity number, and a rejected return means re-work for the provider and a
 * delay for every learner in the file. Catching it at data entry costs
 * nothing; catching it after submission costs a cycle.
 */

export type IdValidation =
  | { valid: true; dateOfBirth: Date; gender: "male" | "female"; citizen: boolean }
  | { valid: false; reason: string };

/** Luhn checksum, as the NLRD specification requires for identity numbers. */
export function luhnIsValid(digits: string): boolean {
  let sum = 0;
  let double = false;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) return false;

    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }

    sum += digit;
    double = !double;
  }

  return sum % 10 === 0;
}

/** The check digit that would make a twelve-digit prefix valid. */
export function luhnCheckDigit(twelveDigits: string): number {
  for (let candidate = 0; candidate <= 9; candidate += 1) {
    if (luhnIsValid(`${twelveDigits}${candidate}`)) return candidate;
  }
  // Unreachable: exactly one digit always satisfies the checksum.
  throw new Error("No valid Luhn check digit exists.");
}

/**
 * Resolves the two-digit year to a century.
 *
 * A number cannot belong to someone not yet born, so a two-digit year that
 * would place the birth in the future belongs to the previous century. The
 * alternative — assuming 1900 always — starts producing 120-year-old learners
 * as the century goes on.
 */
function resolveYear(twoDigitYear: number, reference = new Date()): number {
  const currentYear = reference.getFullYear();
  const currentCentury = Math.floor(currentYear / 100) * 100;
  const candidate = currentCentury + twoDigitYear;
  return candidate > currentYear ? candidate - 100 : candidate;
}

export function validateSouthAfricanId(
  input: string,
  reference = new Date(),
): IdValidation {
  const digits = input.replace(/[\s-]/g, "");

  if (!/^\d{13}$/.test(digits)) {
    return {
      valid: false,
      reason: "An identity number is exactly 13 digits.",
    };
  }

  const year = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));

  if (month < 1 || month > 12) {
    return { valid: false, reason: "The month in the date of birth is not valid." };
  }

  const fullYear = resolveYear(year, reference);
  const dateOfBirth = new Date(Date.UTC(fullYear, month - 1, day));

  // Rejects 31 February and similar: the constructed date rolls over, so the
  // day no longer matches what was written.
  if (
    dateOfBirth.getUTCFullYear() !== fullYear ||
    dateOfBirth.getUTCMonth() !== month - 1 ||
    dateOfBirth.getUTCDate() !== day
  ) {
    return { valid: false, reason: "The date of birth is not a real date." };
  }

  const citizenshipDigit = digits[10];
  if (citizenshipDigit !== "0" && citizenshipDigit !== "1") {
    return {
      valid: false,
      reason: "The citizenship digit must be 0 or 1.",
    };
  }

  if (!luhnIsValid(digits)) {
    return {
      valid: false,
      reason: "The check digit does not match; the number was likely mistyped.",
    };
  }

  return {
    valid: true,
    dateOfBirth,
    gender: Number(digits.slice(6, 10)) >= 5000 ? "male" : "female",
    citizen: citizenshipDigit === "0",
  };
}
