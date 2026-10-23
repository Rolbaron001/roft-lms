/**
 * Reading a QCTO Skills Programme Document (job sheet D39, 23 October 2026).
 *
 * An occupational skills programme is founded on two documents, not a full
 * qualification's three: the Skills Programme Document, which registers it
 * (its SP number, level, credits, duration, dates, modules, exit level
 * outcomes and how its FISA is run), and its own Curriculum Document. There is
 * no assessment specification, because a skills programme ends in a FISA the
 * provider sets and moderates rather than in an external EISA.
 *
 * Built against SP220320 Assessment Practitioner as the platform's PDF reader
 * returns it: a cover page of labelled fields, then "SKILLS PROGRAMME DETAILS"
 * numbered 1 to 13. Pure text in, fields out; it imports nothing, so it can be
 * tested on the published document directly.
 */

export type ParsedSkillsProgramme = {
  /** "SP-220320": the registration number, held where a SAQA ID would be. */
  spId: string | null;
  title: string | null;
  nqfLevel: number | null;
  totalCredits: number | null;
  durationDays: number | null;
  ofoCode: string | null;
  qualityPartner: string | null;
  relatedQualification: string | null;
  purpose: string | null;
  entryRequirements: string | null;
  startDate: Date | null;
  endDate: Date | null;
  lastEnrolmentDate: Date | null;
  lastAchievementDate: Date | null;
  /** As the document writes them, e.g. "242401001-KM-05". */
  moduleCodes: string[];
  exitLevelOutcomes: { number: number; description: string; criteria: string[] }[];
  notes: string[];
};

/** Whether this text is a Skills Programme Document rather than a SAQA qualification document. */
export function isSkillsProgrammeDocument(text: string): boolean {
  return /SKILLS\s+PROGRAMM?E\s+DOCUMENT/i.test(text) || /Skills\s+Programme\s+ID\s+SP-?\s?\d{5,}/i.test(text);
}

const DATE = /(\d{2})\/(\d{2})\/(\d{4})/;

/** "02/03/2022" is the second of March: South African documents write the day first. */
function day(match: RegExpMatchArray | null, at = 1): Date | null {
  if (!match) return null;
  const [d, m, y] = [Number(match[at]), Number(match[at + 1]), Number(match[at + 2])];
  if (!d || !m || !y || m > 12 || d > 31) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function number(value: string | undefined): number | null {
  const parsed = value ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** The text of one numbered detail, up to the next number in sequence. */
function detail(lines: string[], index: number): string | null {
  const start = lines.findIndex((line) => new RegExp(`^${index}\\.\\s`).test(line));
  if (start === -1) return null;
  const end = lines.findIndex((line, at) => at > start && new RegExp(`^${index + 1}\\.\\s`).test(line));
  return lines
    .slice(start, end === -1 ? undefined : end)
    .join(" ")
    .replace(new RegExp(`^${index}\\.\\s*`), "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSkillsProgrammeDocument(text: string): ParsedSkillsProgramme {
  const notes: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    // Page footers ("SP Doc Assessment Practitioner 5 20 Page 2 of 6") break a
    // detail across pages; they are not part of any field.
    .filter((line) => line !== "" && !/Page \d+ of \d+$/.test(line));
  const all = lines.join("\n");

  const spRaw = /Skills\s+Programme\s+ID\s+(SP)-?\s?(\d{5,})/i.exec(all);
  const spId = spRaw ? `SP-${spRaw[2]}` : null;

  const title =
    /Skills\s+Programme\s+Title\s+(.+)/i.exec(all)?.[1]?.trim() ??
    /^1\.\s*Title\s+(.+)$/im.exec(all)?.[1]?.trim() ??
    null;

  const nqfLevel =
    number(/NQF\s+Level\s+(\d+)\s+Credits/i.exec(all)?.[1]) ?? number(/^3\.\s*NQF\s+Level\s+(\d+)/im.exec(all)?.[1]);
  const totalCredits =
    number(/Credits\s+(\d+)\s+Duration/i.exec(all)?.[1]) ?? number(/^5\.\s*Credits\s+(\d+)/im.exec(all)?.[1]);
  const durationDays =
    number(/Duration\s+in\s+days\s+(\d+)/i.exec(all)?.[1]) ?? number(/^4\.\s*Duration\s+(\d+)/im.exec(all)?.[1]);
  const ofoCode = /OFO\s+Code\s+(\d{6})/i.exec(all)?.[1] ?? null;
  const qualityPartner = /^6\.\s*Quality\s+Assuring\s+Body\s+(.+)$/im.exec(all)?.[1]?.trim() ?? null;

  const span = /Start\s+Date\s+End\s+Date\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2})\/(\d{2})\/(\d{4})/i.exec(all);
  const startDate = day(span, 1);
  const endDate = day(span, 4);
  const lastEnrolmentDate = day(new RegExp(`Last\\s+date\\s+for\\s+enrolment\\s+${DATE.source}`, "i").exec(all));
  const lastAchievementDate = day(new RegExp(`Last\\s+date\\s+for\\s+achievement\\s+${DATE.source}`, "i").exec(all));

  const relatedQualification =
    detail(lines, 8)
      ?.replace(/^Related\s+registered\s+qualification\/s\s*/i, "")
      .trim() || null;
  const purpose = detail(lines, 9)?.replace(/^Purpose\s*/i, "").trim() || null;
  const entryRequirements = detail(lines, 11)?.replace(/^Minimum\s+entry\s+requirements\s*/i, "").trim() || null;

  // The modules, as listed under Content: knowledge and application components.
  const content = detail(lines, 10) ?? all;
  const moduleCodes = [
    ...new Set(
      Array.from(content.matchAll(/\b(\d{6}-?\d{3})-((?:KM|PM|WM))-(\d{2})\b/g)).map(
        (match) => `${match[1].replace("-", "")}-${match[2]}-${match[3]}`,
      ),
    ),
  ];

  // Exit Level Outcomes, each followed by its Associated Assessment Criteria
  // written as "o" bullets that run onto further lines.
  const exitLevelOutcomes: ParsedSkillsProgramme["exitLevelOutcomes"] = [];
  const eloStart = lines.findIndex((line) => /^12\.\s*Exit\s+Level\s+Outcomes/i.test(line));
  const eloEnd = lines.findIndex((line, at) => at > eloStart && /^13\.\s/.test(line));
  if (eloStart !== -1) {
    const block = lines.slice(eloStart + 1, eloEnd === -1 ? undefined : eloEnd);
    let current: (typeof exitLevelOutcomes)[number] | null = null;
    let inCriteria = false;
    for (const line of block) {
      if (/^Exit\s+Level\s+Outcome\b/i.test(line) || /^and\s+Associated\s+Assessment/i.test(line) || /^Criteria\s+\(AAC\)/i.test(line)) {
        inCriteria = false;
        continue;
      }
      const outcome = /^(\d+)\.\s+(.+)/.exec(line);
      if (outcome && !inCriteria) {
        current = { number: Number(outcome[1]), description: outcome[2].trim(), criteria: [] };
        exitLevelOutcomes.push(current);
        continue;
      }
      if (/^Associated\s+Assessment\s+Criteria/i.test(line)) {
        inCriteria = true;
        continue;
      }
      if (!current) continue;
      const bullet = /^(?:o|•||-)\s+(.+)/.exec(line);
      if (inCriteria && bullet) {
        current.criteria.push(bullet[1].trim());
      } else if (inCriteria && current.criteria.length > 0) {
        current.criteria[current.criteria.length - 1] += ` ${line}`;
      } else if (!inCriteria) {
        current.description += ` ${line}`;
      }
    }
  }

  if (!spId) notes.push("No Skills Programme ID (SP-number) was found. Enter it by hand.");
  if (exitLevelOutcomes.length === 0) notes.push("No Exit Level Outcomes were found in the Skills Programme Document.");
  if (moduleCodes.length === 0) notes.push("The Skills Programme Document lists no module codes under Content.");

  return {
    spId,
    title,
    nqfLevel,
    totalCredits,
    durationDays,
    ofoCode,
    qualityPartner,
    relatedQualification,
    purpose,
    entryRequirements,
    startDate,
    endDate,
    lastEnrolmentDate,
    lastAchievementDate,
    moduleCodes,
    exitLevelOutcomes,
    notes,
  };
}
