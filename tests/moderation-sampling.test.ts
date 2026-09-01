/**
 * How much of a cohort must be moderated.
 *
 * The rule is QCTO policy, not a preference, and it is the opposite shape from
 * the one the platform first assumed: a flat percentage. The floor rises as the
 * cohort shrinks, because a percentage that is reasonable for a large cohort
 * stops being evidence of anything on a small one. A quarter of eight scripts
 * is two, and two scripts say almost nothing about an assessor's judgement.
 *
 * "In the case of a cohort of 10 or fewer candidates, all should be moderated;
 * and if 20 or below candidates, 50% should be moderated."
 */
import { describe, expect, it } from "vitest";
import { moderationRateFor } from "@/lib/assessment";

describe("moderationRateFor", () => {
  it("moderates a cohort of ten or fewer in full", () => {
    for (const size of [1, 5, 9, 10]) {
      const result = moderationRateFor({ cohortSize: size, configuredRate: 0.25 });
      expect(result.rate).toBe(1);
      expect(result.reason).toBe("cohort_of_ten_or_fewer");
    }
  });

  it("moderates half of a cohort of eleven to twenty", () => {
    for (const size of [11, 15, 20]) {
      const result = moderationRateFor({ cohortSize: size, configuredRate: 0.25 });
      expect(result.rate).toBe(0.5);
      expect(result.reason).toBe("cohort_of_twenty_or_fewer");
    }
  });

  it("uses the provider's own rate above twenty", () => {
    const result = moderationRateFor({ cohortSize: 21, configuredRate: 0.25 });
    expect(result.rate).toBe(0.25);
    expect(result.reason).toBe("configured_rate");
  });

  /**
   * The policy sets a floor, not a target. A provider that has chosen to
   * moderate more than it requires must not be quietly reduced to the minimum.
   */
  it("keeps a higher configured rate rather than lowering it to the floor", () => {
    const result = moderationRateFor({ cohortSize: 15, configuredRate: 0.8 });
    expect(result.rate).toBe(0.8);
  });

  /**
   * An individual enrolment is not a cohort, and there is no cohort rule to
   * apply to one person. Treating a single learner as "a cohort of one" would
   * force full moderation on every ad-hoc enrolment in the platform.
   */
  it("leaves the configured rate alone when there is no cohort", () => {
    const result = moderationRateFor({ cohortSize: null, configuredRate: 0.25 });
    expect(result.rate).toBe(0.25);
    expect(result.reason).toBe("no_cohort");
  });

  /** The boundaries are the whole rule, so they are stated explicitly. */
  it("puts the boundaries exactly where the policy puts them", () => {
    expect(moderationRateFor({ cohortSize: 10, configuredRate: 0.25 }).rate).toBe(1);
    expect(moderationRateFor({ cohortSize: 11, configuredRate: 0.25 }).rate).toBe(0.5);
    expect(moderationRateFor({ cohortSize: 20, configuredRate: 0.25 }).rate).toBe(0.5);
    expect(moderationRateFor({ cohortSize: 21, configuredRate: 0.25 }).rate).toBe(0.25);
  });
});
