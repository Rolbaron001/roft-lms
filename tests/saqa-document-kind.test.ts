/**
 * Reading, out of a SAQA registration document, what kind of thing it is and
 * which modules it is made of.
 *
 * The fixtures below are the real documents' own lines, kept verbatim -
 * damage included. Three files that are otherwise the same qualification are
 * broken in two different ways, and both were found by running the parser over
 * the published PDFs rather than by imagining what might go wrong:
 *
 *   118710  "811201-000-00--WM-01"        a doubled hyphen
 *   118711  "811201-000-00-KM-0 1Intro…"  a space inside the number, and the
 *                                          title welded onto what follows
 *
 * Neither is something a provider can have corrected. They are registered
 * documents, published as they stand.
 */
import { describe, expect, it } from "vitest";
import {
  normaliseModuleCode,
  parseQualificationDocument,
} from "@/lib/qualification-document-parse";

/** The header block, which is where the type is read from and nowhere else. */
function header(type: string, saqaId: string, title: string, credits: number) {
  return [
    "All qualifications and part qualifications registered on the National Qualifications Framework are public property.",
    "Thus the only payment that can be made for them is for service and reproduction.",
    "SOUTH AFRICAN QUALIFICATIONS AUTHORITY",
    "REGISTERED QUALIFICATION THAT HAS PASSED THE END DATE:",
    title,
    "SAQA QUAL ID QUALIFICATION TITLE",
    `${saqaId} ${title}`,
    "ORIGINATOR",
    "Development Quality Partner - Services SETA",
    "NQF SUB-FRAMEWORK",
    "- OQSF - Occupational Qualifications Sub-framework",
    "QUALIFICATION",
    "TYPE",
    "FIELD SUBFIELD",
    type,
    "Preventive Health",
    "ABET BAND MINIMUM",
    "CREDITS",
    "NQF LEVEL QUAL CLASS",
    `Undefined ${credits} Not Applicable NQF Level 01 Regular-ELOAC`,
    "PURPOSE AND RATIONALE OF THE QUALIFICATION",
  ].join("\n");
}

const OUTCOMES = [
  "EXIT LEVEL OUTCOMES",
  "1. Plan and prepare to clean a commercial kitchenette.",
  "ASSOCIATED ASSESSMENT CRITERIA",
  "Associated Assessment Criteria for Exit Level Outcome 1:",
  "Cleaning equipment is selected.",
].join("\n");

describe("what the document says it is", () => {
  it("reads a full qualification as full", () => {
    const parsed = parseQualificationDocument(
      [
        header(
          "Occupational Certificate",
          "118709",
          "Occupational Certificate: Commercial Cleaner",
          120,
        ),
        OUTCOMES,
      ].join("\n"),
    );

    expect(parsed.kind).toBe("full");
    expect(parsed.saqaId).toBe("118709");
    expect(parsed.totalCredits).toBe(120);
  });

  it("reads a part qualification as a part", () => {
    const parsed = parseQualificationDocument(
      [
        header(
          "Part-Qualification Field 09 - Health Sciences and Social",
          "118710",
          "Occupational Certificate: Commercial Kitchenette Cleaner",
          47,
        ),
        OUTCOMES,
      ].join("\n"),
    );

    expect(parsed.kind).toBe("part");
    expect(parsed.totalCredits).toBe(47);
  });

  /**
   * The trap this guards. Every SAQA document, a full qualification's
   * included, opens with "All qualifications and part qualifications
   * registered on the National Qualifications Framework are public property",
   * and a part's own prose says "part-qualification" thirty times over. A
   * document-wide search for the phrase would classify 118709 as a part, which
   * would then be given a parent it does not have and a curriculum it does not
   * share.
   */
  it("is not fooled by the copyright boilerplate", () => {
    const parsed = parseQualificationDocument(
      [
        header(
          "Occupational Certificate",
          "118709",
          "Occupational Certificate: Commercial Cleaner",
          120,
        ),
        "The purpose of this qualification is to prepare a learner.",
        "This part-qualification forms part of a suite of related qualifications.",
        OUTCOMES,
      ].join("\n"),
    );

    expect(parsed.kind).toBe("full");
  });
});

describe("which modules it is made up of", () => {
  const RULES = [
    "Knowledge Modules",
    "811201-000-00-KM-01 Introduction to the World of Work, Level 1, 6 Credits.",
    "811201-000-00-KM-04 Commercial Cleaning Equipment, Chemicals and Consumables, Level 1, 5 Credits.",
    "811201-000-00-KM-05 Basics of Cleaning Commercial Kitchenette, Level 1, 5 Credits.",
    "Total number of credits for Knowledge Modules: 16",
    "Practical Skill Modules",
    "811201-000-00-PM-01 Complete Before Shift Duties, Level 1, 3 Credits.",
    "811201-000-00-PM-03 Clean the Commercial Kitchenette, Level 1, 6 Credits.",
    "811201-000-00-PM-07 Check and Confirm Completed Tasks, Level 1, 5 Credits.",
    "Work Experience Modules",
    "811201-000-00--WM-01 Procedures for Completing Before Shift Duties, Level 1, 4 Credits.",
    "811201-000-00-WM-03 Procedures for Cleaning the Commercial Kitchenette, Level 1, 7 Credits",
    "811201-000-00--WM-07 Procedures for Checking and Confirming Completed Tasks, Level 1, 6 Credits.",
  ].join("\n");

  const parsed = parseQualificationDocument(
    [
      header(
        "Part-Qualification Field 09 - Health Sciences and Social",
        "118710",
        "Occupational Certificate: Commercial Kitchenette Cleaner",
        47,
      ),
      OUTCOMES,
      RULES,
    ].join("\n"),
  );

  it("lists exactly the nine 118710 takes", () => {
    expect(parsed.moduleCodes).toEqual([
      "811201-000-00-KM-01",
      "811201-000-00-KM-04",
      "811201-000-00-KM-05",
      "811201-000-00-PM-01",
      "811201-000-00-PM-03",
      "811201-000-00-PM-07",
      "811201-000-00-WM-01",
      "811201-000-00-WM-03",
      "811201-000-00-WM-07",
    ]);
  });

  /** The doubled hyphen, which appears twice in the published 118710. */
  it("reads a code the document mistyped", () => {
    expect(parsed.moduleCodes).toContain("811201-000-00-WM-01");
    expect(parsed.moduleCodes).not.toContain("811201-000-00--WM-01");
  });

  /** 118711's damage: the number split and the title run into it. */
  it("reads a code the extraction broke apart", () => {
    const broken = parseQualificationDocument(
      [
        header(
          "Part-Qualification Field 09 - Health Sciences and Social",
          "118711",
          "Occupational Certificate: Commercial Ablution Cleaner",
          46,
        ),
        OUTCOMES,
        "811201-000-00-KM-0 1Introduction to the World of Work, Level 1, 6 Credits.",
      ].join("\n"),
    );

    expect(broken.moduleCodes).toEqual(["811201-000-00-KM-01"]);
  });

  it("does not list the same module twice", () => {
    const twice = parseQualificationDocument(
      [
        header("Part-Qualification", "118710", "A part", 47),
        OUTCOMES,
        "811201-000-00-KM-01 Introduction to the World of Work, Level 1, 6 Credits.",
        "811201-000-00--KM-01 Introduction to the World of Work, Level 1, 6 Credits.",
      ].join("\n"),
    );

    expect(twice.moduleCodes).toEqual(["811201-000-00-KM-01"]);
  });
});

describe("comparing a code the platform holds with one a document printed", () => {
  it("treats a run of hyphens as one", () => {
    expect(normaliseModuleCode("811201-000-00--WM-01")).toBe(
      "811201-000-00-WM-01",
    );
  });

  it("leaves a well-formed code alone", () => {
    expect(normaliseModuleCode("811201-000-00-KM-01")).toBe(
      "811201-000-00-KM-01",
    );
  });
});
