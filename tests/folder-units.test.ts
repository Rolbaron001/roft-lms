/**
 * A sub-folder named for a study unit (job sheet D60 stage 2, 24 November
 * 2026): the clearest signal a provider can give, and until then not read.
 */
import { describe, expect, it } from "vitest";
import { classifyDocument, studyUnitFromFolder } from "@/lib/folder-plan";

describe("a study unit from the folder a file sits in", () => {
  it("reads the common ways of naming a unit's folder", () => {
    expect(studyUnitFromFolder("Programme/SU2/Workbook.docx")).toBe("SU2");
    expect(studyUnitFromFolder("Programme/SU 3 Research/Guide.docx")).toBe("SU3");
    expect(studyUnitFromFolder("Programme/Study Unit 4/Guide.docx")).toBe("SU4");
    expect(studyUnitFromFolder("Programme/Unit 05/Guide.docx")).toBe("SU5");
    expect(studyUnitFromFolder("Programme/Part B/Workbook.docx")).toBe("SU2");
    expect(studyUnitFromFolder("Programme/Part C - Application/Workbook.docx")).toBe("SU3");
  });

  it("takes the nearest folder, and names no unit from folders that are not one", () => {
    expect(studyUnitFromFolder("SU1/Extra/SU2/Workbook.docx")).toBe("SU2");
    expect(studyUnitFromFolder("Learning Material/Workbook.docx")).toBeNull();
    expect(studyUnitFromFolder("Unit Standards/Workbook.docx")).toBeNull();
    expect(studyUnitFromFolder("Particulars/Workbook.docx")).toBeNull();
    expect(studyUnitFromFolder("Workbook.docx")).toBeNull();
  });

  it("files a document by its folder, but the file's own name comes first", () => {
    const byFolder = classifyDocument("SU2/Formative Workbook.docx", "Formative Workbook.docx", 1);
    expect([byFolder.studyUnitCode, byFolder.source]).toEqual(["SU2", "folder"]);
    const byName = classifyDocument("SU2/CA 121151 SU3 WB1.docx", "CA 121151 SU3 WB1.docx", 1);
    expect([byName.studyUnitCode, byName.source]).toEqual(["SU3", "name"]);
  });

  it("never places the programme's own documents in a unit by their folder", () => {
    const curriculum = classifyDocument("SU1/SP Curr - Assessment Practitioner.pdf", "SP Curr - Assessment Practitioner.pdf", 1);
    expect(curriculum.studyUnitCode).toBeNull();
  });
});
