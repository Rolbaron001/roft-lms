/**
 * "View as" (lib/view-as.ts, 5 October 2026): an administrator sees the
 * platform as one of their people. Only an administrator, only somebody else
 * in the same provider, and the result carries who is really looking.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withPlatformScope } from "@/db/client";
import { organisations, userRoles, users } from "@/db/schema";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";
import { mayViewAs, viewAsSession } from "@/lib/view-as";

let organisationId: string;
let otherOrganisationId: string;
let admin: AuthenticatedSession;
let assessor: AuthenticatedSession;
let learnerId: string;
let strangerId: string;

const session = (roles: Role[], userId: string, org = organisationId): AuthenticatedSession => ({
  sessionId: "00000000-0000-0000-0000-000000000000",
  userId,
  organisationId: org,
  email: "x@va.test",
  firstName: "Ada",
  lastName: "Admin",
  roles,
  permissions: permissionsFor({ roles }),
  mustChangePassword: false,
  aiOn: false,
});

beforeAll(async () => {
  const slug = `va-${Date.now()}`;
  const made = await withPlatformScope("view-as test fixture", async (tx) => {
    const org = async (name: string) =>
      (await tx.insert(organisations).values({ slug: `${slug}-${name}`, legalName: `${name} Ltd`, displayName: name, status: "active" }).returning({ id: organisations.id }))[0].id;
    const a = await org("a");
    const b = await org("b");
    const person = async (orgId: string, email: string, role: Role) => {
      const [user] = await tx.insert(users).values({ organisationId: orgId, email, firstName: "P", lastName: "Q", status: "active" }).returning({ id: users.id });
      await tx.insert(userRoles).values({ organisationId: orgId, userId: user.id, role });
      return user.id;
    };
    return {
      a,
      b,
      admin: await person(a, `admin@${slug}.test`, "tenant_admin"),
      assessor: await person(a, `assessor@${slug}.test`, "assessor"),
      learner: await person(a, `learner@${slug}.test`, "learner"),
      stranger: await person(b, `stranger@${slug}.test`, "learner"),
    };
  });
  organisationId = made.a;
  otherOrganisationId = made.b;
  admin = session(["tenant_admin"], made.admin);
  assessor = session(["assessor"], made.assessor);
  learnerId = made.learner;
  strangerId = made.stranger;
});

afterAll(async () => {
  await withPlatformScope("view-as test teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
  await withPlatformScope("view-as test teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, otherOrganisationId)));
});

describe("seeing the platform as somebody else", () => {
  it("gives an administrator the person's own session, marked with who is looking", async () => {
    const seen = await viewAsSession(admin, learnerId);
    expect(seen?.userId).toBe(learnerId);
    expect(seen?.roles).toEqual(["learner"]);
    expect(seen?.permissions).toEqual(permissionsFor({ roles: ["learner"] }));
    expect(seen?.viewAs?.byUserId).toBe(admin.userId);
  });

  it("is refused to anybody who may not manage the provider", async () => {
    expect(mayViewAs(assessor)).toBe(false);
    expect(await viewAsSession(assessor, learnerId)).toBeNull();
  });

  it("is never as yourself, never from inside another view, and never across providers", async () => {
    expect(await viewAsSession(admin, admin.userId)).toBeNull();
    const seen = (await viewAsSession(admin, learnerId))!;
    expect(mayViewAs(seen)).toBe(false);
    // Row-level security hides another provider's people altogether.
    expect(await viewAsSession(admin, strangerId)).toBeNull();
  });

  it("is read-only at the door and in the database", () => {
    const proxy = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");
    expect(proxy).toMatch(/request\.method === "GET"/);
    expect(proxy).toMatch(/\/api\/view-as\/stop/);
    const client = readFileSync(join(process.cwd(), "db/client.ts"), "utf8");
    expect(client).toMatch(/set transaction read only/);
  });
});
