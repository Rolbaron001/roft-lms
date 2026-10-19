import { currentSession, said } from "@/lib/request";
import { readQualificationResource } from "@/lib/learner-unit";
import { errorResponse, fileResponse } from "@/app/api/lessons/[id]/media/route";

/** A SAQA or QCTO document published for a qualification, for its learners. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await currentSession();
  if (!session) return new Response(await said("Sign in first."), { status: 401 });
  const { id } = await params;
  try {
    const file = await readQualificationResource(session, id);
    return fileResponse(file, new URL(request.url).searchParams.has("download"));
  } catch (error) {
    return errorResponse(error);
  }
}
