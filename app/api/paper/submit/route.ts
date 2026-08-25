import { currentSession, requestContext } from "@/lib/request";
import { submitAttempt, PaperError } from "@/lib/papers";

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return new Response("Sign in first.", { status: 401 });

  try {
    const body = await request.json();
    const context = await requestContext();

    const result = await submitAttempt(session, {
      submissionId: String(body.submissionId ?? ""),
      declarationAccepted: body.declarationAccepted === true,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return Response.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    if (error instanceof PaperError) {
      const status =
        error.code === "not_permitted" ? 403 : error.code === "not_found" ? 404 : 409;
      return Response.json({ error: error.message }, { status });
    }
    throw error;
  }
}
