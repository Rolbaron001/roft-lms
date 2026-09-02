import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, can, type Role } from "@/lib/rbac";

/**
 * The confidentiality split, pinned.
 *
 * These are assertions about a POPIA position rather than about code, which is
 * exactly why they are worth a test: the failure mode is somebody adding
 * `support:read` to a role in a hurry because a facilitator asked why they
 * could not see something, and nothing anywhere else would object.
 */
describe("who may read a learner's health information", () => {
  const readers = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((role) =>
    can({ roles: [role] }, "support:read"),
  );

  it("is only the coordinating roles", () => {
    expect(readers.sort()).toEqual(["instructor", "tenant_admin"]);
  });

  /**
   * The people standing in front of the learner. They must be able to act on
   * an accommodation, and must not see the diagnosis that earned it.
   */
  it("does not include the assessor, who can still act on an accommodation", () => {
    expect(can({ roles: ["assessor"] }, "support:act")).toBe(true);
    expect(can({ roles: ["assessor"] }, "support:read")).toBe(false);
    expect(can({ roles: ["assessor"] }, "support:manage")).toBe(false);
  });

  it("does not include the moderator", () => {
    expect(can({ roles: ["moderator"] }, "support:act")).toBe(true);
    expect(can({ roles: ["moderator"] }, "support:read")).toBe(false);
  });

  /**
   * The narrowest role on the platform, and somebody else's employee. A
   * learner's diagnosis is emphatically not theirs to see.
   */
  it("does not include the workplace coach at any level", () => {
    expect(can({ roles: ["workplace_coach"] }, "support:act")).toBe(false);
    expect(can({ roles: ["workplace_coach"] }, "support:read")).toBe(false);
  });

  it("does not include a learner, or a line manager", () => {
    expect(can({ roles: ["learner"] }, "support:read")).toBe(false);
    expect(can({ roles: ["learner"] }, "support:act")).toBe(false);
    expect(can({ roles: ["line_manager"] }, "support:read")).toBe(false);
  });

  /**
   * The auditor reads evidence and outcomes. A support need is neither, and an
   * external verifier has no business knowing which learners have a
   * psychological condition.
   */
  it("does not include the external verifier", () => {
    expect(can({ roles: ["external_verifier"] }, "support:read")).toBe(false);
    expect(can({ roles: ["external_verifier"] }, "support:act")).toBe(false);
  });

  it("does not include the platform owner, who hosts but does not read", () => {
    expect(can({ roles: ["platform_owner"] }, "support:read")).toBe(false);
    expect(can({ roles: ["platform_owner"] }, "support:act")).toBe(false);
  });

  /** Reading implies acting: nobody holds the sensitive half and not the rest. */
  it("never grants the detail without the accommodation", () => {
    for (const role of Object.keys(ROLE_PERMISSIONS) as Role[]) {
      if (can({ roles: [role] }, "support:read")) {
        expect(can({ roles: [role] }, "support:act")).toBe(true);
      }
    }
  });
});
