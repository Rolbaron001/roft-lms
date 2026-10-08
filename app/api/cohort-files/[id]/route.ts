import { requireSession } from "@/lib/request";
import { CohortFileError, readCohortFile } from "@/lib/cohort-file";
import { PermissionDeniedError } from "@/lib/rbac";

/**
 * Downloads one file from a cohort's file (job sheet D20): a facilitation
 * plan, the induction pack, a monitoring report. Always as an attachment,
 * for the same reason as programme documents: these come from outside the
 * platform and must never run in its origin.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  try {
    const { file, bytes } = await readCohortFile(session, id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": file.mimeType,
        "content-disposition": `attachment; filename="${file.filename.replace(/["\\]/g, "")}"`,
        "content-length": String(bytes.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof CohortFileError || error instanceof PermissionDeniedError) {
      return new Response(error.message, { status: 404 });
    }
    throw error;
  }
}
