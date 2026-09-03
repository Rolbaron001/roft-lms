import { describe, expect, it } from "vitest";
import { readJson, knownProviders, providerByName } from "@/lib/extensions";
import { isAllowedRoot } from "@/lib/folder-walk";
import { ROLE_PERMISSIONS, can, type Role } from "@/lib/rbac";

describe("readJson", () => {
  it("reads a bare object", () => {
    expect(readJson<{ ok: boolean }>('{"ok":true}')).toEqual({ ok: true });
  });

  /**
   * Verified against the real provider, which fenced its reply on the very
   * first call despite being told not to. A strict parser would have turned a
   * correct answer into a failed run.
   */
  it("reads one wrapped in a code fence", () => {
    const answer = '```json\n{"ok":true,"who":"lms"}\n```';
    expect(readJson<{ who: string }>(answer)).toEqual({
      ok: true,
      who: "lms",
    });
  });

  it("reads one with a sentence in front of it", () => {
    const answer = 'Here is the qualification:\n{"title":"Something"}';
    expect(readJson<{ title: string }>(answer)).toEqual({
      title: "Something",
    });
  });

  it("returns null rather than throwing on prose", () => {
    expect(readJson("I could not find a curriculum document.")).toBeNull();
    expect(readJson("")).toBeNull();
  });

  it("returns null on JSON that is truncated", () => {
    expect(readJson('{"modules":[{"code":"KM-01"')).toBeNull();
  });
});

/**
 * "Point it at a folder", given to a server process, otherwise means "read any
 * file the service account can reach" - which on the production server
 * includes the platform's own configuration.
 */
describe("isAllowedRoot", () => {
  const roots = ["/srv/qualifications", "/srv/intake"];

  it("allows a root itself", () => {
    expect(isAllowedRoot("/srv/qualifications", roots)).toBe(true);
  });

  it("allows a folder inside one", () => {
    expect(isAllowedRoot("/srv/qualifications/hrm-2026", roots)).toBe(true);
  });

  it("refuses anything outside", () => {
    expect(isAllowedRoot("/etc", roots)).toBe(false);
    expect(isAllowedRoot("/srv", roots)).toBe(false);
  });

  /**
   * The one that matters. A path that climbs out with `..` resolves to
   * somewhere else entirely, and comparing the strings as typed would let it
   * through.
   */
  it("refuses a path that climbs out", () => {
    expect(isAllowedRoot("/srv/qualifications/../../etc", roots)).toBe(false);
  });

  /**
   * A neighbouring folder whose name merely starts with an allowed one is not
   * inside it. "/srv/intake-private" is not under "/srv/intake".
   */
  it("refuses a sibling with a similar name", () => {
    expect(isAllowedRoot("/srv/intake-private", roots)).toBe(false);
  });

  /** Nothing allowed means nothing readable, which is the safe default. */
  it("refuses everything when no roots are set", () => {
    expect(isAllowedRoot("/srv/qualifications", [])).toBe(false);
  });
});

describe("the provider registry", () => {
  it("knows the subscription-backed provider", () => {
    const provider = providerByName("claude_code");
    expect(provider).not.toBeNull();
    expect(provider?.label).toContain("subscription");
  });

  it("returns nothing for a name it does not know", () => {
    expect(providerByName("some_other_model")).toBeNull();
    expect(providerByName(null)).toBeNull();
  });

  /**
   * No provider may carry a credential. The subscription-backed one holds its
   * own sign-in on the machine it runs on, and the platform never sees one -
   * there is no field for it and no column for it.
   */
  it("exposes no credential anywhere on a provider", () => {
    for (const provider of knownProviders()) {
      const keys = Object.keys(provider);
      expect(keys).not.toContain("apiKey");
      expect(keys).not.toContain("token");
      expect(keys).not.toContain("credential");
    }
  });
});

/**
 * Who may switch on model assistance.
 *
 * The point of holding this per user rather than per tenant: a platform where
 * only the administrator may enable it is a platform where only the
 * administrator has it, and a facilitator building a programme has the same
 * use for it as the person who bought the subscription.
 */
describe("who may use an AI extension", () => {
  const holders = (Object.keys(ROLE_PERMISSIONS) as Role[])
    .filter((role) => can({ roles: [role] }, "extension:use"))
    .sort();

  it("is every one of the provider's own staff roles", () => {
    expect(holders).toEqual([
      "assessor",
      "instructor",
      "moderator",
      "skills_development_facilitator",
      "tenant_admin",
    ]);
  });

  it("is not only the administrator", () => {
    expect(holders.length).toBeGreaterThan(1);
    expect(can({ roles: ["instructor"] }, "extension:use")).toBe(true);
    expect(can({ roles: ["assessor"] }, "extension:use")).toBe(true);
  });

  /** The learner's work is the thing being assessed. */
  it("is not the learner", () => {
    expect(can({ roles: ["learner"] }, "extension:use")).toBe(false);
  });

  /** Somebody else's employee, and the narrowest role on the platform. */
  it("is not the workplace coach", () => {
    expect(can({ roles: ["workplace_coach"] }, "extension:use")).toBe(false);
  });

  /** An auditor reads; they do not produce. */
  it("is not the external verifier", () => {
    expect(can({ roles: ["external_verifier"] }, "extension:use")).toBe(false);
  });

  /** ROFT hosts a tenant's records and holds no permission over them. */
  it("is not the platform owner", () => {
    expect(can({ roles: ["platform_owner"] }, "extension:use")).toBe(false);
  });

  /**
   * Listing the folders a server process may read stays with an administrator.
   * It is a security boundary rather than a preference, and every staff role
   * holding it would let any of them point the platform at its own
   * configuration.
   */
  it("does not let everybody choose which folders may be read", () => {
    expect(can({ roles: ["instructor"] }, "tenant:manage_settings")).toBe(false);
    expect(can({ roles: ["assessor"] }, "tenant:manage_settings")).toBe(false);
    expect(can({ roles: ["tenant_admin"] }, "tenant:manage_settings")).toBe(true);
  });
});
