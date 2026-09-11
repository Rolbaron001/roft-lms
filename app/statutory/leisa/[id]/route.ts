import { currentSession } from "@/lib/request";
import { can } from "@/lib/rbac";
import { buildLeisa, leisaCsv } from "@/lib/statutory-notification";

/**
 * The LEISA workbook for one submission, as a file.
 *
 * Produced even when learners are short, unlike the NLRD return next door.
 * They are different situations: an NLRD file with a blocking problem will be
 * rejected outright, while a LEISA with two learners missing a STATSSA code is
 * a file a coordinator wants in front of them, because seeing the gaps in the
 * spreadsheet is often how they get filled.
 *
 * The gaps are listed on the page. What is downloaded is what would be sent.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await currentSession();
  if (!session) return new Response("Sign in first.", { status: 401 });

  if (!can(session, "report:statutory")) {
    return new Response("Not permitted.", { status: 403 });
  }

  const { id } = await params;
  const workbook = await buildLeisa(session, id);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  /**
   * Named the way the QCTO's own template is named - LEISAyyyymmdd followed by
   * the provider - so a coordinator uploading it does not have to rename it
   * first.
   */
  const filename = `LEISA${stamp}-${session.organisationId.slice(0, 8)}.csv`;

  // Byte-order mark, so Excel reads it as UTF-8 rather than the system
  // codepage and does not mangle an accented name.
  return new Response(`﻿${leisaCsv(workbook)}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
