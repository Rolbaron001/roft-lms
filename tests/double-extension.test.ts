/**
 * A file saved as "SU2 WB1.docx.docx" (121151, Roland, 13 October 2026): the
 * doubled ending stopped the workbook being read as workbook 1, so it did not
 * pair with its answer guide and was read without its answers.
 */
import { describe, expect, it } from "vitest";
import { bareFilename, classifyFilename } from "@/lib/naming-convention";
import { chooseGuide, versionOf } from "@/lib/capture-from-documents";

describe("a filename with more than one ending", () => {
  it("loses every ending", () => {
    expect(bareFilename("CA 121151 SU2 WB1.docx.docx")).toBe("CA 121151 SU2 WB1");
    expect(bareFilename("Guide.pdf.docx")).toBe("Guide");
    expect(bareFilename("CA 121151 SU2 WB2.docx")).toBe("CA 121151 SU2 WB2");
    expect(bareFilename("archive.zip")).toBe("archive");
  });

  it("reads as the same workbook as its guide", () => {
    const paper = classifyFilename("CA 121151 SU2 WB1.docx.docx");
    const guide = classifyFilename("CA 121151 SU2 WB1 AG.docx.docx");
    expect([paper.studyUnit, paper.artefact, paper.number, paper.isMemorandum]).toEqual(["SU2", "workbook", "1", false]);
    expect([guide.studyUnit, guide.artefact, guide.number, guide.isMemorandum]).toEqual(["SU2", "workbook", "1", true]);
  });

  it("still reads a version", () => {
    expect(versionOf("CA 121151 SU5 SA5 V2.docx.docx")).toBe("2");
    expect(chooseGuide("CA 121151 SU2 WB1.docx.docx", [{ filename: "CA 121151 SU2 WB1 AG.docx.docx" }])).toEqual({
      filename: "CA 121151 SU2 WB1 AG.docx.docx",
    });
  });
});
