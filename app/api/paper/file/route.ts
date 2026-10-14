import { currentSession, said } from "@/lib/request";
import { removeAnswerFile, uploadEvidence, UploadError } from "@/lib/uploads";

/**
 * A file answering one question on a paper: a photograph of completed work, a
 * recording, a document. Posted on its own as the learner chooses it, so a
 * large video does not hold up the rest of the paper.
 */
export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return new Response(await said("Sign in first."), { status: 401 });

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return Response.json(await said({ error: "Choose a file." }), { status: 400 });
    }

    const [stored] = await uploadEvidence(
      session,
      String(form.get("submissionId") ?? ""),
      [{ filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }],
      {
        itemId: String(form.get("itemId") ?? ""),
        ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      },
    );

    return Response.json({ ok: true, filename: stored.filename, sizeBytes: stored.sizeBytes });
  } catch (error) {
    return failed(error);
  }
}

export async function DELETE(request: Request) {
  const session = await currentSession();
  if (!session) return new Response(await said("Sign in first."), { status: 401 });

  try {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    await removeAnswerFile(session, id);
    return Response.json({ ok: true });
  } catch (error) {
    return failed(error);
  }
}

async function failed(error: unknown) {
  if (error instanceof UploadError) {
    const status =
      error.code === "not_permitted" ? 403 : error.code === "not_found" ? 404 : error.code === "too_large" ? 413 : 400;
    return Response.json(await said({ error: error.message }), { status });
  }
  throw error;
}
