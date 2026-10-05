import { currentSession, said } from "@/lib/request";
import { readLearnerLibraryItem } from "@/lib/learner-unit";
import { rangeResponse } from "@/lib/serve-range";
import { errorResponse } from "@/app/api/lessons/[id]/media/route";

/**
 * A piece of learning material on a learner's study unit: watched or viewed
 * in the page, or downloaded with ?download to keep for when there is no
 * signal (Heidi, 5 October 2026).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ enrolmentId: string; itemId: string }> },
) {
  const session = await currentSession();
  if (!session) return new Response(await said("Sign in first."), { status: 401 });
  const { enrolmentId, itemId } = await params;
  try {
    const file = await readLearnerLibraryItem(session, enrolmentId, itemId);
    return rangeResponse(request, file, new URL(request.url).searchParams.has("download"));
  } catch (error) {
    return errorResponse(error);
  }
}
