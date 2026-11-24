import { currentSession, said } from "@/lib/request";
import { readProgrammeHandbook } from "@/lib/learner-unit";
import { rangeResponse } from "@/lib/serve-range";
import { errorResponse } from "@/app/api/lessons/[id]/media/route";

/**
 * A learner handbook or other learner document filed for the whole programme,
 * read in the page reader or downloaded with ?download. The checks are in
 * readProgrammeHandbook: on the programme, and released by the cohort.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return new Response(await said("Sign in first."), { status: 401 });
  const { id } = await params;
  try {
    const search = new URL(request.url).searchParams;
    const file = await readProgrammeHandbook(session, id, { asPdf: search.get("as") === "pdf" });
    return rangeResponse(request, file, search.has("download"));
  } catch (error) {
    return errorResponse(error);
  }
}
