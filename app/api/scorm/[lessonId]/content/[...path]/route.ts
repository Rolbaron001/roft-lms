import { currentSession, said } from "@/lib/request";
import { readScormFile, ScormError } from "@/lib/scorm";

/**
 * One file of a lesson's SCORM package (job sheet D8).
 *
 * Served as what it is, HTML and script included, because a package is a
 * small website and has to run as one. `frame-ancestors 'self'` lets the
 * platform's own lesson page hold it in a frame and nobody else's: the
 * application and the proxy send `X-Frame-Options: DENY` on everything, and a
 * frame-ancestors policy overrides that header (CSP Level 3, 6.4.2.2, checked
 * 27 September), so the package plays without the rest of the platform being
 * framable.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lessonId: string; path: string[] }> },
) {
  const session = await currentSession();
  if (!session) return new Response(await said("Sign in first."), { status: 401 });

  const { lessonId, path } = await params;
  try {
    const file = await readScormFile(session, lessonId, path.map(decodeURIComponent).join("/"));
    return new Response(Buffer.from(file.bytes), {
      headers: {
        "content-type": file.contentType,
        "content-security-policy": "frame-ancestors 'self'",
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (error) {
    if (error instanceof ScormError) return new Response(error.message, { status: 404 });
    throw error;
  }
}
