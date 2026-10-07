/**
 * Reading a cohort's roll-out schedule (7 October 2026), laid out as Curiosa's
 * 121151 roll-out is: a title block, then a header row with Dates, Lectures,
 * Alignment With Curriculum Modules, WB Handout, WB Submission, WB Feedback
 * and Moderation in the Period; dates as Excel stores them, as day numbers.
 */
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { readRollout } from "@/lib/rollout-import";

function workbook(rows: string[][]): Uint8Array {
  const column = (index: number) => String.fromCharCode(65 + index);
  const xml = rows
    .map((cells, r) => `<row r="${r + 1}">${cells.map((cell, c) => (cell === "" ? "" : /^\d+$/.test(cell) ? `<c r="${column(c)}${r + 1}"><v>${cell}</v></c>` : `<c r="${column(c)}${r + 1}" t="inlineStr"><is><t>${cell}</t></is></c>`)).join("")}</row>`)
    .join("");
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8(`<workbook><sheets><sheet name="RollOut" sheetId="1"/></sheets></workbook>`),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${xml}</sheetData></worksheet>`),
  });
}

// Excel day numbers: 46301 is 2026-10-06.
const day = (offset: number) => String(46301 + offset);

const sheet = workbook([
  ["", "", "", "Training Roll-Out Schedule"],
  [],
  ["", "", "Lecture #", "Dates", "Lectures (Virtual)", "Alignment With Curriculum Modules", "Workplace Experience", "", "WB Handout", "WB Submission", "WB Feedback", "Moderation in the Period"],
  ["", "Month 1", "", day(0), "10:00 to 12:00", "Induction"],
  ["", "", "1", day(7), "09:00 to 15:00", "Study Unit 1 KM1 PM1 WM1", "Workplace Experience Module", "", "SU1 WB1"],
  ["", "", "2", day(14), "09:00 to 15:00", "", "", "", "SU1 WB2", "SU1 WB1"],
  ["", "", "3", day(21), "09:00 to 15:00", "", "", "", "", "SU1 WB2", "SU1 WB1"],
  ["", "", "8", day(56), "09:00 to 15:00", "SU 1 Supervised Summative Assessment", "", "", "", "", "SU1 WB2", "SA1 assessment 2 Dec - 4 Dec"],
]);

describe("a roll-out schedule", () => {
  const read = readRollout(sheet);

  it("finds every dated row, with its time, kind and a title", () => {
    expect(read.rows.map((row) => row.date)).toEqual(["2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27", "2026-12-01"]);
    expect(read.rows[0]).toMatchObject({ kind: "induction", startTime: "10:00", endTime: "12:00" });
    expect(read.rows[2].title).toBe("Lecture 2");
    expect(read.rows[4].kind).toBe("summative");
  });

  it("reads when each workbook is handed out and handed in, and when a unit starts", () => {
    expect(read.handouts.get("SU1 WB1")).toBe("2026-10-13");
    expect(read.submissions.get("SU1 WB1")).toBe("2026-10-20");
    expect(read.submissions.get("SU1 WB2")).toBe("2026-10-27");
    expect(read.unitStarts.get(1)).toBe("2026-10-13");
  });

  it("dates the summative sitting from its written days, in the right year", () => {
    expect(read.summatives.get(1)).toEqual({ opens: "2026-12-02", due: "2026-12-04" });
  });

  it("keeps the feedback dates it has nowhere to put, rather than dropping them unsaid", () => {
    expect(read.unused).toHaveLength(2);
  });
});
