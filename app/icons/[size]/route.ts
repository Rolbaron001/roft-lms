import { iconPng } from "@/lib/app-icon";
import { currentTenant } from "@/lib/request";

/**
 * The install icons, drawn in the provider's own colour (lib/app-icon.ts).
 *
 * Chrome offers to install a web app only when its manifest names a 192 pixel
 * and a 512 pixel icon. The manifest named the provider's logo at no stated
 * size, or nothing, so Android never offered the ranger programme's learners
 * the install the whole offline design rests on.
 *
 * Served only where offline is switched on, like the manifest that names it.
 */
const SIZES = new Set([192, 512]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ size: string }> },
) {
  const tenant = await currentTenant();
  if (!tenant?.offlineEnabled) return new Response("Not found.", { status: 404 });

  const size = Number((await params).size);
  if (!SIZES.has(size)) return new Response("Not found.", { status: 404 });

  return new Response(new Uint8Array(iconPng(size, tenant.primaryColour ?? "")), {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
  });
}
