import { currentSession, requestContext } from "@/lib/request";
import { submitEvidence } from "@/lib/assessment";
import { detectMedia, SIZE_LIMITS } from "@/lib/media";
import { errorResponse } from "@/app/api/lessons/[id]/media/route";

const ABSOLUTE_MAX_BYTES = 500 * 1024 * 1024;

/**
 * A learner submitting evidence against an assessment.
 *
 * Every file is checked by its contents before anything is written, and the
 * whole submission is refused if any one of them fails. A portfolio that is
 * half-accepted leaves the learner unsure what actually arrived, and the
 * assessor unsure what they are looking at.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await currentSession();
  if (!session) return new Response("Sign in first.", { status: 401 });

  const { id } = await params;

  if (Number(request.headers.get("content-length") ?? 0) > ABSOLUTE_MAX_BYTES) {
    return Response.json(
      { error: "That is larger than this platform accepts." },
      { status: 413 },
    );
  }

  try {
    const form = await request.formData();
    const uploaded = form
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File);

    if (uploaded.length === 0) {
      return Response.json({ error: "Choose at least one file." }, { status: 400 });
    }

    const files = await Promise.all(
      uploaded.map(async (file) => ({
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })),
    );

    for (const file of files) {
      const detected = detectMedia(file.bytes, file.filename);
      if (!detected.ok) {
        return Response.json(
          { error: `${file.filename}: ${detected.reason}` },
          { status: 400 },
        );
      }
      if (file.bytes.byteLength > SIZE_LIMITS[detected.kind]) {
        return Response.json(
          {
            error: `${file.filename} is too large for a ${detected.label.toLowerCase()}.`,
          },
          { status: 413 },
        );
      }
    }

    const context = await requestContext();

    const result = await submitEvidence(session, {
      assessmentId: id,
      enrolmentId: String(form.get("enrolmentId") ?? "") || null,
      note: String(form.get("note") ?? "") || undefined,
      files,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return Response.json({
      ok: true,
      submissionId: result.submissionId,
      files: result.files.map((file) => ({
        sha256: file.sha256,
        sizeBytes: file.sizeBytes,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
