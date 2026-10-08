/**
 * Reading a meeting's attendance export into a register (job sheet D20). The
 * layouts are those in Curiosa's cohort folder of 8 October 2026; the names
 * here are invented.
 */
import { describe, expect, it } from "vitest";
import { matchAttendance, readAttendanceExport } from "@/lib/attendance-import";

const csv = (text: string) => new TextEncoder().encode(text);

const learners = [
  { userId: "a", firstName: "Thandi", lastName: "Nkosi", email: "thandi@example.test" },
  { userId: "b", firstName: "Pieter", lastName: "van Wyk", email: "pieter@example.test" },
  { userId: "c", firstName: "Ayanda", lastName: "Dube", email: null },
];

describe("an attendance export", () => {
  it("reads the Meet attendance add-on's CSV, with its blank line under the headings", () => {
    const people = readAttendanceExport(
      "Attendance Report - abc (4-Aug-2026).csv",
      csv("SNo,Participant Name,Attendance Started at,Joined at(beta),Attendance Stopped at,Attended Duration,Meeting code\n,,,,,,\n1,THANDI NKOSI,18:42:56,18:42:57,20:04:51,1 hr 21 min 53s,abc\n2,The Facilitator,18:40:00,18:40:00,20:05:00,1 hr 25 min,abc\n"),
    );
    expect(people.map((one) => one.name)).toEqual(["THANDI NKOSI", "The Facilitator"]);
    expect(people[0].duration).toBe("1 hr 21 min 53s");
  });

  it("reads Meet's own layout, and first and last names in separate columns", () => {
    expect(readAttendanceExport("meeting.csv", csv("Full Name,First Seen,Time in Call\nAyanda Dube,18:30,2 hr\n"))[0]).toEqual({ name: "Ayanda Dube", email: null, duration: "2 hr" });
    expect(readAttendanceExport("meeting.csv", csv("First name,Last name,Email,Duration\nPieter,van Wyk,PIETER@example.test,90 min\n"))[0]).toEqual({ name: "Pieter van Wyk", email: "pieter@example.test", duration: "90 min" });
  });

  it("matches by email, or by every part of the name in any order and case", () => {
    const { present, unknown } = matchAttendance(
      [
        { name: "Someone Else", email: "pieter@example.test", duration: null },
        { name: "NKOSI, Thandi", email: null, duration: "1 hr" },
        { name: "The Facilitator", email: null, duration: null },
      ],
      learners,
    );
    expect(present).toEqual([
      { userId: "b", duration: null },
      { userId: "a", duration: "1 hr" },
    ]);
    expect(unknown).toEqual(["The Facilitator"]);
  });

  it("does not match half a name, or the same learner twice", () => {
    const { present, unknown } = matchAttendance(
      [
        { name: "Thandi", email: null, duration: null },
        { name: "Ayanda Dube", email: null, duration: null },
        { name: "Ayanda Dube (phone)", email: null, duration: null },
      ],
      learners,
    );
    expect(present.map((one) => one.userId)).toEqual(["c"]);
    expect(unknown).toEqual(["Thandi"]);
  });

  it("finds nothing in a file that is not an attendance export", () => {
    expect(readAttendanceExport("notes.csv", csv("Item,Cost\nPaper,10\n"))).toEqual([]);
  });
});
