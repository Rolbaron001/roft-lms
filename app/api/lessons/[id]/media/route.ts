import { currentSession, requestContext } from "@/lib/request";
import { readLessonMedia, uploadLessonMedia, UploadError } from "@/lib/uploads";
import { PermissionDeniedError } from "@/lib/rbac";

/** Ceiling before the file is read into memory at all. */
const ABSOLUTE_MAX_BYTES = 500 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await currentSession();
  if (!session) return new Response("Sign in first.", { status: 401 });

  const { id } = await params;

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > ABSOLUTE_MAX_BYTES) {
    return Response.json(
      { error: "That file is larger than this platform accepts." },
      { status: 413 },
    );
  }

  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "No file was sent." }, { status: 400 });
    }

    const stored = await uploadLessonMedia(session, id, {
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });

    return Response.json({
      ok: true,
      filename: stored.filename,
      label: stored.label,
      kind: stored.kind,
      sizeBytes: stored.sizeBytes,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await currentSession();
  if (!session) return new Response("Sign in first.", { status: 401 });

  const { id } = await params;
  void requestContext;

  try {
    const file = await readLessonMedia(session, id);
    return fileResponse(file, new URL(request.url).searchParams.has("download"));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Serves a stored file.
 *
 * Three headers do the security work here, and each is load-bearing:
 *
 *   nosniff            stops the browser second-guessing the content type and
 *                      deciding a file is really HTML.
 *   Content-Disposition  anything that could carry script is sent as a
 *                      download rather than rendered in the page.
 *   sandbox CSP        even if something slipped through, it runs with no
 *                      script, no forms and no access to anything.
 */
export function fileResponse(
  file: {
    bytes: Uint8Array;
    mimeType: string;
    filename: string;
    safeToEmbed: boolean;
  },
  forceDownload = false,
): Response {
  const inline = file.safeToEmbed && !forceDownload;

  // Quotes and backslashes would otherwise let a filename break out of the
  // header value.
  const safeName = file.filename.replace(/["\\]/g, "_");

  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "content-type": file.mimeType,
      "content-length": String(file.bytes.byteLength),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      // Learner material is private to a tenant and must not sit in a shared
      // cache between them.
      "cache-control": "private, max-age=300",
    },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof PermissionDeniedError) {
    return Response.json({ error: "Not permitted." }, { status: 403 });
  }

  if (error instanceof UploadError) {
    const status =
      error.code === "not_found"
        ? 404
        : error.code === "not_permitted"
          ? 403
          : error.code === "too_large"
            ? 413
            : 400;
    return Response.json({ error: error.message }, { status });
  }

  console.error(error);
  return Response.json(
    { error: "That could not be handled. Please try again." },
    { status: 500 },
  );
}
