/**
 * The default programme matrix (job sheet D60 stage 3, 24 November 2026):
 * written from a map, read back from a folder, and applied over what the
 * readers found.
 */
import { describe, expect, it } from "vitest";
import type { IngestionPlan } from "@/lib/folder-plan";
import { mapOf } from "@/lib/programme-map";
import { applyMatrix, MATRIX_MARKER, readMatrix, writeMatrix } from "@/lib/programme-matrix";
import { readXlsxSheets } from "@/lib/office";

const plan = (): IngestionPlan => ({
  source: "filing",
  qualification: { title: "Assessment Practitioner", saqaId: null, curriculumCode: "900096-000-00-00", nqfLevel: null, credits: null, purpose: null },
  modules: [],
  studyUnits: [
    { code: "SU1", title: "Orientation" },
    { code: "SU2", title: "Principles" },
  ],
  documents: [
    { path: "P/Formative_Workbook_Part_A.docx", filename: "Formative_Workbook_Part_A.docx", bytes: 1, target: "qualification", kind: "workbook", category: null, studyUnitCode: null, title: "Formative Workbook Part A", version: null, because: "" },
    { path: "P/Guide A.docx", filename: "Guide A.docx", bytes: 1, target: "qualification", kind: "other", category: null, studyUnitCode: null, title: "Guide A", version: null, because: "" },
    { path: "P/Old draft.docx", filename: "Old draft.docx", bytes: 1, target: "qualification", kind: "other", category: null, studyUnitCode: null, title: "Old draft", version: null, because: "" },
    { path: "P/Notes.docx", filename: "Notes.docx", bytes: 1, target: "study_unit", kind: "theory_guide", category: null, studyUnitCode: "SU2", title: "Notes", version: null, because: "" },
    { path: "P/Programme map.xlsx", filename: "Programme map.xlsx", bytes: 1, target: "qualification", kind: "other", category: null, studyUnitCode: null, title: "Programme map", version: null, because: "" },
  ],
  warnings: [],
});

describe("the default programme matrix", () => {
  it("is written as a spreadsheet the platform reads back as its own", async () => {
    const bytes = await writeMatrix(plan(), { title: "Assessment Practitioner", code: "900096-000-00-00" });
    const sheets = readXlsxSheets(bytes);
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Files", "Study units", "About"]);
    expect(sheets[2].rows[0][0]).toBe(MATRIX_MARKER);
    expect(readMatrix(bytes)?.map((row) => row.filename)).toContain("Formative_Workbook_Part_A.docx");
  });

  it("is not mistaken for some other spreadsheet", () => {
    expect(readMatrix(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("places, pairs and leaves out as it says, and the map is then settled", async () => {
    // A person's corrections, as they would type them into the spreadsheet.
    const corrected = plan();
    corrected.documents[0].studyUnitCode = "SU1";
    corrected.documents[0].guidePath = "P/Guide A.docx";
    corrected.documents[1].kind = "workbook_memorandum";
    corrected.documents[1].studyUnitCode = "SU1";
    corrected.documents[2].ignored = true;
    corrected.documents[3].also = ["SU1"];
    const rows = readMatrix(await writeMatrix(corrected, { title: "T", code: null }))!;

    // A fresh reading of the same folder, with the matrix applied over it.
    const fresh = plan();
    const notes = applyMatrix(fresh, rows, "P/Programme map.xlsx");
    expect(notes).toEqual([]);
    const [workbook, guide, draft, notesDoc] = fresh.documents;
    expect([workbook.studyUnitCode, workbook.guidePath]).toEqual(["SU1", "P/Guide A.docx"]);
    expect([guide.kind, guide.studyUnitCode]).toEqual(["workbook_memorandum", "SU1"]);
    expect(draft.ignored).toBe(true);
    expect(notesDoc.also).toEqual(["SU1"]);
    fresh.documents[4].ignored = true;
    expect(mapOf(fresh).ready).toBe(true);
  });

  it("says when a row names a file not in the folder, or a unit the programme lacks", () => {
    const fresh = plan();
    const notes = applyMatrix(
      fresh,
      [
        { filename: "Missing.docx", kind: "workbook", unit: "SU1", also: [], guide: null, leaveOut: false },
        { filename: "Notes.docx", kind: "theory_guide", unit: "SU9", also: [], guide: null, leaveOut: false },
      ],
      "P/Programme map.xlsx",
    );
    expect(notes.join(" ")).toMatch(/lists "Missing.docx", which is not in the folder/);
    expect(notes.join(" ")).toMatch(/puts "Notes.docx" in SU9, which this programme does not have/);
    expect(notes.join(" ")).toMatch(/3 files are not in the programme map/);
  });
});
