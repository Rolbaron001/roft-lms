import { Readable } from "node:stream";
import { ArchiveError, archiveForDownload } from "@/lib/cohort-archive";
import { PermissionDeniedError } from "@/lib/rbac";
import { currentSession } from "@/lib/request";

/**
 * Downloads a built cohort archive.
 *
 * Streamed from disk rather than read into memory: an archive can pass a
 * gigabyte and the server has less than that. The length is sent so the
 * browser can show progress and, more to the point, so a download cut short is
 * visibly incomplete rather than a smaller file that looks finished.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await currentSession();
  if (!session) return new Response("Sign in first.", { status: 401 });

  const { id } = await params;

  try {
    const archive = await archiveForDownload(session, id);
    const ascii = archive.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
    return new Response(Readable.toWeb(archive.stream()) as ReadableStream, {
      headers: {
        "content-type": "application/zip",
        "content-length": String(archive.sizeBytes),
        "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(archive.filename)}`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return Response.json({ error: "Not permitted." }, { status: 403 });
    }
    if (error instanceof ArchiveError) {
      return Response.json(
        { error: error.message },
        { status: error.reason === "not_found" ? 404 : 409 },
      );
    }
    throw error;
  }
}
