/**
 * Reading a spreadsheet of learners.
 *
 * The column headings are the whole problem. Every client, and often every
 * cohort, arrives with a different set: "Surname", "Last Name", "Learner
 * Surname", "Van". A platform that insists on its own headings makes somebody
 * retype a spreadsheet they already have, which is the work this is supposed to
 * remove.
 *
 * So headings are matched by rule first. The rules cover what people actually
 * write, they are visible in one place, and a rule that is wrong is wrong the
 * same way every time. Anything they do not recognise is reported as unmatched
 * rather than guessed at - and that unmatched list is the only thing an AI
 * extension is asked to help with.
 *
 * This module imports nothing, so a form can use it.
 */

/** The fields the platform can fill from a spreadsheet. */
export const ROSTER_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "nationalId",
  "jobTitle",
  "team",
  "site",
  "gender",
  "equityCode",
  "disabilityCode",
  "nationality",
  "ofoCode",
] as const;

export type RosterField = (typeof ROSTER_FIELDS)[number];

/**
 * What a heading has to look like to be recognised.
 *
 * Ordered, and the first match wins, so the more specific patterns come first:
 * "identity number" must be tested before anything matching "number", and
 * "first name" before a bare "name".
 */
const HEADING_RULES: { field: RosterField; match: RegExp }[] = [
  { field: "email", match: /e-?mail|email address/i },
  {
    field: "nationalId",
    match: /identity|\bid\b.*(number|no)|\bid_?number|sa ?id|national ?id/i,
  },
  { field: "firstName", match: /first ?name|given ?name|forename|voornaam/i },
  { field: "lastName", match: /last ?name|surname|family ?name|van\b/i },
  { field: "jobTitle", match: /job ?title|position|designation|occupation\b/i },
  { field: "team", match: /team|department|dept|division|unit\b/i },
  { field: "site", match: /site|location|branch|campus|region/i },
  { field: "gender", match: /gender|sex\b/i },
  { field: "equityCode", match: /equity|race|population ?group|ethnic/i },
  { field: "disabilityCode", match: /disab/i },
  { field: "nationality", match: /nationality|citizen/i },
  { field: "ofoCode", match: /ofo/i },
];

export type ColumnMap = Partial<Record<RosterField, number>>;

export type Detection = {
  /** Which column fills which field. */
  mapping: ColumnMap;
  /** Headings the rules did not recognise, with their column index. */
  unmatched: { index: number; heading: string }[];
  /** Fields nothing was found for. */
  missing: RosterField[];
};

/**
 * Which column is which.
 *
 * A field already matched is not matched again, so a sheet with both "Name"
 * and "First Name" does not have the second silently overwrite the first.
 */
export function detectColumns(headings: string[]): Detection {
  const mapping: ColumnMap = {};
  const matched = new Set<number>();

  for (const rule of HEADING_RULES) {
    if (mapping[rule.field] !== undefined) continue;

    const index = headings.findIndex(
      (heading, position) =>
        !matched.has(position) && rule.match.test(heading.trim()),
    );

    if (index !== -1) {
      mapping[rule.field] = index;
      matched.add(index);
    }
  }

  // A bare "Name" is only a first name where nothing better was found, and is
  // reported rather than split - "Van der Merwe, Jan" and "Jan van der Merwe"
  // split differently and guessing wrong renames somebody.
  const unmatched = headings
    .map((heading, index) => ({ index, heading: heading.trim() }))
    .filter(
      (column) => !matched.has(column.index) && column.heading.length > 0,
    );

  const missing = ROSTER_FIELDS.filter((field) => mapping[field] === undefined);

  return { mapping, unmatched, missing };
}

export type RosterRow = {
  /** 1-based, as the spreadsheet shows it, so a problem can be pointed at. */
  line: number;
  values: Partial<Record<RosterField, string>>;
  /** Why this row cannot be used, if it cannot. */
  problems: string[];
};

/** The three a person cannot be created without. */
const REQUIRED: RosterField[] = ["firstName", "lastName", "email"];

/**
 * Turns rows of cells into candidate people.
 *
 * Nothing is rejected outright. A row missing an email is kept, marked with
 * what is wrong with it, and shown - because the useful thing to know is which
 * eight of ninety rows need fixing, not that the file "failed".
 */
export function readRows(
  rows: string[][],
  mapping: ColumnMap,
  startLine = 2,
): RosterRow[] {
  const seen = new Set<string>();

  return (
    rows
      .map((cells, index) => ({ cells, line: startLine + index }))
      // A wholly empty line is a gap in the file, not a learner missing a name.
      // Reporting it as a problem would bury the eight rows that genuinely are,
      // and dropping it earlier would shift every line number after the gap.
      .filter((row) => row.cells.some((cell) => (cell ?? "").trim().length > 0))
      .map(({ cells, line }) => {
        const values: Partial<Record<RosterField, string>> = {};

        for (const field of ROSTER_FIELDS) {
          const column = mapping[field];
          if (column === undefined) continue;
          const value = (cells[column] ?? "").trim();
          if (value) values[field] = value;
        }

        const problems: string[] = [];

        for (const field of REQUIRED) {
          if (!values[field]) problems.push(`No ${label(field)}.`);
        }

        if (values.email) {
          const email = values.email.toLowerCase();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
            problems.push(`"${values.email}" is not an email address.`);
          } else if (seen.has(email)) {
            problems.push(
              `${email} appears more than once in this file. Only the first will be created.`,
            );
          } else {
            seen.add(email);
          }
          values.email = email;
        }

        return { line, values, problems };
      })
  );
}

export function label(field: RosterField): string {
  return (
    {
      firstName: "first name",
      lastName: "surname",
      email: "email address",
      nationalId: "identity number",
      jobTitle: "job title",
      team: "team",
      site: "site",
      gender: "gender",
      equityCode: "equity code",
      disabilityCode: "disability code",
      nationality: "nationality",
      ofoCode: "OFO code",
    } as Record<RosterField, string>
  )[field];
}

/**
 * The rows a spreadsheet's own header line describes.
 *
 * The header is not always the first line: a file exported from a reporting
 * tool often carries a title and a blank row above it. The header is taken to
 * be the first row that any rule matches, which is a better guess than "row 1"
 * and is reported so somebody can see what was assumed.
 */
export function findHeaderRow(rows: string[][]): number {
  for (let index = 0; index < Math.min(rows.length, 10); index += 1) {
    const detection = detectColumns(rows[index] ?? []);
    // Two recognised headings is a header row; one is a coincidence.
    const found = ROSTER_FIELDS.filter(
      (field) => detection.mapping[field] !== undefined,
    ).length;
    if (found >= 2) return index;
  }
  return 0;
}
