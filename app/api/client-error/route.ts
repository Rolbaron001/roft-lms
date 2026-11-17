import { NextResponse } from "next/server";

/**
 * A page that failed in someone's browser, written to the server log.
 *
 * Roland, 17 November 2026: committing a folder on live twice ended on
 * "This page couldn't load" although the commit had finished on the server,
 * and nothing was logged anywhere, because the failure was in the browser.
 * The app's error pages post what failed here, so the next one can be read in
 * the deploy log rather than guessed at. Text only, capped, and never echoed.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
    console.error(
      "client error",
      JSON.stringify({
        url: text(body.url, 300),
        message: text(body.message, 600),
        digest: text(body.digest, 80),
        stack: text(body.stack, 2000),
        at: new Date().toISOString(),
      }),
    );
  } catch {
    /* a malformed report is not worth a failure of its own */
  }
  return new NextResponse(null, { status: 204 });
}
