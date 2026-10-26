import { currentSession, said } from "@/lib/request";
import {
  ClassroomError,
  answerPoll,
  classPass,
  classPolls,
  closePoll,
  endBreakouts,
  endClass,
  getClassroom,
  hostControl,
  postClassChat,
  saveClassNotes,
  startBreakouts,
  startPoll,
  type HostAction,
} from "@/lib/classroom";
import { correctTranscript, draftSummary, publishRecord, saveSummary, transcribeWhenReady } from "@/lib/classroom-record";
import { acknowledgeNotice } from "@/lib/classroom-notice";
import { PermissionDeniedError } from "@/lib/rbac";

/** The breakout group a host says they are in, or null for the whole class. */
function visiting(value: unknown): number | null {
  const group = Number(value);
  return Number.isInteger(group) && group > 0 ? group : null;
}

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
        return Response.json(await classPass(session, sessionId, new Date(), visiting(body.group)));
      case "chat":
        return Response.json({ ok: true, line: await postClassChat(session, sessionId, String(body.body ?? ""), visiting(body.group)) });
      case "breakout_start":
        return Response.json({ ok: true, groups: await startBreakouts(session, sessionId, Number(body.count)) });
      case "breakout_end":
        await endBreakouts(session, sessionId);
        return Response.json({ ok: true });
      case "poll_start":
        return Response.json({
          ok: true,
          poll: await startPoll(session, sessionId, String(body.question ?? ""), Array.isArray(body.options) ? body.options.map(String) : []),
        });
      case "poll_answer":
        await answerPoll(session, sessionId, String(body.pollId ?? ""), Number(body.choice));
        return Response.json({ ok: true });
      case "poll_close":
        return Response.json({ ok: true, poll: await closePoll(session, sessionId, String(body.pollId ?? "")) });
      case "polls":
        return Response.json({ ok: true, polls: await classPolls(session, sessionId) });
      case "groups":
        return Response.json({ ok: true, breakout: (await getClassroom(session, sessionId)).breakout });
      case "notes":
        return Response.json({ ok: true, savedAt: await saveClassNotes(session, sessionId, String(body.body ?? "")) });
      case "control":
        await hostControl(session, sessionId, body.control as HostAction);
        return Response.json({ ok: true });
      case "end": {
        const tally = await endClass(session, sessionId);
        // Sent now if no recording is still closing; otherwise when the last one closes.
        await transcribeWhenReady(session.organisationId, sessionId).catch((error: unknown) => console.error("Class could not be sent to be transcribed:", error));
        return Response.json({ ok: true, ...tally });
      }
      case "acknowledge":
        await acknowledgeNotice(session);
        return Response.json({ ok: true });
      case "summary_save":
        await saveSummary(session, sessionId, String(body.summary ?? ""));
        return Response.json({ ok: true });
      case "summary_draft":
        return Response.json({ ok: true, summary: await draftSummary(session, sessionId) });
      case "transcript_correct":
        await correctTranscript(session, sessionId, Number(body.index), String(body.text ?? ""));
        return Response.json({ ok: true });
      case "publish":
        return Response.json({ ok: true, ...(await publishRecord(session, sessionId)) });
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
