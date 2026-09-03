import { z } from "zod";
import { extname } from "node:path";
import { readXlsxSheets } from "./office";
import { extensionState, readJson, runExtension } from "./extensions";
import { invitePerson, PeopleError } from "./people";
import {
  detectColumns,
  findHeaderRow,
  label,
  readRows,
  ROSTER_FIELDS,
  type ColumnMap,
  type Detection,
  type RosterField,
  type RosterRow,
} from "./roster";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Turning a spreadsheet of learners into people on the platform.
 *
 * Ordinary functionality. Reading a CSV or an XLSX and matching its headings
 * is parsing, and the rules cover what people actually write. No extension is
 * needed and none is asked for.
 *
 * **What an extension adds, and only this.** Headings the rules do not
 * recognise. Every client's spreadsheet is different and the rules cannot cover
 * every one, so what is left over goes to the model with a single question:
 * which of the platform's fields, if any, does this column hold? It answers
 * about column names, never about a learner - the rows themselves are never
 * sent anywhere.
 *
 * That distinction is worth being exact about. A roster carries identity
 * numbers and it is not going to a model.
 */

export class RosterError extends Error {
  constructor(
    message: string,
    readonly reason: "unreadable" | "empty" | "no_headings" | "invalid",
  ) {
    super(message);
    this.name = "RosterError";
  }
}

export type RosterProposal = {
  filename: string;
  headings: string[];
  detection: Detection;
  rows: RosterRow[];
  /** Where the header line was found, 1-based as the spreadsheet shows it. */
  headerLine: number;
  /** Columns the model matched that the rules did not, and what it said. */
  assisted: { heading: string; field: RosterField; because: string }[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------

/** Enough CSV for a roster: quoted cells with escaped quotes inside. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (quoted) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else quoted = false;
      } else current += character;
      continue;
    }

    if (character === '"') quoted = true;
    else if (character === ",") {
      cells.push(current);
      current = "";
    } else current += character;
  }

  cells.push(current);
  return cells;
}

function readCsv(bytes: Uint8Array): string[][] {
  const text = new TextDecoder("utf-8").decode(bytes);

  // Blank lines are kept, deliberately. Dropping them would shift every line
  // number after the gap, so a report saying "line 5" would point at line 6 of
  // the file the person opens - and a report pointing at the wrong line is
  // worse than one giving no line at all. Empty rows are skipped later, where
  // skipping them costs nothing.
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  return lines.map(splitCsvLine);
}

/** The grid of cells, whichever kind of file it came in. */
export function readGrid(filename: string, bytes: Uint8Array): string[][] {
  const extension = extname(filename).toLowerCase();

  if (extension === ".csv" || extension === ".txt") return readCsv(bytes);

  if (extension === ".xlsx") {
    const sheets = readXlsxSheets(bytes);
    if (sheets.length === 0) {
      throw new RosterError("That workbook has no sheets in it.", "empty");
    }
    // The first sheet with more than a header on it. A workbook often opens on
    // an instructions tab, and reading that finds no learners and says the
    // file is empty, which is true of the sheet and wrong about the file.
    const usable =
      sheets.find((sheet) => sheet.rows.length > 1) ?? sheets[0];
    return usable.rows.map((row) => row.map((cell) => String(cell ?? "")));
  }

  throw new RosterError(
    `${filename} is not a spreadsheet the platform can read. Save it as CSV or XLSX.`,
    "unreadable",
  );
}

// ---------------------------------------------------------------------------
// Proposing
// ---------------------------------------------------------------------------

const ASSIST_SYSTEM = `You are matching spreadsheet column headings to fields in a learner
record system. Reply with JSON only - no prose, no code fence.

{"matches":[{"heading":"<the heading exactly as given>","field":"<one of the field names>","because":"<a short reason>"}]}

Only include a heading you are confident about. Leave out anything you are not
sure of: an unmatched column is filed by hand in a moment, and a wrongly
matched one puts somebody's cost centre in the field the platform treats as an
identity number.`;

/**
 * Reads a roster file and says what it found.
 *
 * The model is asked about headings only, and only about the ones the rules
 * did not recognise. It never sees a row. That is not a performance decision:
 * a roster carries identity numbers and names, and there is no reason for any
 * of it to leave the machine to answer a question about column titles.
 */
export async function proposeRoster(
  session: AuthenticatedSession,
  file: { filename: string; bytes: Uint8Array },
): Promise<RosterProposal> {
  assertSessionCan(session, "user:invite");

  const grid = readGrid(file.filename, file.bytes);
  if (grid.length === 0) {
    throw new RosterError("That file has nothing in it.", "empty");
  }

  const headerIndex = findHeaderRow(grid);
  const headings = (grid[headerIndex] ?? []).map((cell) => cell.trim());
  const detection = detectColumns(headings);
  const warnings: string[] = [];
  const assisted: RosterProposal["assisted"] = [];

  if (headerIndex > 0) {
    warnings.push(
      `The column headings were taken from line ${headerIndex + 1}, not line 1 - everything above it looked like a title rather than headings.`,
    );
  }

  // Only the leftovers, and only the headings.
  if (detection.unmatched.length > 0) {
    const state = await extensionState(session);
    const usable = state.on && (state.availability?.available ?? false);

    if (usable) {
      const matched = await matchHeadings(
        session,
        detection.unmatched.map((column) => column.heading),
        detection.mapping,
      );

      for (const match of matched) {
        const column = detection.unmatched.find(
          (row) => row.heading === match.heading,
        );
        if (!column) continue;
        if (detection.mapping[match.field] !== undefined) continue;

        detection.mapping[match.field] = column.index;
        assisted.push(match);
      }

      detection.unmatched = detection.unmatched.filter(
        (column) => !assisted.some((row) => row.heading === column.heading),
      );
    } else {
      warnings.push(
        `${detection.unmatched.length} ${detection.unmatched.length === 1 ? "column was" : "columns were"} not recognised: ${detection.unmatched.map((column) => `"${column.heading}"`).join(", ")}. They will be ignored. An AI extension would try to match them; without one you can rename them in the file to match what the platform expects.`,
      );
    }
  }

  if (
    detection.mapping.firstName === undefined ||
    detection.mapping.lastName === undefined ||
    detection.mapping.email === undefined
  ) {
    const missing = (["firstName", "lastName", "email"] as RosterField[])
      .filter((field) => detection.mapping[field] === undefined)
      .map(label);

    throw new RosterError(
      `No column was found for: ${missing.join(", ")}. A person cannot be created without those three. The headings found were: ${headings.filter(Boolean).join(", ")}.`,
      "no_headings",
    );
  }

  const rows = readRows(
    grid.slice(headerIndex + 1),
    detection.mapping,
    headerIndex + 2,
  );

  if (rows.length === 0) {
    warnings.push("The headings were read but there are no rows under them.");
  }

  return {
    filename: file.filename,
    headings,
    detection,
    rows,
    headerLine: headerIndex + 1,
    assisted,
    warnings,
  };
}

const matchSchema = z.object({
  matches: z
    .array(
      z.object({
        heading: z.string(),
        field: z.enum(ROSTER_FIELDS),
        because: z.string().max(300),
      }),
    )
    .default([]),
});

async function matchHeadings(
  session: AuthenticatedSession,
  headings: string[],
  already: ColumnMap,
): Promise<RosterProposal["assisted"]> {
  const open = ROSTER_FIELDS.filter((field) => already[field] === undefined);
  if (open.length === 0) return [];

  const result = await runExtension(session, {
    task: "match_roster_headings",
    system: ASSIST_SYSTEM,
    prompt: `Fields still to fill: ${open.join(", ")}.\n\nUnmatched column headings:\n${headings.map((heading) => `- ${heading}`).join("\n")}`,
    timeoutMs: 120_000,
  });

  if (!result.ok) return [];

  const parsed = matchSchema.safeParse(readJson(result.text ?? ""));
  if (!parsed.success) return [];

  return parsed.data.matches.filter((match) => open.includes(match.field));
}

// ---------------------------------------------------------------------------
// Committing
// ---------------------------------------------------------------------------

export type RosterReport = {
  created: number;
  skipped: number;
  /** Every row that did not become a person, with the reason. */
  refused: string[];
  /** Who was created and the password they were given. */
  people: { line: number; email: string; initialPassword: string }[];
};

/**
 * Creates the people a proposal describes.
 *
 * Rows with problems are skipped rather than the file being refused: eighty
 * good rows should land while eight bad ones are reported, because the
 * alternative is somebody fixing one cell and running the whole thing again.
 *
 * Every person is created through `invitePerson`, so the identity number check
 * and the role guard apply exactly as they do to somebody typed in by hand. An
 * invalid identity number stops that one person, not the import.
 */
export async function commitRoster(
  session: AuthenticatedSession,
  proposal: RosterProposal,
  options: { roles?: string[] } = {},
): Promise<RosterReport> {
  assertSessionCan(session, "user:invite");

  const report: RosterReport = {
    created: 0,
    skipped: 0,
    refused: [],
    people: [],
  };

  for (const row of proposal.rows) {
    if (row.problems.length > 0) {
      report.skipped += 1;
      report.refused.push(`Line ${row.line}: ${row.problems.join(" ")}`);
      continue;
    }

    try {
      const made = await invitePerson(session, {
        email: row.values.email as string,
        firstName: row.values.firstName as string,
        lastName: row.values.lastName as string,
        jobTitle: row.values.jobTitle,
        team: row.values.team,
        site: row.values.site,
        nationalId: row.values.nationalId,
        gender: row.values.gender,
        equityCode: row.values.equityCode,
        disabilityCode: row.values.disabilityCode,
        nationality: row.values.nationality,
        ofoCode: row.values.ofoCode,
        roles: (options.roles ?? ["learner"]) as never,
      });

      report.created += 1;
      report.people.push({
        line: row.line,
        email: row.values.email as string,
        initialPassword: made.initialPassword,
      });
    } catch (error) {
      report.skipped += 1;
      report.refused.push(
        `Line ${row.line} (${row.values.email}): ${
          error instanceof PeopleError
            ? error.message
            : error instanceof Error
              ? error.message
              : "could not be created."
        }`,
      );
    }
  }

  return report;
}
