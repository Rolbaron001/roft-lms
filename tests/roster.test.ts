import { describe, expect, it } from "vitest";
import {
  detectColumns,
  findHeaderRow,
  readRows,
  type ColumnMap,
} from "@/lib/roster";

describe("detectColumns", () => {
  it("recognises the headings a platform would choose", () => {
    const { mapping } = detectColumns([
      "First Name",
      "Last Name",
      "Email",
      "Identity Number",
    ]);

    expect(mapping.firstName).toBe(0);
    expect(mapping.lastName).toBe(1);
    expect(mapping.email).toBe(2);
    expect(mapping.nationalId).toBe(3);
  });

  /**
   * The reason this is rules rather than an exact match. Every client's
   * spreadsheet is different, and insisting on one set of headings makes
   * somebody retype a file they already have.
   */
  it("recognises the headings people actually write", () => {
    const { mapping } = detectColumns([
      "Surname",
      "Voornaam",
      "E-Mail Address",
      "SA ID No",
      "Department",
      "Designation",
    ]);

    expect(mapping.lastName).toBe(0);
    expect(mapping.firstName).toBe(1);
    expect(mapping.email).toBe(2);
    expect(mapping.nationalId).toBe(3);
    expect(mapping.team).toBe(4);
    expect(mapping.jobTitle).toBe(5);
  });

  /**
   * "Identity number" has to be tested before anything matching "number", and
   * "first name" before a bare "name". Order is load-bearing.
   */
  it("does not let a general pattern take a specific column", () => {
    const { mapping } = detectColumns(["Employee Number", "ID Number"]);
    expect(mapping.nationalId).toBe(1);
  });

  it("never maps two fields to the same column", () => {
    const { mapping } = detectColumns(["Name", "First Name"]);
    const used = Object.values(mapping);
    expect(new Set(used).size).toBe(used.length);
  });

  it("reports headings it does not recognise rather than guessing", () => {
    const { unmatched, mapping } = detectColumns([
      "First Name",
      "Last Name",
      "Email",
      "Cost Centre",
      "Bursary Ref",
    ]);

    expect(mapping.firstName).toBe(0);
    expect(unmatched.map((column) => column.heading)).toEqual([
      "Cost Centre",
      "Bursary Ref",
    ]);
  });

  it("says which fields nothing was found for", () => {
    const { missing } = detectColumns(["First Name", "Last Name", "Email"]);
    expect(missing).toContain("nationalId");
    expect(missing).not.toContain("firstName");
  });
});

describe("findHeaderRow", () => {
  it("finds the header where it is the first row", () => {
    expect(findHeaderRow([["First Name", "Surname", "Email"], ["A", "B", "c@d.e"]])).toBe(0);
  });

  /**
   * A file exported from a reporting tool carries a title and a blank row
   * above the header, and treating row 1 as the header reads the title as
   * column names and every real row as data one line out.
   */
  it("finds it under a title and a blank row", () => {
    const rows = [
      ["Cohort 28 January 2026 - Learner List"],
      [],
      ["First Name", "Surname", "Email"],
      ["Jan", "Mokoena", "jan@example.test"],
    ];
    expect(findHeaderRow(rows)).toBe(2);
  });

  it("falls back to the first row when nothing matches", () => {
    expect(findHeaderRow([["a", "b"], ["c", "d"]])).toBe(0);
  });
});

describe("readRows", () => {
  const mapping: ColumnMap = { firstName: 0, lastName: 1, email: 2, nationalId: 3 };

  it("reads a good row with no problems", () => {
    const [row] = readRows(
      [["Jan", "Mokoena", "Jan@Example.TEST", "8001015009087"]],
      mapping,
    );

    expect(row.values.firstName).toBe("Jan");
    expect(row.values.email).toBe("jan@example.test");
    expect(row.problems).toEqual([]);
    expect(row.line).toBe(2);
  });

  /**
   * Nothing is rejected outright. The useful thing to know is which eight of
   * ninety rows need fixing, not that the file "failed".
   */
  it("keeps a row that is missing something and says what", () => {
    const [row] = readRows([["Jan", "", "jan@example.test", ""]], mapping);
    expect(row.values.firstName).toBe("Jan");
    expect(row.problems.join(" ")).toMatch(/surname/i);
  });

  it("catches an address that is not one", () => {
    const [row] = readRows([["Jan", "Mokoena", "jan at example", ""]], mapping);
    expect(row.problems.join(" ")).toMatch(/not an email address/i);
  });

  /**
   * A duplicated address in one file would create one person and silently drop
   * the other, which reads as a successful import that lost somebody.
   */
  it("catches the same address twice in one file", () => {
    const rows = readRows(
      [
        ["Jan", "Mokoena", "same@example.test", ""],
        ["Thandi", "Nkosi", "same@example.test", ""],
      ],
      mapping,
    );

    expect(rows[0].problems).toEqual([]);
    expect(rows[1].problems.join(" ")).toMatch(/more than once/i);
  });

  it("numbers rows as the spreadsheet does, so a problem can be pointed at", () => {
    const rows = readRows(
      [
        ["Jan", "Mokoena", "a@b.test", ""],
        ["Thandi", "Nkosi", "c@d.test", ""],
      ],
      mapping,
      5,
    );
    expect(rows.map((row) => row.line)).toEqual([5, 6]);
  });
});

describe("line numbers", () => {
  /**
   * A report that points at the wrong line is worse than one giving no line at
   * all. Dropping blank rows on the way in would shift every number after the
   * gap, so blanks are kept in the grid and skipped when rows are read.
   */
  it("skips an empty row without shifting the numbering", () => {
    const mapping: ColumnMap = { firstName: 0, lastName: 1, email: 2 };
    const rows = readRows(
      [
        ["Jan", "Mokoena", "a@b.test"],
        ["", "", ""],
        ["Thandi", "Nkosi", "c@d.test"],
      ],
      mapping,
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].line).toBe(2);
    // Line 3 was blank; Thandi is on line 4 of the file and says so.
    expect(rows[1].line).toBe(4);
    expect(rows[1].values.firstName).toBe("Thandi");
  });

  it("does not report a blank row as a person missing a name", () => {
    const mapping: ColumnMap = { firstName: 0, lastName: 1, email: 2 };
    const rows = readRows([["", "", ""]], mapping);
    expect(rows).toEqual([]);
  });
});
