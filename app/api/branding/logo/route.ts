import { currentSession, currentTenant } from "@/lib/request";
import { readTenantLogo, uploadTenantLogo, UploadError } from "@/lib/uploads";
import { PermissionDeniedError } from "@/lib/rbac";

/**
 * A tenant's logo: fetched by anybody, replaced by whoever manages branding.
 *
 * GET is deliberately unauthenticated, because the sign-in page carries the
 * tenant's branding and nobody has signed in yet. It is still not a way to
 * read another tenant's data: the tenant comes from the hostname the request
 * arrived on, never from anything the caller supplies, so there is no id to
 * change and nothing to enumerate.
 */

/** A logo is displayed small; anything larger than this is a mistake. */
const ABSOLUTE_MAX_BYTES = 8 * 1024 * 1024;

export async function GET() {
  const tenant = await currentTenant();
  if (!tenant) return new Response("Not found.", { status: 404 });

  try {
    const file = await readTenantLogo(tenant.id);
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.mimeType,
        // The address carries the file's hash, so this specific address always
        // means this specific image and can be cached hard.
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found.", { status: 404 });
  }
}

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return new Response("Sign in first.", { status: 401 });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > ABSOLUTE_MAX_BYTES) {
    return Response.json(
      { error: "That image is larger than this platform accepts." },
      { status: 413 },
    );
  }

  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "No file was sent." }, { status: 400 });
    }

    const stored = await uploadTenantLogo(session, {
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });

    return Response.json({ ok: true, ...stored });
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return Response.json(
        { error: "You cannot change this organisation's branding." },
        { status: 403 },
      );
    }
    if (error instanceof UploadError) {
      const status =
        error.code === "too_large" ? 413 : error.code === "not_found" ? 404 : 400;
      return Response.json({ error: error.message }, { status });
    }
    throw error;
  }
}
