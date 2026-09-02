import { describe, expect, it } from "vitest";
import { readJson, knownProviders, providerByName } from "@/lib/extensions";
import { isAllowedRoot } from "@/lib/ai-import";

describe("readJson", () => {
  it("reads a bare object", () => {
    expect(readJson<{ ok: boolean }>('{"ok":true}')).toEqual({ ok: true });
  });

  /**
   * Verified against the real provider, which fenced its reply on the very
   * first call despite being told not to. A strict parser would have turned a
   * correct answer into a failed run.
   */
  it("reads one wrapped in a code fence", () => {
    const answer = '```json\n{"ok":true,"who":"lms"}\n```';
    expect(readJson<{ who: string }>(answer)).toEqual({
      ok: true,
      who: "lms",
    });
  });

  it("reads one with a sentence in front of it", () => {
    const answer = 'Here is the qualification:\n{"title":"Something"}';
    expect(readJson<{ title: string }>(answer)).toEqual({
      title: "Something",
    });
  });

  it("returns null rather than throwing on prose", () => {
    expect(readJson("I could not find a curriculum document.")).toBeNull();
    expect(readJson("")).toBeNull();
  });

  it("returns null on JSON that is truncated", () => {
    expect(readJson('{"modules":[{"code":"KM-01"')).toBeNull();
  });
});

/**
 * "Point it at a folder", given to a server process, otherwise means "read any
 * file the service account can reach" - which on the production server
 * includes the platform's own configuration.
 */
describe("isAllowedRoot", () => {
  const roots = ["/srv/qualifications", "/srv/intake"];

  it("allows a root itself", () => {
    expect(isAllowedRoot("/srv/qualifications", roots)).toBe(true);
  });

  it("allows a folder inside one", () => {
    expect(isAllowedRoot("/srv/qualifications/hrm-2026", roots)).toBe(true);
  });

  it("refuses anything outside", () => {
    expect(isAllowedRoot("/etc", roots)).toBe(false);
    expect(isAllowedRoot("/srv", roots)).toBe(false);
  });

  /**
   * The one that matters. A path that climbs out with `..` resolves to
   * somewhere else entirely, and comparing the strings as typed would let it
   * through.
   */
  it("refuses a path that climbs out", () => {
    expect(isAllowedRoot("/srv/qualifications/../../etc", roots)).toBe(false);
  });

  /**
   * A neighbouring folder whose name merely starts with an allowed one is not
   * inside it. "/srv/intake-private" is not under "/srv/intake".
   */
  it("refuses a sibling with a similar name", () => {
    expect(isAllowedRoot("/srv/intake-private", roots)).toBe(false);
  });

  /** Nothing allowed means nothing readable, which is the safe default. */
  it("refuses everything when no roots are set", () => {
    expect(isAllowedRoot("/srv/qualifications", [])).toBe(false);
  });
});

describe("the provider registry", () => {
  it("knows the subscription-backed provider", () => {
    const provider = providerByName("claude_code");
    expect(provider).not.toBeNull();
    expect(provider?.label).toContain("subscription");
  });

  it("returns nothing for a name it does not know", () => {
    expect(providerByName("some_other_model")).toBeNull();
    expect(providerByName(null)).toBeNull();
  });

  /**
   * No provider may carry a credential. The subscription-backed one holds its
   * own sign-in on the machine it runs on, and the platform never sees one -
   * there is no field for it and no column for it.
   */
  it("exposes no credential anywhere on a provider", () => {
    for (const provider of knownProviders()) {
      const keys = Object.keys(provider);
      expect(keys).not.toContain("apiKey");
      expect(keys).not.toContain("token");
      expect(keys).not.toContain("credential");
    }
  });
});
