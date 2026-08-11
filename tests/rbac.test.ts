import { describe, expect, it } from "vitest";
import {
  can,
  permissionsFor,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type Permission,
  type Role,
} from "@/lib/rbac";

const ALL_ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];

describe("permission model", () => {
  it("grants every role only permissions that exist", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const role of ALL_ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(known.has(permission), `${role} → ${permission}`).toBe(true);
      }
    }
  });

  it("combines the permissions of someone holding two roles", () => {
    const combined = permissionsFor({ roles: ["instructor", "assessor"] });
    expect(combined).toContain("course:author");
    expect(combined).toContain("assessment:assess");
  });

  it("deduplicates permissions shared by two roles", () => {
    const combined = permissionsFor({ roles: ["instructor", "assessor"] });
    expect(new Set(combined).size).toBe(combined.length);
  });
});

describe("separation of assessment duties", () => {
  /**
   * The design document makes moderation an independent review. If one role
   * could both assess and moderate, the independence is decorative.
   */
  it("gives no single role both assessing and moderating", () => {
    for (const role of ALL_ROLES) {
      const permissions = ROLE_PERMISSIONS[role];
      const both =
        permissions.includes("assessment:assess") &&
        permissions.includes("assessment:moderate");
      expect(both, `${role} holds both assess and moderate`).toBe(false);
    }
  });

  it("does not let an assessor issue the certificate that follows their decision", () => {
    expect(can({ roles: ["assessor"] }, "certificate:issue")).toBe(false);
  });
});

describe("external verifier is read-only", () => {
  /**
   * A SETA or QCTO auditor must be able to inspect everything and change
   * nothing. Rather than trusting the list to be right, this checks it against
   * every permission whose name implies a write.
   */
  const WRITE_PERMISSIONS = PERMISSIONS.filter((permission) =>
    /:(manage|author|publish|invite|issue|assess|moderate|take|submit|anonymise)/.test(
      permission,
    ),
  );

  it.each(WRITE_PERMISSIONS)("denies %s", (permission) => {
    expect(can({ roles: ["external_verifier"] }, permission as Permission)).toBe(
      false,
    );
  });

  it("still allows the reading an audit requires", () => {
    const verifier = { roles: ["external_verifier"] as Role[] };
    expect(can(verifier, "evidence:read_all")).toBe(true);
    expect(can(verifier, "audit:read")).toBe(true);
    expect(can(verifier, "certificate:read_all")).toBe(true);
  });
});

describe("platform owner", () => {
  /**
   * Section 3: the Platform Owner manages tenants but has no visibility into a
   * tenant's content or learner data. Hosting a client's system is not the
   * same as being entitled to read it.
   */
  it("cannot read tenant learner data by role alone", () => {
    const owner = { roles: ["platform_owner"] as Role[] };
    expect(can(owner, "evidence:read_all")).toBe(false);
    expect(can(owner, "enrolment:read_all")).toBe(false);
    expect(can(owner, "report:tenant")).toBe(false);
    expect(can(owner, "user:read")).toBe(false);
  });

  it("can manage tenants", () => {
    expect(can({ roles: ["platform_owner"] }, "platform:manage_tenants")).toBe(
      true,
    );
  });

  it("is the only role that can manage tenants", () => {
    const holders = ALL_ROLES.filter((role) =>
      can({ roles: [role] }, "platform:manage_tenants"),
    );
    expect(holders).toEqual(["platform_owner"]);
  });
});

describe("learner", () => {
  it("sees only their own records", () => {
    const learner = { roles: ["learner"] as Role[] };
    expect(can(learner, "enrolment:read_own")).toBe(true);
    expect(can(learner, "enrolment:read_all")).toBe(false);
    expect(can(learner, "evidence:read_all")).toBe(false);
    expect(can(learner, "report:tenant")).toBe(false);
  });

  it("can do the things learning requires", () => {
    const learner = { roles: ["learner"] as Role[] };
    expect(can(learner, "course:read")).toBe(true);
    expect(can(learner, "assessment:take")).toBe(true);
    expect(can(learner, "evidence:submit")).toBe(true);
  });
});

describe("line manager", () => {
  it("sees the team without administrative reach", () => {
    const manager = { roles: ["line_manager"] as Role[] };
    expect(can(manager, "enrolment:read_team")).toBe(true);
    expect(can(manager, "report:team")).toBe(true);
    expect(can(manager, "user:manage_roles")).toBe(false);
    expect(can(manager, "enrolment:manage")).toBe(false);
    expect(can(manager, "course:author")).toBe(false);
  });
});

describe("a user with no roles", () => {
  it("can do nothing at all", () => {
    expect(permissionsFor({ roles: [] })).toEqual([]);
    for (const permission of PERMISSIONS) {
      expect(can({ roles: [] }, permission)).toBe(false);
    }
  });
});
