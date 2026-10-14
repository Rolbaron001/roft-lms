import { currentSession, said } from "@/lib/request";
import { readFeedbackFile } from "@/lib/uploads";
import { errorResponse, fileResponse } from "@/app/api/lessons/[id]/media/route";

/**
 * Serves a file an assessor attached to their feedback: to staff who may mark
 * the work, or to the learner once it has been returned to them. The check is
 * in readFeedbackFile, against the database record.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await currentSession();
  if (!session) return new Response(await said("Sign in first."), { status: 401 });

  const { id } = await params;

  try {
    const file = await readFeedbackFile(session, id);
    return fileResponse(file, new URL(request.url).searchParams.has("download"));
  } catch (error) {
    return errorResponse(error);
  }
}
