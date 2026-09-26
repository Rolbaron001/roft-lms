import { headers } from "next/headers";
import { exportStatements } from "@/lib/xapi";
import { PermissionDeniedError } from "@/lib/rbac";
import { currentSession } from "@/lib/request";

/**
 * Every learning record of this provider, as a file of xAPI statements.
 *
 * Job sheet A10. Named after the provider's own address, the same way the
 * drive connection works it out, so each activity in the file names this
 * provider rather than the operator running the platform.
 */
export async function GET() {
  const session = await currentSession();
  if (!session) return new Response("Sign in first.", { status: 401 });

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const scheme = host.startsWith("localhost") || host.includes(".localhost") ? "http" : "https";

  try {
    const statements = await exportStatements(session, `${scheme}://${host}`);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(statements, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="learning-records-${day}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return Response.json({ error: "Only a provider administrator may export learning records." }, { status: 403 });
    }
    throw error;
  }
}
