import { notFound } from "next/navigation";
import { currentSession } from "@/lib/request";
import {
  capabilityCoverage,
  overdueTraining,
  toCsv,
} from "@/lib/reporting";

/**
 * CSV exports, per Section 4.8.
 *
 * The same scope rules as the screen: this runs the same reporting functions,
 * so a line manager's export contains their team and nobody else's. A download
 * route that queried the data separately would be the obvious place for that
 * to drift.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ report: string }> },
) {
  const session = await currentSession();
  if (!session) {
    return new Response("Sign in first.", { status: 401 });
  }

  const { report } = await params;
  const url = new URL(request.url);
  const filters = {
    team: url.searchParams.get("team") ?? undefined,
    site: url.searchParams.get("site") ?? undefined,
  };

  const stamp = new Date().toISOString().slice(0, 10);
  let filename: string;
  let csv: string;

  if (report === "capability") {
    const rows = await capabilityCoverage(session, filters);
    filename = `capability-coverage-${stamp}.csv`;
    csv = toCsv(
      ["Code", "Competency", "Holders", "People in scope", "Coverage %", "Risk"],
      rows.map((row) => [
        row.code,
        row.name,
        row.holders,
        row.population,
        row.coverage,
        row.noCoverage
          ? "No coverage"
          : row.singlePointOfFailure
            ? "Single point of failure"
            : "",
      ]),
    );
  } else if (report === "overdue") {
    const rows = await overdueTraining(session, filters);
    filename = `overdue-training-${stamp}.csv`;
    csv = toCsv(
      ["First name", "Last name", "Email", "Team", "Course", "Due", "Days overdue"],
      rows.map((row) => [
        row.firstName,
        row.lastName,
        row.email,
        row.team,
        row.courseTitle,
        row.dueDate ? row.dueDate.toISOString().slice(0, 10) : "",
        row.daysOverdue,
      ]),
    );
  } else {
    notFound();
  }

  // Leading byte-order mark: without it Excel reads the file as the system
  // codepage and renders accented names as mojibake, which is the first thing
  // anyone notices about an export.
  return new Response(`﻿${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
