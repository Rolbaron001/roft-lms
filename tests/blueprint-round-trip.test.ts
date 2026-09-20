/**
 * What goes out must come back.
 *
 * The platform could read `_control/blueprint.json` and could not write one,
 * so a provider either hand-authored JSON against a schema document or paid a
 * model to re-derive a structure the platform already held. The export closes
 * that: read a qualification once, download its blueprint, and every import of
 * that folder afterwards is free, instant and exact.
 *
 * That claim only holds if the two halves agree, and they are written months
 * apart by different hands against a document in between. So this puts a
 * curriculum through both: out through lib/blueprint-export.ts, back in
 * through lib/folder-plan.ts, and compares line for line. A field either
 * survives the trip or it is named in `notes` as one that does not.
 *
 * The fixture is shaped after 121151 - the three components, a module with
 * credits and one without, a topic with no code, an element carrying an
 * em dash and quotes, and a criterion long enough to be worth checking it is
 * not truncated anywhere.
 */
import { describe, expect, it } from "vitest";
import { blueprintFrom, blueprintJson } from "@/lib/blueprint-export";
import { readBlueprint } from "@/lib/folder-plan";
import type { UploadedFile } from "@/lib/folder-upload";

type Outline = Parameters<typeof blueprintFrom>[0];

function topic(
  code: string | null,
  title: string,
  elements: string[],
  criteria: string[],
  kind = "knowledge_topic",
) {
  return {
    code,
    title,
    elements: elements.map((description, index) => ({
      id: `e${index}`,
      description,
      kind,
      coveredBy: [],
    })),
    criteria: criteria.map((description, index) => ({
      id: `c${index}`,
      code: `IAC${index + 1}`,
      description,
    })),
  };
}

/** Only the parts blueprintFrom reads; the outline itself is far wider. */
function outline(over: Partial<Record<string, unknown>> = {}): Outline {
  return {
    qualification: {
      title: "Advanced Occupational Certificate: Human Resource Management",
      saqaId: "121151",
      curriculumCode: "242303-001-00-00",
      nqfLevel: 6,
      totalCredits: 134,
      description: "To prepare a learner to manage the HR function.",
    },
    modules: [
      {
        component: "knowledge",
        code: "KM01",
        title: "Creating and Implementing Organisational Architecture",
        credits: 8,
        topics: [
          topic(
            "KM0101",
            "Fundamentals of Business and Strategic HRM",
            [
              "Definitions, purposes, and structures of different organisations — public, private and non-profit.",
              'The meaning of "strategic" as the term is used in the curriculum.',
            ],
            [
              "Different organisational forms are explained with examples relevant to the learner's own workplace, and the explanation distinguishes the purpose of each form from its legal structure.",
            ],
          ),
          // No code, which the schema permits and the reader nulls.
          topic(null, "Unnumbered topic", ["One line to teach."], []),
        ],
        looseCriteria: [],
      },
      {
        component: "practical",
        code: "PM01",
        title: "Design an organisational structure",
        credits: null,
        topics: [
          topic(
            "PM0101",
            "Drafting the structure",
            ["Draw the reporting lines."],
            ["A structure is drafted and defended."],
            "practical_activity",
          ),
        ],
        looseCriteria: [],
      },
      {
        component: "workplace",
        code: "WM01",
        title: "Workplace exposure to the HR function",
        credits: 12,
        topics: [
          topic(
            "WM0101",
            "Attending HR processes",
            ["Observe a disciplinary hearing."],
            [],
            "work_activity",
          ),
        ],
        looseCriteria: [],
      },
    ],
    studyUnits: [],
    ...over,
  } as unknown as Outline;
}

function reread(json: string): ReturnType<typeof readBlueprint> {
  const files: UploadedFile[] = [
    {
      path: "_control/blueprint.json",
      filename: "blueprint.json",
      bytes: new TextEncoder().encode(json),
      kind: "text",
    },
  ];
  return readBlueprint(files);
}

describe("a qualification exported and read back", () => {
  const exported = blueprintFrom(outline());
  const plan = reread(blueprintJson(exported.file));

  it("is read as a blueprint rather than sent to a model", () => {
    // The whole point. If this is "documents" the export bought nothing.
    expect(plan?.source).toBe("blueprint");
  });

  it("keeps the qualification's own identifiers", () => {
    expect(plan?.qualification).toMatchObject({
      title: "Advanced Occupational Certificate: Human Resource Management",
      saqaId: "121151",
      curriculumCode: "242303-001-00-00",
      nqfLevel: 6,
      credits: 134,
      purpose: "To prepare a learner to manage the HR function.",
    });
  });

  it("keeps every module, in its own component", () => {
    expect(plan?.modules.map((m) => [m.component, m.code, m.credits])).toEqual([
      ["knowledge", "KM01", 8],
      ["practical", "PM01", null],
      ["workplace", "WM01", 12],
    ]);
  });

  it("keeps every line to teach, in order and word for word", () => {
    const km01 = plan?.modules.find((m) => m.code === "KM01");

    expect(km01?.topics[0]?.elements).toEqual([
      "Definitions, purposes, and structures of different organisations — public, private and non-profit.",
      'The meaning of "strategic" as the term is used in the curriculum.',
    ]);
    // A topic with no code survives as a topic rather than vanishing.
    expect(km01?.topics[1]).toMatchObject({
      code: null,
      title: "Unnumbered topic",
    });
  });

  it("keeps assessment criteria whole", () => {
    const km01 = plan?.modules.find((m) => m.code === "KM01");
    expect(km01?.topics[0]?.criteria[0]).toBe(
      "Different organisational forms are explained with examples relevant to the learner's own workplace, and the explanation distinguishes the purpose of each form from its legal structure.",
    );
  });

  it("writes the group name each component actually uses", () => {
    // Not decoration: a provider opening the file should see the framework's
    // own vocabulary. The reader takes all three as the same thing.
    const raw = JSON.parse(blueprintJson(exported.file));
    expect(raw.knowledge_modules[0]).toHaveProperty("topics");
    expect(raw.practical_modules[0]).toHaveProperty("skills");
    expect(raw.workplace_modules[0]).toHaveProperty("experiences");
  });

  it("names the file after the qualification, not after a database id", () => {
    expect(exported.filename).toBe("121151-blueprint.json");
  });
});

describe("what the export says it cannot carry", () => {
  it("says so when there are study units", () => {
    const { notes } = blueprintFrom(
      outline({ studyUnits: [{ id: "u1" }, { id: "u2" }] }),
    );
    expect(notes.join(" ")).toMatch(/2 study units are not in the file/);
  });

  it("says so when element kinds would be flattened", () => {
    // The fixture has knowledge_topic, practical_activity and work_activity,
    // and a blueprint carries one list per topic. The text survives; the
    // label does not, and somebody re-importing should know that first.
    const { notes } = blueprintFrom(outline());
    expect(notes.join(" ")).toMatch(/more than one kind of topic element/);
  });

  it("says so when criteria sit on a module rather than under a topic", () => {
    const base = outline();
    const modules = (base as unknown as { modules: Record<string, unknown>[] })
      .modules;
    modules[0].looseCriteria = [{ id: "x" }, { id: "y" }];

    const { notes } = blueprintFrom(base);
    expect(notes.join(" ")).toMatch(/KM01 has 2 assessment criteria/);
  });

  it("says so for a module no blueprint list can hold", () => {
    const base = outline();
    const modules = (base as unknown as { modules: Record<string, unknown>[] })
      .modules;
    modules.push({
      component: "general",
      code: "GM01",
      title: "A module outside the occupational system",
      credits: null,
      topics: [],
      looseCriteria: [],
    });

    const { file, notes } = blueprintFrom(base);
    expect(notes.join(" ")).toMatch(/GM01 is a general module/);
    // And it is genuinely absent rather than filed under a component it is
    // not, which would be the silently wrong answer.
    const codes = [
      ...file.knowledge_modules,
      ...file.practical_modules,
      ...file.workplace_modules,
    ].map((m) => m.code);
    expect(codes).not.toContain("GM01");
  });
});

describe("a qualification with nothing optional set", () => {
  it("writes no nulls a reader would have to ignore", () => {
    const bare = blueprintFrom(
      outline({
        qualification: {
          title: "A qualification",
          saqaId: null,
          curriculumCode: null,
          nqfLevel: null,
          totalCredits: null,
          description: null,
        },
      }),
    );

    const raw = JSON.parse(blueprintJson(bare.file));
    expect(raw.meta).toEqual({ title: "A qualification" });
    expect(raw).not.toHaveProperty("purpose");
    // Still readable: modules are what the reader requires, and they are there.
    expect(reread(blueprintJson(bare.file))?.modules).toHaveLength(3);
  });
});
