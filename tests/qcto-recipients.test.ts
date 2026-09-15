/**
 * Where a QCTO submission actually goes.
 *
 * Three addresses, taken from Curiosa's own procedures, and the platform knew
 * none of them until the SOP check on 15 September. A workbook that is correct
 * in every cell and sent to the wrong address has not been submitted - and the
 * provider finds out when the acknowledgement never arrives, by which time the
 * twenty-one working days have usually gone.
 */
import { describe, expect, it } from "vitest";
import {
  enrolmentRecipient,
  QCTO_RECIPIENTS,
  recipientIsCertain,
  recipientsFor,
} from "@/lib/qcto-recipients";

describe("the three addresses", () => {
  it("sends a qualification enrolment to the learner enrolments address", () => {
    expect(enrolmentRecipient("full").address).toBe(
      "learnerenrolments@qcto.org.za",
    );
    expect(enrolmentRecipient("part").address).toBe(
      "learnerenrolments@qcto.org.za",
    );
  });

  /**
   * The distinction the enrolment procedure draws, and the whole reason this
   * exists: the same document goes to a different address depending only on
   * what the learners are enrolled on.
   */
  it("sends a skills programme enrolment somewhere else entirely", () => {
    expect(enrolmentRecipient("skills_programme").address).toBe(
      "splearnerenrolments@qcto.org.za",
    );
    expect(enrolmentRecipient("skills_programme").address).not.toBe(
      enrolmentRecipient("full").address,
    );
  });

  it("knows the EISA readiness address, and that results go with it", () => {
    const eisa = QCTO_RECIPIENTS.eisa_readiness;
    expect(eisa.address).toBe("eisareadiness@qcto.org.za");
    expect(eisa.enclose).toContain("statements of results");
  });

  it("names the procedure each address came from", () => {
    for (const recipient of Object.values(QCTO_RECIPIENTS)) {
      expect(recipient.source).toBeTruthy();
      expect(recipient.sends).toBeTruthy();
    }
  });

  it("carries the skills programme's extra obligation", () => {
    // The enrolment procedure also requires two FISA instruments to go to the
    // QCTO for approval, and only for a skills programme.
    expect(QCTO_RECIPIENTS.enrolment_skills_programme.enclose).toContain(
      "Two FISA instruments",
    );
    expect(QCTO_RECIPIENTS.enrolment_qualification.enclose).toBeUndefined();
  });
});

describe("a submission whose kind is not known", () => {
  it("falls back to the commoner address", () => {
    expect(enrolmentRecipient(null).address).toBe(
      "learnerenrolments@qcto.org.za",
    );
  });

  /**
   * And says that it guessed. Quietly picking an address is the failure this
   * file exists to prevent, so the uncertainty is reportable rather than
   * buried.
   */
  it("says that it is a guess", () => {
    expect(recipientIsCertain(null)).toBe(false);
    expect(recipientIsCertain("skills_programme")).toBe(true);
    expect(recipientIsCertain("full")).toBe(true);
  });
});

describe("a submission covering both kinds", () => {
  /**
   * It has no single address, so it has to be split. Better said plainly on
   * the screen than discovered when half a cohort is not registered.
   */
  it("returns both addresses", () => {
    const both = recipientsFor(["full", "skills_programme"]);

    expect(both).toHaveLength(2);
    expect(both.map((r) => r.address).sort()).toEqual([
      "learnerenrolments@qcto.org.za",
      "splearnerenrolments@qcto.org.za",
    ]);
  });

  it("returns one address when every learner is on the same kind", () => {
    expect(recipientsFor(["full", "part", "full"])).toHaveLength(1);
    expect(recipientsFor(["skills_programme", "skills_programme"])).toHaveLength(
      1,
    );
  });

  it("copes with an empty submission", () => {
    expect(recipientsFor([])).toEqual([]);
  });
});
