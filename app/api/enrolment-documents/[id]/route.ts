import { DocumentError, readEnrolmentDocument } from "@/lib/enrolment-documents";
import { currentSession } from "@/lib/request";
import { errorResponse, fileResponse } from "@/app/api/lessons/[id]/media/route";

/**
 * Serves one enrolment document to the learner it belongs to, or to somebody
 * who manages enrolments and has to check it before accepting it.
 *
 * The check happens in readEnrolmentDocument against the database record, not
 * against the storage key.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await currentSession();
  if (!session) return new Response("Sign in first.", { status: 401 });

  const { id } = await params;

  try {
    const file = await readEnrolmentDocument(session, id);
    return fileResponse(file, new URL(request.url).searchParams.has("download"));
  } catch (error) {
    if (error instanceof DocumentError) {
      return Response.json(
        { error: error.message },
        { status: error.code === "not_found" ? 404 : 400 },
      );
    }
    return errorResponse(error);
  }
}
