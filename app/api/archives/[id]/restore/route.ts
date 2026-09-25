import {
  appendRestoreChunk,
  ArchiveError,
  RESTORE_CHUNK_BYTES,
  restoreProgress,
} from "@/lib/cohort-archive";
import { PermissionDeniedError } from "@/lib/rbac";
import { currentSession } from "@/lib/request";

/**
 * Giving an archive back, one piece at a time.
 *
 * In pieces because the proxy refuses a request over 512 MB and an archive can
 * be larger, and because a restore over a poor line that fails at 90% should
 * carry on from 90%. GET says how much has arrived; POST adds the next piece
 * at the offset the server expects and refuses any other.
 */

function failure(error: unknown): Response {
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await currentSession();
  if (!session) return new Response("Sign in first.", { status: 401 });
  const { id } = await params;

  try {
    return Response.json(await restoreProgress(session, id));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await currentSession();
  if (!session) return new Response("Sign in first.", { status: 401 });
  const { id } = await params;

  const offset = Number(new URL(request.url).searchParams.get("offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return Response.json({ error: "Say where this piece starts." }, { status: 400 });
  }

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > RESTORE_CHUNK_BYTES) {
    return Response.json(
      { error: `Send the archive in pieces of at most ${RESTORE_CHUNK_BYTES} bytes.` },
      { status: 413 },
    );
  }

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > RESTORE_CHUNK_BYTES) {
      return Response.json(
        { error: `Send the archive in pieces of at most ${RESTORE_CHUNK_BYTES} bytes.` },
        { status: 413 },
      );
    }
    return Response.json(await appendRestoreChunk(session, id, offset, bytes));
  } catch (error) {
    return failure(error);
  }
}
