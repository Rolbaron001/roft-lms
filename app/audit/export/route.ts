import { currentSession, said } from "@/lib/request";
import { auditCsv, auditTrail } from "@/lib/quality";
import { PermissionDeniedError } from "@/lib/rbac";

/**
 * The audit trail as CSV, with the same filter as the page (D51). Up to
 * 10,000 rows, newest first.
 */
export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return new Response(await said("Sign in first."), { status: 401 });
  const url = new URL(request.url);
  const filter = {
    action: url.searchParams.get("action") ?? undefined,
    actorId: url.searchParams.get("actor") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  };
  try {
    const csv = auditCsv(await auditTrail(session, filter, 10_000));
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="audit-trail-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) return new Response(await said("Your role does not allow that."), { status: 403 });
    throw error;
  }
}
