/**
 * Reading a typed date in the provider's order (job sheet D16, Roland and
 * Heidi, 8 October 2026): day first, never the year first.
 */
import { describe, expect, it } from "vitest";
import { orderOf, parseTypedDate } from "@/lib/date-parse";

describe("reading a typed date", () => {
  it("reads numbers day first", () => {
    expect(parseTypedDate("28/10/2026", "dmy")).toBe("2026-10-28");
    expect(parseTypedDate("8-3-2027", "dmy")).toBe("2027-03-08");
    expect(parseTypedDate("08.03.2027", "dmy")).toBe("2027-03-08");
  });

  it("reads a month in words, either way round", () => {
    expect(parseTypedDate("28 October 2026", "dmy")).toBe("2026-10-28");
    expect(parseTypedDate("31 Aug 2027", "dmy")).toBe("2027-08-31");
    expect(parseTypedDate("October 28, 2026", "dmy")).toBe("2026-10-28");
    expect(parseTypedDate("3 Sept 2026", "dmy")).toBe("2026-09-03");
  });

  it("reads the month in the reader's language as well", () => {
    expect(parseTypedDate("28 Oktober 2026", "dmy", "af-ZA")).toBe("2026-10-28");
  });

  it("always reads the stored form", () => {
    expect(parseTypedDate("2026-10-28", "dmy")).toBe("2026-10-28");
  });

  it("reads month first only for a reader whose computer writes dates that way", () => {
    expect(parseTypedDate("10/28/2026", "mdy")).toBe("2026-10-28");
    expect(parseTypedDate("10/28/2026", "dmy")).toBeNull();
    expect(orderOf("en-US")).toBe("mdy");
    expect(orderOf("en-GB")).toBe("dmy");
  });

  it("refuses what is not a date", () => {
    expect(parseTypedDate("31/02/2026", "dmy")).toBeNull();
    expect(parseTypedDate("next Tuesday", "dmy")).toBeNull();
    expect(parseTypedDate("", "dmy")).toBeNull();
  });
});
