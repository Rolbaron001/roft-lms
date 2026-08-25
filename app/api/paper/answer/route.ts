import { currentSession } from "@/lib/request";
import { saveAnswer, PaperError } from "@/lib/papers";

/** Autosave for one answer. Called as the learner types, so it stays small. */
export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return new Response("Sign in first.", { status: 401 });

  try {
    const body = await request.json();
    const saved = await saveAnswer(session, {
      submissionId: String(body.submissionId ?? ""),
      itemId: String(body.itemId ?? ""),
      selectedOptionIds: Array.isArray(body.selectedOptionIds)
        ? body.selectedOptionIds.map(String)
        : undefined,
      answerText:
        typeof body.answerText === "string" ? body.answerText : undefined,
      answerNumber:
        typeof body.answerNumber === "number" && Number.isFinite(body.answerNumber)
          ? body.answerNumber
          : undefined,
    });

    return Response.json({ ok: true, savedAt: saved.savedAt });
  } catch (error) {
    if (error instanceof PaperError) {
      const status =
        error.code === "not_permitted" ? 403 : error.code === "not_found" ? 404 : 409;
      return Response.json({ error: error.message }, { status });
    }
    throw error;
  }
}
