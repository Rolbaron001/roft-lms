import { requireSession } from "@/lib/request";
import { readMailAttachment, MailboxError } from "@/lib/mailbox";

/**
 * Downloads an attachment from a message in your own mailbox.
 *
 * Always as an attachment, never rendered. These files arrived from strangers
 * over SMTP, and the one thing that must not happen is a browser deciding to
 * execute one in the application's own origin.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await requireSession();

  try {
    const file = await readMailAttachment(session, id);

    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "content-type": file.mimeType,
        "content-disposition": `attachment; filename="${file.filename.replace(/["\\]/g, "")}"`,
        "content-length": String(file.bytes.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof MailboxError) {
      return new Response("Not found", { status: 404 });
    }
    throw error;
  }
}
