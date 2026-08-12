import { currentSession, requestContext } from "@/lib/request";
import { uploadEvidence } from "@/lib/uploads";
import { errorResponse } from "@/app/api/lessons/[id]/media/route";

const ABSOLUTE_MAX_BYTES = 500 * 1024 * 1024;

/** A learner attaching evidence to their own submission. */
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
      { error: "That is larger than this platform accepts." },
      { status: 413 },
    );
  }

  try {
    const form = await request.formData();
    const files = form
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File);

    if (files.length === 0) {
      return Response.json({ error: "No files were sent." }, { status: 400 });
    }

    const context = await requestContext();

    const stored = await uploadEvidence(
      session,
      id,
      await Promise.all(
        files.map(async (file) => ({
          filename: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      ),
      { ipAddress: context.ipAddress },
    );

    return Response.json({
      ok: true,
      files: stored.map((item) => ({
        filename: item.filename,
        label: item.label,
        sizeBytes: item.sizeBytes,
        // Shown to the learner so they can see their evidence was fingerprinted.
        sha256: item.sha256,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
