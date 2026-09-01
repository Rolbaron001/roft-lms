/**
 * What a learner has to produce before they are registered.
 *
 * The rules here are pure, so they are tested directly. Two of them decide
 * whether a statutory return goes out with a hole in it.
 *
 * The first is that the route decides the list. The client's procedure differs
 * between a standard qualification and recognition of prior learning, and the
 * difference is not cosmetic: an RPL candidate has no certificate to certify,
 * because the whole claim is that the learning happened outside a formal
 * programme.
 *
 * The second is expiry. A certified copy goes stale, so a requirement that was
 * satisfied in March is not satisfied in July without anybody having touched
 * it. Treating "no date" as acceptable is the specific mistake that puts an
 * undateable copy into a return.
 */
import { describe, expect, it } from "vitest";
import {
  CERTIFICATION_VALID_DAYS,
  certificationExpired,
  requiredDocuments,
} from "@/lib/enrolment-documents";

describe("requiredDocuments", () => {
  it("asks a standard enrolment for identity, qualification and CV", () => {
    expect(requiredDocuments("standard_qualification")).toEqual([
      "certified_id",
      "highest_qualification",
      "cv",
    ]);
  });

  /**
   * The one that would be wrong if the list were shared. An RPL candidate is
   * claiming competence gained outside a formal programme, so demanding a
   * certified copy of a qualification asks them to prove the opposite of their
   * case.
   */
  it("does not ask an RPL candidate for a qualification certificate", () => {
    const required = requiredDocuments("rpl");
    expect(required).not.toContain("highest_qualification");
    expect(required).toContain("rpl_portfolio");
  });

  it("asks a learnership for its agreement as well", () => {
    expect(requiredDocuments("learnership")).toContain("learnership_agreement");
  });

  it("keeps an employment equity enrolment to what that route needs", () => {
    expect(requiredDocuments("employment_equity")).toEqual([
      "certified_id",
      "employment_equity_form",
    ]);
  });

  /** Callers get their own copy; editing it must not change the rule. */
  it("cannot be edited by a caller", () => {
    const first = requiredDocuments("standard_qualification");
    first.push("other");
    expect(requiredDocuments("standard_qualification")).not.toContain("other");
  });
});

describe("certificationExpired", () => {
  const asAt = new Date("2026-09-01T00:00:00Z");

  it("accepts a copy certified recently", () => {
    expect(certificationExpired("certified_id", "2026-08-01", asAt)).toBe(false);
  });

  it("rejects one certified beyond the window", () => {
    expect(certificationExpired("certified_id", "2026-01-01", asAt)).toBe(true);
  });

  it("puts the boundary where the convention puts it", () => {
    const justInside = new Date(asAt);
    justInside.setUTCDate(justInside.getUTCDate() - CERTIFICATION_VALID_DAYS);
    const onTheDay = justInside.toISOString().slice(0, 10);
    expect(certificationExpired("certified_id", onTheDay, asAt)).toBe(false);

    const dayBefore = new Date(justInside);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    expect(
      certificationExpired("certified_id", dayBefore.toISOString().slice(0, 10), asAt),
    ).toBe(true);
  });

  /**
   * The mistake worth guarding. A copy nobody dated cannot be shown to be
   * current, and treating unknown as acceptable is exactly how an expired one
   * reaches a statutory return.
   */
  it("treats an undated certified copy as expired, not as acceptable", () => {
    expect(certificationExpired("certified_id", null, asAt)).toBe(true);
  });

  it("treats an unreadable date as expired rather than guessing", () => {
    expect(certificationExpired("certified_id", "not a date", asAt)).toBe(true);
  });

  /** A CV is not a certified copy, so none of this applies to it. */
  it("does not expire something that was never certified", () => {
    expect(certificationExpired("cv", null, asAt)).toBe(false);
    expect(certificationExpired("cv", "2020-01-01", asAt)).toBe(false);
    expect(certificationExpired("rpl_portfolio", null, asAt)).toBe(false);
  });
});
