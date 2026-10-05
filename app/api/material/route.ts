import { currentSession, said } from "@/lib/request";
import { uploadLibraryItem } from "@/lib/library";
import { errorResponse } from "@/app/api/lessons/[id]/media/route";

/** Ceiling before the file is read into memory at all. */
const ABSOLUTE_MAX_BYTES = 500 * 1024 * 1024;

/**
 * Adds an item to the provider's library, optionally using it on a study
 * unit at once. A route rather than a server action because a video can be
 * hundreds of megabytes.
 */
export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return new Response(await said("Sign in first."), { status: 401 });

  if (Number(request.headers.get("content-length") ?? 0) > ABSOLUTE_MAX_BYTES) {
    return Response.json(await said({ error: "That file is larger than this platform accepts." }), { status: 413 });
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json(await said({ error: "No file was sent." }), { status: 400 });
    const text = (name: string) => String(form.get(name) ?? "").trim() || undefined;
    const added = await uploadLibraryItem(
      session,
      { title: text("title"), description: text("description"), studyUnitId: text("studyUnitId"), releaseWithStepId: text("releaseWithStepId") },
      { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
    );
    return Response.json({ ok: true, id: added.id });
  } catch (error) {
    return errorResponse(error);
  }
}
