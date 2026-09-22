import { requireSession } from "@/lib/request";
import { readLibraryDocument, RecordsError } from "@/lib/records";

/**
 * Downloads a library document.
 *
 * Always as an attachment, never rendered in the page: these are files from
 * outside the platform and a browser must not be given the chance to execute
 * one in the application's own origin.
 *
 * Who may read it is decided in readLibraryDocument, beside the rule the
 * listing uses, so a learner cannot reach an internal policy by holding its
 * identifier.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();

  try {
    const document = await readLibraryDocument(session, id);

    return new Response(new Uint8Array(document.bytes), {
      headers: {
        "content-type": document.mimeType,
        "content-disposition": `attachment; filename="${document.filename.replace(/["\\]/g, "")}"`,
        "content-length": String(document.bytes.byteLength),
        // A tenant's own policies. Nothing caches these anywhere shared.
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof RecordsError) {
      return new Response(error.message, { status: 404 });
    }
    throw error;
  }
}
