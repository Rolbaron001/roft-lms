import { resolveTenant } from "@/lib/tenant";

/**
 * Decides whether Caddy may obtain a TLS certificate for a hostname.
 *
 * Certificates are issued on demand rather than from one wildcard, because a
 * wildcard only covers `*.lms.roftbusiness.org`. A client on their own domain
 * — `learning.acmemining.co.za`, which the tenant model supports — is not
 * covered by any wildcard we could obtain, and a wildcard additionally
 * requires DNS provider credentials to sit on this server. On-demand issuance
 * needs neither, and a new tenant works the moment their DNS points here.
 *
 * The gate matters. Without it, anyone who points a hostname at this server
 * makes it request a certificate, and the certificate authority's rate limit
 * is reached by a stranger — after which no genuine tenant can get one either.
 * So: a certificate is issued only for a hostname that already resolves to a
 * tenant in this database.
 *
 * Caddy calls this with ?domain=<hostname> and reads only the status code.
 * Reached from the internal network by Caddy alone, and it reveals nothing an
 * attacker could not learn by visiting the hostname.
 */
export async function GET(request: Request) {
  const domain = new URL(request.url).searchParams.get("domain");

  if (!domain) {
    return new Response("no domain given", { status: 400 });
  }

  try {
    const tenant = await resolveTenant(domain);

    // Suspended tenants still get a certificate: they need to reach the page
    // that tells them they are suspended, and letting the certificate lapse
    // turns a billing conversation into a browser security warning.
    return tenant
      ? new Response("ok", { status: 200 })
      : new Response("unknown host", { status: 404 });
  } catch {
    // A database blip must not become a permanent refusal — Caddy retries,
    // and 503 says "ask again" where 404 says "never".
    return new Response("cannot check right now", { status: 503 });
  }
}
