import { currentSession, said } from "@/lib/request";
import { readLibraryItem } from "@/lib/library";
import { rangeResponse } from "@/lib/serve-range";
import { errorResponse } from "@/app/api/lessons/[id]/media/route";

/** A piece of learning material, for staff looking after it. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return new Response(await said("Sign in first."), { status: 401 });
  const { id } = await params;
  try {
    const file = await readLibraryItem(session, id);
    return rangeResponse(request, file, new URL(request.url).searchParams.has("download"));
  } catch (error) {
    return errorResponse(error);
  }
}
