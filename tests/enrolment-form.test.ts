/**
 * The learner enrolment form, and the codes a QCTO return will accept.
 *
 * The codes are not the platform's categories and are not open to improvement.
 * They come from `Design/Templates/data-loading-specification-document.pdf`,
 * and a return carrying `Male` where the specification says `M` is rejected -
 * as a whole file, so one wrong cell costs the entire cohort's submission.
 *
 * Two of these tests guard something Heidi raised specifically on 9 September:
 * the leading zero, which Excel eats the moment a cell is anything but text,
 * and which makes their submissions manual today.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { organisations, userRoles, users } from "@/db/schema";
import {
  CODE_LISTS,
  DISABILITY_STATUS_CODES,
  forSpreadsheet,
  GENDER_CODES,
  isValidCode,
  labelFor,
  PROVINCE_CODES,
  ratingRequiredFor,
} from "@/lib/learner-codes";
import {
  getEnrolmentForm,
  identityDisagreements,
  outstandingFor,
  saveEnrolmentForm,
} from "@/lib/enrolment-form";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let coordinator: AuthenticatedSession;
let learner: AuthenticatedSession;
let otherLearner: AuthenticatedSession;

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "test@example.test",
    firstName: "Test",
    lastName: "User",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

beforeAll(async () => {
  const slug = `form-${Date.now()}`;

  organisationId = await withPlatformScope("enrolment form setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Enrolment Form Test Co",
        status: "active",
      })
      .returning({ id: organisations.id });
    return organisation.id;
  });

  const made = await withPlatformScope("enrolment form fixture", async (tx) => {
    const ids: string[] = [];
    for (const [email, role] of [
      ["coordinator@form.test", "tenant_admin"],
      ["learner@form.test", "learner"],
      ["other@form.test", "learner"],
    ] as const) {
      const [user] = await tx
        .insert(users)
        .values({
          organisationId,
          email,
          firstName: "Form",
          lastName: "Tester",
          status: "active",
        })
        .returning({ id: users.id });
      await tx
        .insert(userRoles)
        .values({ organisationId, userId: user.id, role });
      ids.push(user.id);
    }
    return ids;
  });

  coordinator = sessionFor(["tenant_admin"], made[0]);
  learner = sessionFor(["learner"], made[1]);
  otherLearner = sessionFor(["learner"], made[2]);
});

afterAll(async () => {
  await withPlatformScope("enrolment form teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("the codes a return will accept", () => {
  it("uses the specification's own values, not friendlier ones", () => {
    expect(GENDER_CODES.map((c) => c.code)).toEqual(["F", "M"]);
    expect(isValidCode("genderCode", "M")).toBe(true);
    // The obvious well-meaning substitution, and it fails the whole file.
    expect(isValidCode("genderCode", "Male")).toBe(false);
    expect(isValidCode("provinceCode", "7")).toBe(true);
    expect(isValidCode("provinceCode", "Gauteng")).toBe(false);
  });

  it("carries every province the specification names, including the two that are not provinces", () => {
    expect(PROVINCE_CODES).toHaveLength(11);
    expect(PROVINCE_CODES.map((c) => c.code)).toContain("N");
    expect(PROVINCE_CODES.map((c) => c.code)).toContain("X");
  });

  it("gives a label for a code and leaves an unknown one alone", () => {
    expect(labelFor("homeLanguageCode", "Zul")).toBe("isiZulu");
    expect(labelFor("homeLanguageCode", "QQ")).toBe("QQ");
  });

  it("has no duplicate code in any list", () => {
    for (const [field, list] of Object.entries(CODE_LISTS)) {
      const codes = list.map((option) => option.code);
      expect(new Set(codes).size, `${field} repeats a code`).toBe(codes.length);
    }
  });
});

describe("the leading zero, which Excel eats", () => {
  /**
   * Heidi, 9 September: the QCTO's loader wants `01`, and a spreadsheet cell
   * that is not explicitly text turns that into `1`. The apostrophe is Excel's
   * own way of saying "leave this alone".
   */
  it("quotes a code whose leading zero matters", () => {
    expect(forSpreadsheet("socioeconomicStatusCode", "01")).toBe("'01");
    expect(forSpreadsheet("disabilityStatusCode", "05")).toBe("'05");
    expect(forSpreadsheet("immigrantStatus", "03")).toBe("'03");
  });

  it("leaves alone a value that was never at risk", () => {
    // No leading zero to lose.
    expect(forSpreadsheet("socioeconomicStatusCode", "10")).toBe("10");
    expect(forSpreadsheet("socioeconomicStatusCode", "U")).toBe("U");
    // Not a field where a leading zero occurs at all.
    expect(forSpreadsheet("provinceCode", "7")).toBe("7");
    expect(forSpreadsheet("genderCode", "F")).toBe("F");
  });

  it("writes nothing for a value nobody gave", () => {
    expect(forSpreadsheet("socioeconomicStatusCode", "")).toBe("");
  });
});

describe("a rating is required once a difficulty is recorded", () => {
  /**
   * The specification's own condition on column M. `N` means none and is the
   * only status that leaves the rating empty.
   */
  it("is required for every disability status except none", () => {
    for (const option of DISABILITY_STATUS_CODES) {
      expect(ratingRequiredFor(option.code)).toBe(option.code !== "N");
    }
  });

  it("is not required when nothing has been recorded yet", () => {
    expect(ratingRequiredFor("")).toBe(false);
  });

  it("is reported as outstanding when the disability is set and the rating is not", () => {
    const blank = {
      homeLanguageCode: "Eng",
      citizenResidentStatusCode: "SA",
      socioeconomicStatusCode: "01",
      disabilityRating: null,
      immigrantStatus: "03",
      homeAddress1: "1 Road",
      homeAddressPostalCode: "2196",
      cellPhoneNumber: "0820000000",
      provinceCode: "7",
      statssaAreaCode: "798",
      confirmedAt: new Date(),
    };

    const missing = outstandingFor(blank, {
      disabilityCode: "03",
      consentGivenAt: new Date(),
    });

    expect(missing.map((m) => m.field)).toEqual(["Disability rating"]);
  });
});

describe("what the identity number says about itself", () => {
  /**
   * "The Gender will meet the gender indicator defined in the National ID
   * number" - the specification, on column I. A South African identity number
   * carries the date of birth and the gender inside it, so a mismatch is
   * findable without asking anybody. It usually means a mistyped digit.
   */
  /**
   * Both numbers below are real in shape and pass the Luhn check the NLRD
   * requires, generated with the platform's own `luhnCheckDigit`. An earlier
   * version of this test invented one, and it failed the checksum - which made
   * the first assertion pass for the wrong reason, because the checksum
   * complaint also contains the words "does not match".
   */
  const FEMALE_ID = "9202204720083";
  const MALE_ID = "9202205720082";

  it("notices a gender that disagrees with the identity number", () => {
    const problems = identityDisagreements({
      nationalId: FEMALE_ID,
      dateOfBirth: null,
      gender: "M",
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("gender recorded does not match");
  });

  it("says nothing when they agree", () => {
    expect(
      identityDisagreements({
        nationalId: FEMALE_ID,
        dateOfBirth: null,
        gender: "F",
      }),
    ).toEqual([]);
    expect(
      identityDisagreements({
        nationalId: MALE_ID,
        dateOfBirth: null,
        gender: "M",
      }),
    ).toEqual([]);
  });

  it("notices a date of birth that disagrees with it", () => {
    const problems = identityDisagreements({
      nationalId: FEMALE_ID,
      dateOfBirth: new Date("1993-07-04"),
      gender: "F",
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("1992-02-20");
  });

  it("says the number itself is wrong when the checksum fails", () => {
    const problems = identityDisagreements({
      nationalId: "9202204720082",
      dateOfBirth: null,
      gender: "F",
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("does not check out");
  });

  it("says nothing at all when there is no identity number to check", () => {
    expect(
      identityDisagreements({
        nationalId: null,
        dateOfBirth: null,
        gender: "M",
      }),
    ).toEqual([]);
  });
});

describe("filling the form in", () => {
  it("starts empty, and says what is outstanding rather than failing", async () => {
    const view = await getEnrolmentForm(learner, learner.userId);

    expect(view.profile.homeLanguageCode).toBeNull();
    expect(view.outstanding.length).toBeGreaterThan(5);
    // Said as a person would say it, not as a column name.
    expect(view.outstanding.map((o) => o.field)).toContain("Home language");
    expect(view.outstanding.every((o) => o.why.length > 10)).toBe(true);
  });

  /**
   * A form filled in over two sittings has to be saveable half-done. A
   * coordinator needs to know whose form is short before the twenty-one days
   * run out, not at the moment of submission.
   */
  it("saves a half-finished form without complaint", async () => {
    await saveEnrolmentForm(learner, learner.userId, {
      homeLanguageCode: "Zul",
      cellPhoneNumber: "0820000000",
    });

    const view = await getEnrolmentForm(learner, learner.userId);

    expect(view.profile.homeLanguageCode).toBe("Zul");
    expect(view.outstanding.map((o) => o.field)).toContain("Home address");
  });

  /**
   * Incompleteness is reported; a bad code is refused. They are different
   * things: one is a form in progress, the other is a value that would fail
   * the whole cohort's submission.
   */
  it("refuses a code the QCTO would reject", async () => {
    await expect(
      saveEnrolmentForm(learner, learner.userId, {
        homeLanguageCode: "Zulu",
      }),
    ).rejects.toMatchObject({ reason: "invalid" });
  });

  it("records the POPIA agreement with its date", async () => {
    await saveEnrolmentForm(learner, learner.userId, { popiaAgreed: true });

    const view = await getEnrolmentForm(learner, learner.userId);
    expect(view.learner.consentGivenAt).not.toBeNull();
  });

  /**
   * The date somebody consented is the evidence. Saving the form again must
   * not move it forward, which would quietly rewrite when they agreed.
   */
  it("does not move the consent date on a later save", async () => {
    const before = await getEnrolmentForm(learner, learner.userId);
    await saveEnrolmentForm(learner, learner.userId, { popiaAgreed: true });
    const after = await getEnrolmentForm(learner, learner.userId);

    expect(after.learner.consentGivenAt?.toISOString()).toBe(
      before.learner.consentGivenAt?.toISOString(),
    );
  });

  it("records who confirmed it and when", async () => {
    await saveEnrolmentForm(
      learner,
      learner.userId,
      { homeLanguageCode: "Zul" },
      { confirm: true },
    );

    const view = await getEnrolmentForm(learner, learner.userId);
    expect(view.profile.confirmedAt).not.toBeNull();
    expect(view.profile.confirmedById).toBe(learner.userId);
  });
});

describe("whose form it is", () => {
  it("lets a learner read their own", async () => {
    const view = await getEnrolmentForm(learner, learner.userId);
    expect(view.learner.id).toBe(learner.userId);
  });

  it("does not let a learner read somebody else's", async () => {
    await expect(
      getEnrolmentForm(learner, otherLearner.userId),
    ).rejects.toThrow();
  });

  it("does not let a learner fill in somebody else's", async () => {
    await expect(
      saveEnrolmentForm(learner, otherLearner.userId, {
        homeLanguageCode: "Eng",
      }),
    ).rejects.toThrow();
  });

  it("lets a coordinator read and complete one on a learner's behalf", async () => {
    await saveEnrolmentForm(coordinator, otherLearner.userId, {
      homeLanguageCode: "Afr",
    });

    const view = await getEnrolmentForm(coordinator, otherLearner.userId);
    expect(view.profile.homeLanguageCode).toBe("Afr");
  });
});
