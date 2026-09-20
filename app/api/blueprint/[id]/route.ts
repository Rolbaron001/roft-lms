import { requireSession } from "@/lib/request";
import { blueprintFor, blueprintJson } from "@/lib/blueprint-export";
import { AuthoringError } from "@/lib/authoring";

/**
 * Downloads a qualification's `blueprint.json`.
 *
 * The file goes into the qualification folder's `_control/` directory, and
 * every import of that folder afterwards reads it directly instead of paying a
 * model to work the structure out again. See lib/blueprint-export.ts.
 *
 * Whatever the export could not carry is returned in a header rather than
 * written into the file - the file has to stay valid against the schema, and a
 * comment is not a thing JSON has. The screen that links here shows the same
 * notes in full; this is for anybody who reached the URL directly.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();

  try {
    const { file, filename, notes } = await blueprintFor(session, id);

    return new Response(blueprintJson(file), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${filename.replace(/["\\]/g, "")}"`,
        // A tenant's whole curriculum. Nothing caches this anywhere shared.
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        ...(notes.length > 0
          ? { "x-blueprint-notes": notes.join(" | ").replace(/[^\x20-\x7e]/g, " ") }
          : {}),
      },
    });
  } catch (error) {
    if (error instanceof AuthoringError) {
      return new Response(error.message, { status: 404 });
    }
    throw error;
  }
}
