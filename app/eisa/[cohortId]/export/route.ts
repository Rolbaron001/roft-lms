import { eq } from "drizzle-orm";
import { requirePermission } from "@/lib/request";
import {
  providerDetails,
  registrationCsv,
  registrationList,
} from "@/lib/eisa-registration";
import { withTenant } from "@/db/client";
import { eisaSittings } from "@/db/schema";

/**
 * The registration file, as the quality partner wants it.
 *
 * A route rather than a button that builds the file in the browser, so the
 * list is assembled from the criterion ledger at the moment it is downloaded
 * and cannot be a stale copy of what the page showed ten minutes ago.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ cohortId: string }> },
) {
  const { cohortId } = await context.params;
  const session = await requirePermission("enrolment:read_all");

  const sittingId = new URL(request.url).searchParams.get("sitting");

  const [list, provider] = await Promise.all([
    registrationList(session, cohortId),
    providerDetails(session),
  ]);

  const sitting = sittingId
    ? await withTenant(session.organisationId, async (tx) => {
        const [row] = await tx
          .select()
          .from(eisaSittings)
          .where(eq(eisaSittings.id, sittingId));
        return row ?? null;
      })
    : null;

  const csv = registrationCsv({
    providerName: provider.legalName,
    accreditationNumber: provider.accreditationNumber,
    cohortName: list.cohortName,
    qualificationTitle: list.qualificationTitle,
    sittingName: sitting?.name ?? "Not stated",
    sittingDate: sitting?.sittingDate ?? "Not stated",
    candidates: list.candidates,
  });

  const filename = `EISA registration - ${list.cohortName}.csv`.replace(
    /[^\w \-.]/g,
    "",
  );

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
