import { createHash } from "node:crypto";
import { requireSession } from "@/lib/request";
import { CohortFileError, cohortFileEntries } from "@/lib/cohort-file";
import { writeArchive } from "@/lib/archive-writer";
import { PermissionDeniedError } from "@/lib/rbac";

/**
 * The whole cohort file as one zip, laid out as the provider's own cohort
 * folder is (job sheet D20), for a monitor or an auditor. Streamed: the
 * server holds one file at a time, however large the cohort's evidence is.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ cohortId: string }> }) {
  const { cohortId } = await params;
  const session = await requireSession();
  let built;
  try {
    built = await cohortFileEntries(session, cohortId);
  } catch (error) {
    if (error instanceof CohortFileError || error instanceof PermissionDeniedError) {
      return new Response(error.message, { status: 404 });
    }
    throw error;
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await writeArchive(
          built.entries,
          async (piece) => controller.enqueue(piece),
          async (bytes) => new Uint8Array(createHash("sha256").update(bytes).digest()),
        );
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${`${built.name} ${stamp}.zip`.replace(/["\\]/g, "")}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
