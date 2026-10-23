import { currentSession, said } from "@/lib/request";
import { ClassroomError, classPass, endClass, hostControl, postClassChat, saveClassNotes, type HostAction } from "@/lib/classroom";
import { PermissionDeniedError } from "@/lib/rbac";

/**
 * Everything the classroom page asks of the server while a class runs (job
 * sheet D41): a pass to enter (or word that the lobby is still waiting), a
 * line of chat, the facilitator's notes, the facilitator's controls, and
 * ending the class. One route, because each is one small request from the
 * same page, and every one of them is checked against who is asking.
 */
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const session = await currentSession();
  if (!session) return new Response(await said("Sign in first."), { status: 401 });
  const { sessionId } = await params;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    switch (body.do) {
      case "pass":
        return Response.json(await classPass(session, sessionId));
      case "chat":
        return Response.json({ ok: true, line: await postClassChat(session, sessionId, String(body.body ?? "")) });
      case "notes":
        return Response.json({ ok: true, savedAt: await saveClassNotes(session, sessionId, String(body.body ?? "")) });
      case "control":
        await hostControl(session, sessionId, body.control as HostAction);
        return Response.json({ ok: true });
      case "end":
        return Response.json({ ok: true, ...(await endClass(session, sessionId)) });
      default:
        return Response.json(await said({ error: "That is not something the classroom does." }), { status: 400 });
    }
  } catch (error) {
    if (error instanceof ClassroomError) {
      const status = error.code === "not_permitted" ? 403 : error.code === "not_found" ? 404 : error.code === "not_configured" ? 503 : 409;
      return Response.json(await said({ error: error.message }), { status });
    }
    if (error instanceof PermissionDeniedError) {
      return Response.json(await said({ error: "Your role does not allow that." }), { status: 403 });
    }
    console.error(error);
    return Response.json(await said({ error: "The media server did not answer. Try again." }), { status: 502 });
  }
}
