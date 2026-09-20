/**
 * The blueprint a provider can write by hand.
 *
 * Roland, 20 September: "Where does the summary come from? What creates it?
 * Does it have a specific format? Can a summary be created by the user so that
 * it is part of the qualification in the folder?"
 *
 * Yes to the last one, and FOLDER-BLUEPRINT.md is the schema. This exercises
 * the reader against the document's own worked example, because a schema
 * written from description drifts from the code that reads it - and somebody
 * will be generating files against it.
 *
 * It matters more than it looks. A folder carrying a blueprint is read
 * directly: no model, no token, no quota, and identical every time. A folder
 * without one had its structure worked out by Claude on 20 September, which
 * found 331 of 121151's 503 curriculum lines. This is the accurate route.
 */
import { describe, expect, it } from "vitest";
import { readBlueprint } from "@/lib/folder-plan";
import type { UploadedFile } from "@/lib/folder-upload";

function folder(blueprint: unknown, path = "_control/blueprint.json"): UploadedFile[] {
  return [
    {
      path,
      filename: path.split("/").pop()!,
      bytes: new TextEncoder().encode(
        typeof blueprint === "string" ? blueprint : JSON.stringify(blueprint),
      ),
      kind: "text",
    } as UploadedFile,
  ];
}

/** The example printed in FOLDER-BLUEPRINT.md, cut down. */
const EXAMPLE = {
  meta: {
    title: "Advanced Occupational Certificate: Human Resource Management Officer",
    saqa_id: "121151",
    curriculum_code: "242303-001-00-00",
    nqf_level: 6,
    credits_total: 134,
  },
  purpose: "What the qualification is for.",
  knowledge_modules: [
    {
      code: "KM01",
      title: "Creating and Implementing Organisational Architecture",
      credits: 8,
      topics: [
        {
          code: "KM0101",
          title: "Fundamentals of Business and Strategic HRM",
          elements: ["Definitions, purposes, and structures."],
          criteria: ["Different organisational forms are explained."],
        },
      ],
    },
  ],
  anomalies: ["KM01: topic percentages add up to 85, not 100."],
};

describe("the documented example", () => {
  it("reads exactly as the document says it will", () => {
    const plan = readBlueprint(folder(EXAMPLE))!;

    expect(plan).not.toBeNull();
    expect(plan.source).toBe("blueprint");
    expect(plan.qualification.title).toContain("Human Resource Management");
    expect(plan.qualification.saqaId).toBe("121151");
    expect(plan.qualification.curriculumCode).toBe("242303-001-00-00");
    expect(plan.qualification.nqfLevel).toBe(6);
    expect(plan.qualification.credits).toBe(134);
    expect(plan.modules).toHaveLength(1);
    expect(plan.modules[0].component).toBe("knowledge");
    expect(plan.modules[0].topics[0].elements).toHaveLength(1);
  });

  it("surfaces anomalies as warnings, as the document promises", () => {
    const plan = readBlueprint(folder(EXAMPLE))!;
    expect(
      plan.warnings.some((warning) =>
        warning.startsWith("From the programme build:"),
      ),
    ).toBe(true);
  });

  it("carries no study units and no documents", () => {
    // Both deliberate, and both stated in the document: grouping is the
    // provider's decision, and documents are classified by filename.
    const plan = readBlueprint(folder(EXAMPLE))!;
    expect(plan.studyUnits).toEqual([]);
    expect(plan.documents).toEqual([]);
  });
});

describe("the traps the document warns about", () => {
  it("ignores a level or credits written as a string", () => {
    const plan = readBlueprint(
      folder({
        ...EXAMPLE,
        meta: { ...EXAMPLE.meta, nqf_level: "6", credits_total: "134" },
      }),
    )!;

    expect(plan.qualification.nqfLevel).toBeNull();
    expect(plan.qualification.credits).toBeNull();
  });

  it("drops a module with no code or no title", () => {
    const plan = readBlueprint(
      folder({
        knowledge_modules: [
          { title: "No code here", topics: [] },
          { code: "KM02", title: "Kept", topics: [] },
        ],
      }),
    )!;

    expect(plan.modules.map((one) => one.code)).toEqual(["KM02"]);
  });

  it("returns nothing at all when that leaves no modules", () => {
    // Then the folder falls through to the model, which is the difference
    // between "instant and exact" and "a model reads the documents".
    expect(readBlueprint(folder({ knowledge_modules: [{ title: "No code" }] })))
      .toBeNull();
  });

  it("falls through rather than failing on malformed JSON", () => {
    expect(readBlueprint(folder("{ not json"))).toBeNull();
  });

  it("finds the file one level up, case-insensitively", () => {
    const plan = readBlueprint(
      folder(EXAMPLE, "Some Folder/_CONTROL/BLUEPRINT.JSON"),
    );
    expect(plan).not.toBeNull();
  });
});

describe("the aliases the document lists", () => {
  it("accepts skills and experiences in place of topics", () => {
    const plan = readBlueprint(
      folder({
        practical_modules: [
          { code: "PM01", title: "A skill", skills: [{ title: "One" }] },
        ],
        workplace_modules: [
          { code: "WM01", title: "An experience", experiences: [{ title: "Two" }] },
        ],
      }),
    )!;

    expect(plan.modules[0].topics).toHaveLength(1);
    expect(plan.modules[1].topics).toHaveLength(1);
  });

  it("merges activities and knowledge into elements rather than replacing", () => {
    const plan = readBlueprint(
      folder({
        workplace_modules: [
          {
            code: "WM01",
            title: "One",
            experiences: [
              {
                title: "A",
                elements: ["from elements"],
                activities: ["from activities"],
                knowledge: ["from knowledge"],
              },
            ],
          },
        ],
      }),
    )!;

    expect(plan.modules[0].topics[0].elements).toEqual([
      "from elements",
      "from activities",
      "from knowledge",
    ]);
  });

  it("takes a string, a description or a text field", () => {
    const plan = readBlueprint(
      folder({
        knowledge_modules: [
          {
            code: "KM01",
            title: "One",
            topics: [
              {
                title: "A",
                elements: [
                  "plain",
                  { description: "described" },
                  { text: "texted" },
                  { neither: "dropped" },
                ],
              },
            ],
          },
        ],
      }),
    )!;

    expect(plan.modules[0].topics[0].elements).toEqual([
      "plain",
      "described",
      "texted",
    ]);
  });
});
