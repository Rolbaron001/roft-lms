/**
 * Alignment matrices written as Word tables (Roland, 19 November 2026): read
 * where they can be, never sent back with a request to save them as a
 * spreadsheet, and a matrix for another programme said plainly. Tried on the
 * Word matrix found in SP-260508's folder, which maps curriculum 242401002.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDocxTables, readDocxText } from "@/lib/office";
import { foreignCurriculum } from "@/lib/programme-documents";

const bytes = new Uint8Array(readFileSync(join(__dirname, "fixtures", "SP260508-matrix.docx")));

describe("a Word alignment matrix", () => {
  it("is read as tables, with merged cells kept in their columns", () => {
    const tables = readDocxTables(bytes);
    expect(tables.length).toBe(3);
    expect(tables[1].rows[0]).toHaveLength(3);
    expect(tables[1].rows[0][1]).toMatch(/Associated Internal Assessment Criteria/);
  });

  it("is recognised as another programme's", () => {
    const text = readDocxText(bytes);
    expect(foreignCurriculum(text, "900537-000-00-00")).toBe("242401002");
    expect(foreignCurriculum(text, "242401-002-00-00")).toBeNull();
    expect(foreignCurriculum("KM-01 only", "900537-000-00-00")).toBeNull();
    // Naming its own programme ID does not make it SP-260508's: it does not.
    expect(foreignCurriculum(text, "900537-000-00-00", ["SP-260508"])).toBe("242401002");
  });

  it("is a skills programme's own when it names the programme, though its modules carry the parent's code", () => {
    // SP-220320 (curriculum 900096-000-00-00) is made of 242401001's modules;
    // its alignment document says so and names the programme (Roland, 25 November 2026).
    const own = readDocxText(new Uint8Array(readFileSync(join(__dirname, "fixtures", "SP220320-alignment.docx"))));
    expect(own).toMatch(/242401001-KM-05/);
    expect(foreignCurriculum(own, "900096-000-00-00", ["SP-220320"])).toBeNull();
    // By its curriculum code alone, or by its programme ID alone.
    expect(foreignCurriculum(own, "900096-000-00-00")).toBeNull();
    expect(foreignCurriculum(own.replace(/900096-000-00-00/g, ""), "900096-000-00-00", ["SP-220320"])).toBeNull();
    // Another programme's code and ID: still asked about.
    expect(foreignCurriculum(own, "900537-000-00-00", ["SP-260508"])).toBe("242401001");
  });
});
