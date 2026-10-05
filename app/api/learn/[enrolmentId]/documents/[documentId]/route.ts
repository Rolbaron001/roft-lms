import { currentSession, said } from "@/lib/request";
import { readLearnerDocument } from "@/lib/learner-unit";
import { rangeResponse } from "@/lib/serve-range";
import { errorResponse } from "@/app/api/lessons/[id]/media/route";

/**
 * A document on a learner's path, the theory guide above all: read in the
 * page's viewer, or downloaded with ?download. The checks are in
 * readLearnerDocument: the step must be on this enrolment's course and open.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ enrolmentId: string; documentId: string }> },
) {
  const session = await currentSession();
  if (!session) return new Response(await said("Sign in first."), { status: 401 });
  const { enrolmentId, documentId } = await params;
  try {
    const file = await readLearnerDocument(session, enrolmentId, documentId);
    return rangeResponse(request, file, new URL(request.url).searchParams.has("download"));
  } catch (error) {
    return errorResponse(error);
  }
}
