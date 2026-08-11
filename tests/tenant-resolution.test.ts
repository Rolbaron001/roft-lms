import { describe, expect, it } from "vitest";
import { preferredHost, resolveHost } from "@/lib/tenant";
import { redact } from "@/lib/audit";

const PLATFORM = "lms.roftbusiness.org";

describe("choosing which host header to believe", () => {
  /**
   * Regression test for a bug that broke sign-in: on the request following a
   * form submission, Next.js replaces `host` with the server's own address and
   * keeps the real hostname in `x-forwarded-host`. Reading `host` alone made
   * the tenant disappear immediately after a successful login — and would have
   * broken every request behind the reverse proxy this deploys onto.
   */
  it("prefers the forwarded host when the two disagree", () => {
    expect(preferredHost("localhost:3000", "acme.localhost:3000")).toBe(
      "acme.localhost:3000",
    );
  });

  it("falls back to host when nothing was forwarded", () => {
    expect(preferredHost("acme.localhost:3000", null)).toBe(
      "acme.localhost:3000",
    );
  });

  it("takes the original request from a chain of proxies", () => {
    expect(
      preferredHost("internal:8080", "acme.roftbusiness.org, edge.internal"),
    ).toBe("acme.roftbusiness.org");
  });

  it("ignores an empty forwarded header", () => {
    expect(preferredHost("acme.localhost:3000", "")).toBe("acme.localhost:3000");
    expect(preferredHost("acme.localhost:3000", "   ")).toBe(
      "acme.localhost:3000",
    );
  });

  it("returns null when there is no host at all", () => {
    expect(preferredHost(null, null)).toBeNull();
  });
});

describe("resolving a hostname to a tenant", () => {
  it("recognises the platform console", () => {
    expect(resolveHost(PLATFORM, PLATFORM)).toEqual({ kind: "platform" });
  });

  it("ignores the port", () => {
    expect(resolveHost(`${PLATFORM}:3000`, PLATFORM)).toEqual({
      kind: "platform",
    });
  });

  it("is case-insensitive", () => {
    expect(resolveHost("LMS.RoftBusiness.ORG", PLATFORM)).toEqual({
      kind: "platform",
    });
  });

  it("reads a tenant slug from a subdomain", () => {
    expect(resolveHost(`acme.${PLATFORM}`, PLATFORM)).toEqual({
      kind: "tenant_slug",
      slug: "acme",
    });
  });

  it("treats a tenant's own domain as a custom domain", () => {
    expect(resolveHost("learning.acme.com", PLATFORM)).toEqual({
      kind: "custom_domain",
      domain: "learning.acme.com",
    });
  });

  /**
   * A deeper subdomain is not a tenant slug. Reading "evil" out of
   * "evil.acme.lms.roftbusiness.org" would let a nested host impersonate one.
   */
  it("does not read a slug out of a nested subdomain", () => {
    expect(resolveHost(`evil.acme.${PLATFORM}`, PLATFORM)).toEqual({
      kind: "custom_domain",
      domain: `evil.acme.${PLATFORM}`,
    });
  });

  it("does not mistake a lookalike domain for the platform", () => {
    expect(resolveHost("lms.roftbusiness.org.attacker.com", PLATFORM)).toEqual({
      kind: "custom_domain",
      domain: "lms.roftbusiness.org.attacker.com",
    });
  });

  it("supports *.localhost for development", () => {
    expect(resolveHost("acme.localhost:3000", "localhost:3000")).toEqual({
      kind: "tenant_slug",
      slug: "acme",
    });
    expect(resolveHost("localhost:3000", "localhost:3000")).toEqual({
      kind: "platform",
    });
  });

  it("handles a bracketed IPv6 host without crashing", () => {
    expect(resolveHost("[::1]:3000", PLATFORM)).toEqual({
      kind: "custom_domain",
      domain: "[::1]",
    });
  });
});

describe("audit redaction", () => {
  it("removes credentials from a snapshot", () => {
    const redacted = redact({
      email: "someone@example.test",
      passwordHash: "$2b$12$something",
      nested: { token: "secret-value", keep: "visible" },
    }) as Record<string, unknown>;

    expect(redacted.email).toBe("someone@example.test");
    expect(redacted.passwordHash).toBe("[redacted]");
    expect((redacted.nested as Record<string, unknown>).token).toBe(
      "[redacted]",
    );
    expect((redacted.nested as Record<string, unknown>).keep).toBe("visible");
  });

  it("walks arrays", () => {
    const redacted = redact([{ password: "hunter2" }]) as Record<
      string,
      unknown
    >[];
    expect(redacted[0].password).toBe("[redacted]");
  });

  it("leaves primitives alone", () => {
    expect(redact("plain")).toBe("plain");
    expect(redact(null)).toBe(null);
    expect(redact(42)).toBe(42);
  });
});
