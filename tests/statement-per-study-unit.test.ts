/**
 * Statements of Results issued for one study unit rather than a whole
 * qualification, and the accreditation number that goes on them.
 *
 * Curiosa issues a statement after each study unit. That was raised against
 * them at a monitoring visit and written into their own procedures afterwards,
 * so a platform that can only issue at the end of a qualification cannot
 * follow the procedure it exists to support.
 *
 * The risk in adding it is not that the new form fails loudly. It is that the
 * narrowing leaks: a study unit statement that quietly confirms modules
 * belonging to a different unit says a learner has achieved something nobody
 * assessed. Most of what follows tests the boundary rather than the feature.
 */
import { describe, expect, it } from "vitest";
import { describeAccreditation } from "@/lib/accreditation";

// The issuing path itself is tested in eisa.test.ts, where a learner can
// actually be taken through a curriculum. What is here is the rule that
// decides which number a report prints, which is worth stating on its own
// because it is the part that is silently wrong rather than broken.

describe("describeAccreditation", () => {
  /**
   * The qualification's own number wins wherever it is set. An accreditation
   * letter covers several qualifications and a provider holds more than one
   * letter, so the provider's number is a fallback, not an equivalent.
   */
  it("prefers the qualification's number over the provider's", () => {
    const result = describeAccreditation("QUAL-123", "PROV-999");
    expect(result.number).toBe("QUAL-123");
    expect(result.source).toBe("qualification");
    expect(result.label).toBe("QUAL-123");
  });

  /**
   * Falling back is allowed; falling back silently is not. A moderator
   * checking the number against an accreditation letter has to be able to see
   * that this is the provider's number standing in.
   */
  it("marks the provider's number as a stand-in when it falls back", () => {
    const result = describeAccreditation(null, "PROV-999");
    expect(result.number).toBe("PROV-999");
    expect(result.source).toBe("provider");
    expect(result.label).toContain("provider accreditation");
  });

  it("says so plainly when there is no accreditation at all", () => {
    const result = describeAccreditation(null, null);
    expect(result.number).toBeNull();
    expect(result.source).toBe("none");
    expect(result.label).toBe("Not accredited");
  });
});
