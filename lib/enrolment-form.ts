import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { learnerProfiles, users } from "@/db/schema";
import {
  isValidCode,
  ratingRequiredFor,
  type CodedField,
} from "./learner-codes";
import { validateSouthAfricanId } from "./south-african-id";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * The learner enrolment form, on the platform.
 *
 * Roland, 9 September 2026: "The LMS should automate the enrolment form process
 * so learners complete fields directly on the platform, inheriting cohort
 * details like induction dates automatically."
 *
 * Two things follow from that sentence and shape everything here.
 *
 * **The learner fills it in, not a coordinator.** So the questions are asked in
 * a learner's words rather than the QCTO's - "what language do you speak at
 * home", not "HomeLanguageCode" - and what the platform already knows is not
 * asked again. A form that asks somebody their own name is a form they stop
 * trusting.
 *
 * **It is the evidence a monitor asks for.** Heidi named the enrolment form and
 * the rollout schedule as what the QCTO looks at on a monitoring visit. So it is
 * a document the platform produces and files, not a screen somebody fills in and
 * forgets, and it records when the learner last confirmed it.
 *
 * The codes are the QCTO's, verbatim, in lib/learner-codes.ts. They are checked
 * here rather than at export time: a return is rejected as a whole file, so one
 * wrong cell costs a cohort's submission, and the moment to catch it is while
 * the person who knows the answer is still looking at the screen.
 */

export class EnrolmentFormError extends Error {
  constructor(
    message: string,
    readonly reason: "not_found" | "invalid" | "not_permitted",
  ) {
    super(message);
    this.name = "EnrolmentFormError";
  }
}

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(""));

export const enrolmentFormInput = z.object({
  // The learner's own, which they may correct.
  title: optionalText(20),
  middleName: optionalText(100),

  alternateId: optionalText(50),
  alternateIdType: optionalText(30),

  homeLanguageCode: optionalText(10),
  citizenResidentStatusCode: optionalText(10),
  socioeconomicStatusCode: optionalText(10),
  disabilityRating: optionalText(10),
  immigrantStatus: optionalText(10),

  homeAddress1: optionalText(200),
  homeAddress2: optionalText(200),
  homeAddress3: optionalText(200),
  homeAddressPostalCode: optionalText(10),

  postalAddress1: optionalText(200),
  postalAddress2: optionalText(200),
  postalAddress3: optionalText(200),
  postalAddressPostalCode: optionalText(10),

  phoneNumber: optionalText(30),
  cellPhoneNumber: optionalText(30),
  faxNumber: optionalText(30),

  provinceCode: optionalText(5),
  statssaAreaCode: optionalText(20),

  flc: optionalText(20),
  flcStatementNumber: optionalText(50),

  employerName: optionalText(200),

  /**
   * POPIA. Recorded with its date because the return asks for both, and
   * because consent without a date is not evidence of anything.
   */
  popiaAgreed: z.boolean().optional(),
});

export type EnrolmentFormInput = z.infer<typeof enrolmentFormInput>;

const CODED: [keyof EnrolmentFormInput, CodedField][] = [
  ["homeLanguageCode", "homeLanguageCode"],
  ["citizenResidentStatusCode", "citizenResidentStatusCode"],
  ["socioeconomicStatusCode", "socioeconomicStatusCode"],
  ["disabilityRating", "disabilityRating"],
  ["immigrantStatus", "immigrantStatus"],
  ["provinceCode", "provinceCode"],
  ["alternateIdType", "alternateIdType"],
];

/**
 * Every coded answer has to be one the QCTO recognises.
 *
 * Checked here rather than trusted from the form, because a form is a
 * suggestion: anything can be posted. And checked as a list rather than one at
 * a time, so somebody correcting a form is told everything that is wrong with
 * it at once instead of discovering the next problem on each save.
 */
function codeProblems(input: EnrolmentFormInput): string[] {
  const problems: string[] = [];

  for (const [field, list] of CODED) {
    const value = (input[field] ?? "") as string;
    if (value && !isValidCode(list, value)) {
      problems.push(`${field} is not one of the codes the QCTO accepts.`);
    }
  }

  return problems;
}

/** What the learner still has to answer before the return can be made. */
export type Outstanding = { field: string; why: string };

/**
 * What is missing, said as a person would say it.
 *
 * Deliberately not a validation error. A learner filling this in over two
 * sittings should be able to save what they have; a coordinator needs to know
 * whose form is short before the twenty-one days run out, not at the moment of
 * submission. So it is reported, and saving is never refused for
 * incompleteness.
 */
export function outstandingFor(profile: {
  homeLanguageCode: string | null;
  citizenResidentStatusCode: string | null;
  socioeconomicStatusCode: string | null;
  disabilityRating: string | null;
  immigrantStatus: string | null;
  homeAddress1: string | null;
  homeAddressPostalCode: string | null;
  cellPhoneNumber: string | null;
  provinceCode: string | null;
  statssaAreaCode: string | null;
  confirmedAt: Date | null;
}, learner: { disabilityCode: string | null; consentGivenAt: Date | null }): Outstanding[] {
  const missing: Outstanding[] = [];

  const need = (value: string | null, field: string, why: string) => {
    if (!value || !value.trim()) missing.push({ field, why });
  };

  need(profile.homeLanguageCode, "Home language", "The return asks for it.");
  need(
    profile.citizenResidentStatusCode,
    "Citizenship or residence",
    "The return asks for it.",
  );
  need(
    profile.socioeconomicStatusCode,
    "Employment status",
    "The return asks for it.",
  );
  need(profile.immigrantStatus, "Immigrant status", "The return asks for it.");
  need(profile.homeAddress1, "Home address", "The return asks for it.");
  need(
    profile.homeAddressPostalCode,
    "Home postal code",
    "The return asks for it.",
  );
  need(profile.cellPhoneNumber, "Cell phone number", "The return asks for it.");
  need(
    profile.provinceCode,
    "Province of work",
    "The province the learner works in, which is not always where they live.",
  );
  need(
    profile.statssaAreaCode,
    "STATSSA area code",
    "From the STATSSA area code list the QCTO publishes.",
  );

  /**
   * The specification's own condition on column M: a rating is required
   * whenever a difficulty is recorded, and only "none" leaves it blank.
   */
  if (
    ratingRequiredFor(learner.disabilityCode ?? "") &&
    !profile.disabilityRating
  ) {
    missing.push({
      field: "Disability rating",
      why: "A disability was recorded, and the QCTO then requires how much difficulty it causes.",
    });
  }

  if (!learner.consentGivenAt) {
    missing.push({
      field: "POPIA agreement",
      why: "The return asks whether the learner agreed, and on what date.",
    });
  }

  if (!profile.confirmedAt) {
    missing.push({
      field: "Confirmation",
      why: "Nobody has confirmed these details are right. A monitor asks for the form as evidence, and an unconfirmed one is evidence of very little.",
    });
  }

  return missing;
}

/** A learner's form, with what is still outstanding on it. */
export async function getEnrolmentForm(
  session: AuthenticatedSession,
  learnerId: string,
) {
  if (learnerId !== session.userId) {
    assertSessionCan(session, "enrolment:read_all");
  }

  return withTenant(session.organisationId, async (tx) => {
    const [learner] = await tx
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        nationalId: users.nationalId,
        dateOfBirth: users.dateOfBirth,
        gender: users.gender,
        equityCode: users.equityCode,
        disabilityCode: users.disabilityCode,
        nationality: users.nationality,
        consentGivenAt: users.consentGivenAt,
      })
      .from(users)
      .where(eq(users.id, learnerId));

    if (!learner) {
      throw new EnrolmentFormError("No such learner.", "not_found");
    }

    const [profile] = await tx
      .select()
      .from(learnerProfiles)
      .where(eq(learnerProfiles.userId, learnerId));

    // A learner who has never opened the form has no row yet, which is the
    // ordinary state rather than a fault. Everything reads as empty.
    const blank = {
      alternateId: null,
      alternateIdType: null,
      title: null,
      middleName: null,
      homeLanguageCode: null,
      citizenResidentStatusCode: null,
      socioeconomicStatusCode: null,
      disabilityRating: null,
      immigrantStatus: null,
      homeAddress1: null,
      homeAddress2: null,
      homeAddress3: null,
      homeAddressPostalCode: null,
      postalAddress1: null,
      postalAddress2: null,
      postalAddress3: null,
      postalAddressPostalCode: null,
      phoneNumber: null,
      cellPhoneNumber: null,
      faxNumber: null,
      provinceCode: null,
      statssaAreaCode: null,
      flc: null,
      flcStatementNumber: null,
      employerName: null,
      confirmedAt: null,
      confirmedById: null,
    };

    const held = profile ?? blank;

    return {
      learner,
      profile: held,
      outstanding: outstandingFor(held, learner),
    };
  });
}

/**
 * Saves what the learner has filled in.
 *
 * Never refuses for incompleteness - a form filled in over two sittings has to
 * be saveable half-done - but always refuses a code the QCTO would reject,
 * because that is not incompleteness, it is a value that would fail the whole
 * cohort's submission.
 */
export async function saveEnrolmentForm(
  session: AuthenticatedSession,
  learnerId: string,
  input: EnrolmentFormInput,
  options: { confirm?: boolean } = {},
) {
  if (learnerId !== session.userId) {
    assertSessionCan(session, "enrolment:manage");
  }

  const parsed = enrolmentFormInput.parse(input);
  const problems = codeProblems(parsed);

  if (problems.length > 0) {
    throw new EnrolmentFormError(problems.join(" "), "invalid");
  }

  const value = (key: keyof EnrolmentFormInput) => {
    const raw = parsed[key];
    return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
  };

  return withTenant(session.organisationId, async (tx) => {
    const [learner] = await tx
      .select({ id: users.id, nationalId: users.nationalId })
      .from(users)
      .where(eq(users.id, learnerId));

    if (!learner) {
      throw new EnrolmentFormError("No such learner.", "not_found");
    }

    const fields = {
      organisationId: session.organisationId,
      userId: learnerId,
      title: value("title"),
      middleName: value("middleName"),
      alternateId: value("alternateId"),
      alternateIdType: value("alternateIdType"),
      homeLanguageCode: value("homeLanguageCode"),
      citizenResidentStatusCode: value("citizenResidentStatusCode"),
      socioeconomicStatusCode: value("socioeconomicStatusCode"),
      disabilityRating: value("disabilityRating"),
      immigrantStatus: value("immigrantStatus"),
      homeAddress1: value("homeAddress1"),
      homeAddress2: value("homeAddress2"),
      homeAddress3: value("homeAddress3"),
      homeAddressPostalCode: value("homeAddressPostalCode"),
      postalAddress1: value("postalAddress1"),
      postalAddress2: value("postalAddress2"),
      postalAddress3: value("postalAddress3"),
      postalAddressPostalCode: value("postalAddressPostalCode"),
      phoneNumber: value("phoneNumber"),
      cellPhoneNumber: value("cellPhoneNumber"),
      faxNumber: value("faxNumber"),
      provinceCode: value("provinceCode"),
      statssaAreaCode: value("statssaAreaCode"),
      flc: value("flc"),
      flcStatementNumber: value("flcStatementNumber"),
      employerName: value("employerName"),
      updatedAt: new Date(),
      ...(options.confirm
        ? { confirmedAt: new Date(), confirmedById: session.userId }
        : {}),
    };

    const [saved] = await tx
      .insert(learnerProfiles)
      .values(fields)
      .onConflictDoUpdate({
        target: learnerProfiles.userId,
        set: fields,
      })
      .returning();

    /**
     * POPIA consent lives on the user beside the rest of the demographic
     * block, because that block is what `anonymisedAt` governs. Recorded with
     * its date, since consent without one is not evidence of anything.
     */
    if (parsed.popiaAgreed) {
      // Only where none is already recorded. Re-saving the form must not move
      // the date somebody consented, because that date is the evidence: moving
      // it forward would quietly rewrite when they agreed.
      await tx
        .update(users)
        .set({ consentGivenAt: new Date(), consentVersion: "enrolment-form" })
        .where(and(eq(users.id, learnerId), isNull(users.consentGivenAt)));
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: options.confirm
        ? "enrolment_form.confirmed"
        : "enrolment_form.saved",
      entityType: "learner_profile",
      entityId: saved.id,
      after: { learnerId, confirmed: Boolean(options.confirm) },
    });

    return saved;
  });
}

/**
 * What the identity number itself says, checked against what was recorded.
 *
 * The data-loading specification requires that "the Gender will meet the gender
 * indicator defined in the National ID number", and a South African identity
 * number carries both the date of birth and the gender inside it. So a
 * mismatch is findable without asking anybody, and worth finding: it usually
 * means a digit was mistyped rather than that somebody's gender is wrong.
 */
export function identityDisagreements(learner: {
  nationalId: string | null;
  dateOfBirth: Date | null;
  gender: string | null;
}): string[] {
  if (!learner.nationalId) return [];

  const check = validateSouthAfricanId(learner.nationalId);
  if (!check.valid) {
    return [`The identity number does not check out: ${check.reason}`];
  }

  const problems: string[] = [];

  if (learner.gender) {
    const fromId = check.gender === "male" ? "M" : "F";
    const recorded = learner.gender.trim().toUpperCase().slice(0, 1);
    if (recorded === "M" || recorded === "F") {
      if (recorded !== fromId) {
        problems.push(
          "The gender recorded does not match the one in the identity number. The QCTO checks this, so one of the two is mistyped.",
        );
      }
    }
  }

  if (learner.dateOfBirth) {
    const recorded = learner.dateOfBirth.toISOString().slice(0, 10);
    const fromId = check.dateOfBirth.toISOString().slice(0, 10);
    if (recorded !== fromId) {
      problems.push(
        `The date of birth recorded (${recorded}) does not match the identity number, which says ${fromId}.`,
      );
    }
  }

  return problems;
}
