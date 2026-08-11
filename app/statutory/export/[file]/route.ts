import { notFound } from "next/navigation";
import { currentSession } from "@/lib/request";
import { can } from "@/lib/rbac";
import {
  buildNlrdDataset,
  buildWspAtr,
  nlrdCsv,
  wspAtrCsv,
} from "@/lib/statutory";

/**
 * Statutory file downloads.
 *
 * The NLRD files are withheld while the dataset has a blocking problem. A
 * download that quietly produced a file destined for rejection would undo the
 * only real benefit of validating first.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const session = await currentSession();
  if (!session) {
    return new Response("Sign in first.", { status: 401 });
  }

  if (!can(session, "report:statutory")) {
    return new Response("Not permitted.", { status: 403 });
  }

  const { file } = await params;
  const stamp = new Date().toISOString().slice(0, 10);

  if (file === "wsp-atr") {
    const { rows } = await buildWspAtr(session);
    return csvResponse(wspAtrCsv(rows), `wsp-atr-${stamp}.csv`);
  }

  const dataset = await buildNlrdDataset(session);

  if (!dataset.submittable) {
    return new Response(
      "This return has problems that must be fixed before the files can be produced. See the statutory reporting page.",
      { status: 409, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const files = nlrdCsv(dataset);
  const csv = files[file];
  if (!csv) notFound();

  return csvResponse(csv, `${file}-${stamp}.csv`);
}

function csvResponse(csv: string, filename: string): Response {
  // Byte-order mark so Excel reads it as UTF-8 rather than the system
  // codepage, which otherwise mangles accented names.
  return new Response(`﻿${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
