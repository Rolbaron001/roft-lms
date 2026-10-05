import { NextResponse } from "next/server";
import { VIEW_AS_COOKIE } from "@/lib/view-as";

/**
 * Stops viewing the platform as somebody else and returns to that person's
 * page. The one request proxy.ts lets through while viewing. It writes
 * nothing: the database is read-only for any request carrying the cookie.
 */
export async function POST(request: Request) {
  const viewed = request.headers.get("cookie")?.match(new RegExp(`${VIEW_AS_COOKIE}=([0-9a-f-]{36})`))?.[1];
  // A relative address: the server's own idea of its host is the internal
  // one behind the proxy, not the provider's address the browser is on.
  const response = new NextResponse(null, { status: 303, headers: { location: viewed ? `/people/${viewed}` : "/" } });
  response.cookies.set(VIEW_AS_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
