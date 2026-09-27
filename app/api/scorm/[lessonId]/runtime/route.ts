import { currentSession } from "@/lib/request";
import { EnrolmentError } from "@/lib/enrolment";
import { saveScormReport, scormLaunch, ScormError, type ScormReport } from "@/lib/scorm";

/**
 * The SCORM package's line back to the platform (job sheet D8): what it starts
 * from, and what it reports. The player page's `window.API` calls these.
 */
export async function GET(request: Request, { params }: { params: Promise<{ lessonId: string }> }) {
  const session = await currentSession();
  if (!session) return new Response("Sign in first.", { status: 401 });
  const { lessonId } = await params;
  try {
    const enrolmentId = new URL(request.url).searchParams.get("enrolment");
    return Response.json(await scormLaunch(session, lessonId, enrolmentId));
  } catch (error) {
    if (error instanceof ScormError) return Response.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ lessonId: string }> }) {
  const session = await currentSession();
  if (!session) return new Response("Sign in first.", { status: 401 });
  const { lessonId } = await params;

  const body = (await request.json().catch(() => null)) as { enrolmentId?: string; report?: ScormReport } | null;
  if (!body?.enrolmentId || !body.report) return Response.json({ error: "Nothing to save." }, { status: 400 });

  // Strings only, as SCORM hands them over; anything else is ignored.
  const report: ScormReport = {};
  for (const key of ["lessonStatus", "scoreRaw", "scoreMin", "scoreMax", "lessonLocation", "suspendData", "exit", "sessionTime"] as const) {
    const value = body.report[key];
    if (typeof value === "string") report[key] = value;
  }
  report.finished = body.report.finished === true;

  try {
    return Response.json(await saveScormReport(session, lessonId, body.enrolmentId, report));
  } catch (error) {
    if (error instanceof ScormError || error instanceof EnrolmentError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
