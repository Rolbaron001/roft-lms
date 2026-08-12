import { currentSession } from "@/lib/request";
import { readEvidence } from "@/lib/uploads";
import { errorResponse, fileResponse } from "@/app/api/lessons/[id]/media/route";

/**
 * Serves one piece of evidence to somebody entitled to see it: the learner who
 * submitted it, or an assessor, moderator or external verifier.
 *
 * The check happens in readEvidence against the database record, not against
 * the storage key, so knowing a key is worth nothing on its own.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await currentSession();
  if (!session) return new Response("Sign in first.", { status: 401 });

  const { id } = await params;

  try {
    const file = await readEvidence(session, id);
    return fileResponse(file, new URL(request.url).searchParams.has("download"));
  } catch (error) {
    return errorResponse(error);
  }
}
