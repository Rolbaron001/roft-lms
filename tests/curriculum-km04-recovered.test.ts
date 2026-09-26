/**
 * Six criteria of 121151's KM-04 that the reader used to drop.
 *
 * Found on 27 September while checking Roland's view (job sheet W2) that the
 * qualification's documents cover the criteria of every study unit. Curiosa's
 * own alignment matrix counts 112 published knowledge criteria for 121151; the
 * platform held 106. Nothing had reported the difference, because a criterion
 * that is never read leaves nothing behind to notice.
 *
 * Both causes are in the published curriculum, and both are tested here against
 * it rather than against invented text.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readPdfText } from "@/lib/office";
import { parseCurriculumText, type ParsedCurriculum } from "@/lib/curriculum-parse";

let parsed: ParsedCurriculum;

beforeAll(async () => {
  const bytes = new Uint8Array(readFileSync(join(process.cwd(), "tests/fixtures/121151-curriculum.pdf")));
  const pdf = await readPdfText(bytes);
  parsed = parseCurriculumText(typeof pdf === "string" ? pdf : (pdf as { text: string }).text);
});

function topic(code: string) {
  const km04 = parsed.modules.find((module) => module.code === "KM04")!;
  return km04.topics.find((entry) => entry.code === code)!;
}

describe("121151 KM-04", () => {
  it("reads a criterion whose code stands alone on its line", () => {
    // "IAC0105" on one line, its wording on the next. It used to be read as
    // the end of IAC0104's description.
    const criteria = topic("KM0401").criteria;
    expect(criteria.map((c) => c.code)).toEqual(["IAC0101", "IAC0102", "IAC0103", "IAC0104", "IAC0105"]);
    expect(criteria[3].description).not.toMatch(/IAC0105|burden of proof/);
    expect(criteria[4].description).toMatch(/^Discuss the basic principles of the burden of proof/);
  });

  it("keeps a topic's elements when each carries its own percentage", () => {
    // "KT0301 Definitions and terminology. (20%)" has the shape of a topic
    // heading. Read as one, it was dropped with everything after it.
    const km0403 = topic("KM0403");
    expect(km0403.elements.map((e) => e.code)).toEqual([
      "KT0301", "KT0302", "KT0303", "KT0304", "KT0305", "KT0306",
    ]);
    // The document itself has no IAC0305; that is its gap, and it is reported
    // as it stands rather than filled in.
    expect(km0403.criteria.map((c) => c.code)).toEqual([
      "IAC0301", "IAC0302", "IAC0303", "IAC0304", "IAC0306",
    ]);
  });

  it("ends the last criterion before the section that follows", () => {
    expect(topic("KM0403").criteria.at(-1)!.description).toBe(
      "Discuss the role of the HR Officer in negotiations and collective bargaining.",
    );
  });
});
