import type { ServableFile } from "./uploads";

/**
 * Serves a stored file, honouring a byte range when the browser asks for one.
 *
 * A video player asks for ranges so it can start before the whole file has
 * arrived and jump about in it; Safari will not play a video at all without
 * them. The security headers are the same as for every other stored file
 * (see app/api/lessons/[id]/media/route.ts): the real type, nosniff, a
 * download for anything that could carry script, and a sandbox.
 */
export function rangeResponse(request: Request, file: ServableFile, forceDownload = false): Response {
  const inline = file.safeToEmbed && !forceDownload;
  const safeName = file.filename.replace(/["\\]/g, "_");
  const total = file.bytes.byteLength;
  const headers: Record<string, string> = {
    "content-type": file.mimeType,
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox; default-src 'none'",
    "cache-control": "private, max-age=300",
    "accept-ranges": "bytes",
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    if (start >= total || start > end) {
      return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${total}` } });
    }
    const slice = file.bytes.slice(start, end + 1);
    return new Response(slice, {
      status: 206,
      headers: { ...headers, "content-length": String(slice.byteLength), "content-range": `bytes ${start}-${end}/${total}` },
    });
  }

  return new Response(new Uint8Array(file.bytes), { headers: { ...headers, "content-length": String(total) } });
}
