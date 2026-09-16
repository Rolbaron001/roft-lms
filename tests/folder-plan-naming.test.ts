/**
 * A provider's own filenames, and why getting them wrong is not cosmetic.
 *
 * Curiosa's 121151 folder — the one Heidi uploaded during the failed test —
 * names its material the way a provider actually does: "CA 121151 SU1 WB1.docx"
 * for workbook one, "CA 121151 SU1 SA1 V1 AG.docx" for summative assessment
 * one, version one, answer guide. The rules only knew the spelled-out words, so
 * 66 of their 81 files were filed as "other".
 *
 * That is a confidentiality failure rather than an untidiness. A workbook
 * memorandum, a summative memorandum and a summative assessment are withheld
 * from anybody without the permission to assess. "Other" is not withheld from
 * anybody. Filing an answer guide as "other" hands it to the learners it is
 * the answer key for — and it would have happened silently, on upload, to
 * thirty-eight documents.
 *
 * The filenames below are real, taken from the folder as supplied.
 */
import { describe, expect, it } from "vitest";
import { classifyDocument, versionFromName } from "@/lib/folder-plan";

function kindOf(path: string): string | null {
  const filename = path.split("/").pop()!;
  return classifyDocument(path, filename, 1024).kind;
}

describe("the answer guides, which must not reach a learner", () => {
  /**
   * The pairing is the trap: "WB1 AG" contains "WB1", so a rule for the
   * workbook placed first would claim the answer guide and file it as the
   * workbook itself — visible to everybody.
   */
  it("tells a workbook's answer guide from the workbook", () => {
    expect(kindOf("Study Unit 1/CA 121151 SU1 WB1.docx")).toBe("workbook");
    expect(kindOf("Study Unit 1/CA 121151 SU1 WB1 AG.docx")).toBe(
      "workbook_memorandum",
    );
  });

  it("tells a summative's answer guide from the assessment", () => {
    expect(kindOf("Study Unit 1/CA 121151 SU1 SA1 V1.docx")).toBe(
      "summative_assessment",
    );
    expect(kindOf("Study Unit 1/CA 121151 SU1 SA1 V1 AG.docx")).toBe(
      "summative_memorandum",
    );
  });

  it("does not leave either as something unrestricted", () => {
    // The three restricted kinds, named here so that a change to the rules
    // that quietly demotes one of them fails.
    const restricted = new Set([
      "workbook_memorandum",
      "summative_memorandum",
      "summative_assessment",
    ]);

    for (const path of [
      "Study Unit 2/CA 121151 SU2 WB1 AG.docx.docx",
      "Study Unit 2/CA 121151 SU2 SA2 V2 AG.docx",
      "Study Unit 3/CA 121151 SU3 SA3 V1.docx",
    ]) {
      expect(restricted.has(kindOf(path) ?? "")).toBe(true);
    }
  });
});

describe("the rest of the folder", () => {
  it("recognises the spelled-out names it always did", () => {
    expect(kindOf("Study Unit 1/CA 121151 - SU 1 Theory Guide.docx")).toBe(
      "theory_guide",
    );
    expect(kindOf("Study Unit 1/CA 121151 - WEM1 SignOff .docx")).toBe(
      "workplace_signoff",
    );
    expect(kindOf("Base ID Docs/121151 Curriculum Document.pdf")).toBe(
      "curriculum_document",
    );
  });

  /**
   * Curiosa call theirs "KM PM ELO Alignment", not "alignment matrix". It is
   * the document that drives what covers each topic element, so filing it as
   * "other" left every element showing nothing covering it while the answer
   * sat in the same folder.
   */
  it("recognises an alignment matrix that does not say matrix", () => {
    expect(kindOf("CA - 121151 - KM PM ELO Alignment.docx")).toBe(
      "alignment_matrix",
    );
  });

  /**
   * Reference material a provider keeps alongside its own. Guessing a kind for
   * these would be worse than admitting it does not know: they are somebody
   * else's documents, and "other" is the honest answer.
   */
  it("still says it does not know, rather than guessing", () => {
    expect(kindOf("CCMA Practice and Procedure Manual 7 th Edition.pdf")).toBe(
      "other",
    );
    expect(kindOf("Study Unit 2/SABPP - Fact-Sheet_February-2019.pdf")).toBe(
      "other",
    );
    // TM and WP are abbreviations nobody has explained. Left alone.
    expect(kindOf("Study Unit 2/HRM Officer SU2 TM.pdf")).toBe("other");
  });
});

describe("the version, which they keep two of", () => {
  /**
   * Two versions of each summative sit side by side, which is how a provider
   * avoids handing the same paper to a cohort twice. Without the version they
   * arrive as two documents of the same kind with the same title, which reads
   * as a duplicate upload.
   */
  it("is read off the filename", () => {
    expect(versionFromName("CA 121151 SU1 SA1 V1.docx")).toBe("V1");
    expect(versionFromName("CA 121151 SU1 SA1 V2 AG.docx")).toBe("V2");
  });

  it("is null where there is none, rather than invented", () => {
    expect(versionFromName("CA 121151 SU1 WB1.docx")).toBeNull();
  });

  it("reaches the planned document", () => {
    const planned = classifyDocument(
      "Study Unit 1/CA 121151 SU1 SA1 V2.docx",
      "CA 121151 SU1 SA1 V2.docx",
      2048,
    );
    expect(planned.version).toBe("V2");
    expect(planned.studyUnitCode).toBe("SU1");
  });
});
