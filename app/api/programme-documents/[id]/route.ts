import { requireSession } from "@/lib/request";
import {
  readProgrammeDocument,
  ProgrammeDocumentError,
} from "@/lib/programme-documents";

/**
 * Downloads a programme document.
 *
 * Always as an attachment, never rendered in the page. These are Word and
 * Excel files from outside the platform, and the one thing that must not
 * happen is a browser deciding to execute something in the application's own
 * origin. The permission check lives in readProgrammeDocument, so a marking
 * memorandum cannot be reached by any other caller either.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();

  try {
    const document = await readProgrammeDocument(session, id);

    return new Response(new Uint8Array(document.bytes), {
      headers: {
        "content-type": document.mimeType,
        "content-disposition": `attachment; filename="${document.filename.replace(/["\\]/g, "")}"`,
        "content-length": String(document.bytes.byteLength),
        // Learning material is not public, and a shared cache holding it would
        // hand one tenant's handbook to another.
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ProgrammeDocumentError) {
      return new Response(error.message, { status: 404 });
    }
    throw error;
  }
}
