import { currentSession, said } from "@/lib/request";
import { saveAnswer, PaperError } from "@/lib/papers";

/** Autosave for one answer. Called as the learner types, so it stays small. */
export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return new Response(await said("Sign in first."), { status: 401 });

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
      matchedPairs:
        body.matchedPairs && typeof body.matchedPairs === "object" && !Array.isArray(body.matchedPairs)
          ? Object.fromEntries(
              Object.entries(body.matchedPairs as Record<string, unknown>).map(([prompt, option]) => [
                prompt,
                String(option ?? ""),
              ]),
            )
          : undefined,
    });

    return Response.json({ ok: true, savedAt: saved.savedAt });
  } catch (error) {
    if (error instanceof PaperError) {
      const status =
        error.code === "not_permitted" ? 403 : error.code === "not_found" ? 404 : 409;
      return Response.json(await said({ error: error.message }), { status });
    }
    throw error;
  }
}
