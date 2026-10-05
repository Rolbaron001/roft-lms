import { NextResponse, type NextRequest } from "next/server";

/**
 * While an administrator views the platform as somebody else ("View as",
 * lib/view-as.ts), nothing may be changed: every request that is not reading
 * a page is refused here, before it reaches the application. Server actions
 * arrive as POST requests, so they are refused too. The way out is the one
 * exception. The database is read-only for these requests as well
 * (db/client.ts), so this is the first of two locks, not the only one.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.get("roft_view_as")?.value) return NextResponse.next();
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return NextResponse.next();
  if (request.nextUrl.pathname === "/api/view-as/stop") return NextResponse.next();
  return NextResponse.json(
    { ok: false, error: "You are viewing the platform as somebody else, so nothing can be changed. Stop viewing first." },
    { status: 403 },
  );
}

export const config = {
  // Everything but the framework's own static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
