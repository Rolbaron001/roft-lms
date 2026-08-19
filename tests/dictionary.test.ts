import { describe, expect, it } from "vitest";
import {
  dictionaryProblems,
  getDictionary,
  lookup,
  searchDictionary,
} from "@/lib/dictionary";

/**
 * The dictionary exists to settle terminology, so the data itself is what is
 * worth testing: an entry that contradicts another, or cross-refers to a term
 * that was renamed, defeats the purpose of having it.
 */
describe("the dictionary", () => {
  const dictionary = getDictionary();

  it("is internally consistent", () => {
    expect(dictionaryProblems()).toEqual([]);
  });

  it("carries enough terms to be useful", () => {
    expect(dictionary.entries.length).toBeGreaterThan(50);
  });

  it("names the authority on every term an authority owns", () => {
    const byAuthority = dictionary.entries.filter(
      (entry) => entry.definedBy === "authority",
    );
    expect(byAuthority.length).toBeGreaterThan(20);
    for (const entry of byAuthority) {
      expect(entry.authority, entry.term).toBeTruthy();
    }
  });

  it("claims no authority for the words this platform invented", () => {
    // The whole point of the definedBy field: if these ever gain an
    // authority, somebody has mistaken our vocabulary for a requirement.
    for (const term of [
      "Study Unit",
      "Readiness Index",
      "Workplace Coach",
      "EISA Eligible",
      "Tenant",
    ]) {
      const entry = lookup(term);
      expect(entry, term).toBeDefined();
      expect(entry!.definedBy, term).toBe("platform");
      expect(entry!.authority, term).toBeUndefined();
    }
  });

  it("finds a term by its abbreviation", () => {
    expect(lookup("EISA")?.term).toBe(
      "External Integrated Summative Assessment",
    );
    expect(lookup("poe")?.term).toBe("Portfolio of Evidence");
  });

  it("leads a search with the term rather than mentions of it", () => {
    expect(searchDictionary("logbook")[0]?.term).toBe("Logbook");
    expect(searchDictionary("moderation")[0]?.term).toBe("Moderation");
  });

  it("returns everything for an empty search", () => {
    expect(searchDictionary("   ")).toHaveLength(dictionary.entries.length);
  });

  it("reports the faults it is meant to catch", () => {
    const broken = {
      ...dictionary,
      entries: [
        {
          term: "Aardvark",
          category: "nowhere",
          definedBy: "authority" as const,
          definition: "An entry with every fault.",
          seeAlso: ["Nothing At All"],
        },
      ],
    };
    const problems = dictionaryProblems(broken);
    expect(problems).toContain('Aardvark: undeclared category "nowhere"');
    expect(problems).toContain(
      'Aardvark: definedBy "authority" but none named',
    );
    expect(problems).toContain(
      'Aardvark: see also "Nothing At All" does not exist',
    );
  });
});
