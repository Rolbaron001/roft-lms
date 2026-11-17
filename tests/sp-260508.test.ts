/**
 * SP-260508 Recognition of Prior Learning Advisor: the QCTO's 2021 (OQSF)
 * skills programme template, and Curiosa's rollout and alignment document.
 *
 * Heidi uploaded these on 17 November 2026. The Skills Programme Document and
 * the curriculum both read as empty or wrong, so she typed the details in; the
 * alignment document was filed as an ordinary document, so the qualification
 * kept asking for one. Every assertion here is a figure from the documents.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readDocxText, readPdfText } from "@/lib/office";
import { parseCurriculumText, type ParsedCurriculum } from "@/lib/curriculum-parse";
import { isSkillsProgrammeDocument, parseSkillsProgrammeDocument, type ParsedSkillsProgramme } from "@/lib/skills-programme-parse";
import { looksLikeAlignmentDocument, readAlignmentDocument } from "@/lib/alignment-document";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));

describe("the Skills Programme Document, 2021 template", () => {
  let parsed: ParsedSkillsProgramme;
  let text: string;
  beforeAll(async () => {
    text = (await readPdfText(fixture("SP260508-programme.pdf"))).text;
    parsed = parseSkillsProgrammeDocument(text);
  });

  it("is recognised as one", () => expect(isSkillsProgrammeDocument(text)).toBe(true));

  it("reads its details from the numbered sections, not the contents page", () => {
    expect(parsed).toMatchObject({
      spId: "SP-260508",
      title: "Recognition of Prior Learning Advisor",
      nqfLevel: 7,
      totalCredits: 60,
      qualityPartner: "ETDP SETA",
      entryRequirements: "NQF Level 06 qualification.",
    });
    expect(parsed.purpose).toMatch(/^The purpose of this skills programme is to prepare a learner/);
  });

  it("reads the four dates on the cover, written in words", () => {
    expect([parsed.startDate, parsed.endDate, parsed.lastEnrolmentDate, parsed.lastAchievementDate].map((day) => day?.toISOString().slice(0, 10))).toEqual([
      "2026-05-14",
      "2031-05-14",
      "2032-05-14",
      "2035-05-14",
    ]);
  });

  it("reads the five modules and both Exit Level Outcomes with their criteria", () => {
    expect(parsed.moduleCodes).toEqual([
      "900537-000-00-KM-01",
      "900537-000-00-KM-02",
      "900537-000-00-KM-03",
      "900537-000-00-PM-01",
      "900537-000-00-PM-02",
    ]);
    expect(parsed.exitLevelOutcomes.map((outcome) => [outcome.number, outcome.criteria.length])).toEqual([
      [1, 6],
      [2, 8],
    ]);
    expect(parsed.exitLevelOutcomes[0].description).toMatch(/^Interpret and apply national Recognition of Prior Learning/);
    expect(parsed.notes).toEqual([]);
  });
});

describe("the curriculum, 2021 template", () => {
  let parsed: ParsedCurriculum;
  beforeAll(async () => {
    parsed = parseCurriculumText((await readPdfText(fixture("SP260508-curriculum.pdf"))).text);
  });

  it("reads the cover", () => {
    expect(parsed.qualification).toEqual({
      title: "Recognition of Prior Learning Advisor",
      curriculumCode: "900537-000-00-00",
      nqfLevel: 7,
      totalCredits: 60,
    });
  });

  it("reads every module with the credits its list gives", () => {
    expect(parsed.modules.map((entry) => [entry.code, entry.nqfLevel, entry.credits, entry.title])).toEqual([
      ["KM01", 7, 10, "Overview of Recognition of Prior Learning (RPL) processes"],
      ["KM02", 7, 10, "RPL implementation practices"],
      ["KM03", 6, 15, "Ethical behaviour and self-management"],
      ["PM01", 7, 5, "Conduct research to support RPL implementation"],
      ["PM02", 7, 20, "Conduct RPL"],
    ]);
  });

  it("reads topics written with the full curriculum code, and their criteria", () => {
    expect(parsed.modules.map((entry) => entry.topics.map((topic) => [topic.code, topic.criteria.length]))).toEqual([
      [["KM-01-KT01", 10], ["KM-01-KT02", 4], ["KM-01-KT03", 4], ["KM-01-KT04", 2], ["KM-01-KT05", 10]],
      [["KM-02-KT01", 8], ["KM-02-KT02", 5], ["KM-02-KT03", 6], ["KM-02-KT04", 4], ["KM-02-KT05", 6]],
      [["KM-03-KT01", 9], ["KM-03-KT02", 5], ["KM-03-KT03", 17], ["KM-03-KT04", 4]],
      [["PM-01-PS01", 8]],
      [["PM-02-PS01", 9], ["PM-02-PS02", 8]],
    ]);
  });

  it("keeps the time weights and page headers out of the wording", () => {
    const topic = parsed.modules[0].topics[0];
    expect(topic.elements[0]).toMatchObject({ code: "KT0101", description: "Definition and purpose of RPL." });
    expect(topic.criteria.at(-1)?.description).toBe("Outline and explain the possible successes, failures and challenges of RPL.");
    const all = parsed.modules.flatMap((entry) => entry.topics.flatMap((one) => [...one.elements, ...one.criteria].map((item) => item.description)));
    expect(all.filter((wording) => /SP Curriculum|Copyright|accredited, as listed below/.test(wording))).toEqual([]);
  });

  it("files Conduct RPL under PM02, where its list puts it, and says the document disagrees", () => {
    expect(parsed.notes).toEqual([
      'The curriculum heads "Conduct RPL" as PM01 in one place; its module list gives it as PM02. It is read as PM02. Check the document.',
    ]);
  });
});

describe("the rollout and module alignment document", () => {
  let text: string;
  beforeAll(() => {
    text = readDocxText(fixture("SP260508-alignment.docx"));
  });

  it("is recognised without an ELO per study unit", () => expect(looksLikeAlignmentDocument(text)).toBe(true));

  it("reads five study units with their titles and modules, once each, ignoring the schedule", () => {
    const reading = readAlignmentDocument(text);
    expect(reading.studyUnits.map((unit) => [unit.code, unit.title, unit.moduleCodes])).toEqual([
      ["SU1", "Foundations & Policy Framework of RPL", ["KM01", "PM01"]],
      ["SU2", "Research, Strategy & Quality Assurance", ["KM01", "PM01", "PM02"]],
      ["SU3", "RPL Implementation, Evidence & Digital Tools", ["KM02", "PM02"]],
      ["SU4", "Stakeholder Engagement & Practical Execution", ["KM02", "PM02"]],
      ["SU5", "Ethical Behaviour, EQ & Conflict Management", ["KM03"]],
    ]);
    // A module shared out by topic is deliberate, not a question to raise.
    expect(reading.notes.filter((note) => /listed under/.test(note))).toEqual([]);
  });

  it("is still not confused with a theory guide that mentions a study unit", () => {
    expect(looksLikeAlignmentDocument("Study Unit 1: Introduction. KM-01 covers the basics. This guide explains alignment.")).toBe(false);
  });
});
