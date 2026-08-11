/**
 * The test that matters most.
 *
 * Multi-tenancy is the platform's core commercial promise: a client business
 * can put its people's assessment records on ROFT's system and no other client
 * can ever see them. This suite proves that at the database level, with the
 * same connection and the same role the live application uses.
 *
 * It creates two tenants, gives each a user and a course, and then tries every
 * way it can think of to read one tenant's rows from the other's context.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, withPlatformScope, withTenant } from "@/db/client";
import { courses, organisations, users } from "@/db/schema";

type Fixture = {
  organisationId: string;
  userId: string;
  courseId: string;
};

async function createTenant(slug: string, name: string): Promise<Fixture> {
  return withPlatformScope("integration test fixture setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${name} (Pty) Ltd`,
        displayName: name,
        status: "active",
      })
      .returning({ id: organisations.id });

    const [user] = await tx
      .insert(users)
      .values({
        organisationId: organisation.id,
        email: `learner@${slug}.test`,
        firstName: "Test",
        lastName: "Learner",
        status: "active",
      })
      .returning({ id: users.id });

    const [course] = await tx
      .insert(courses)
      .values({
        organisationId: organisation.id,
        title: `${name} Confidential Course`,
        status: "published",
      })
      .returning({ id: courses.id });

    return {
      organisationId: organisation.id,
      userId: user.id,
      courseId: course.id,
    };
  });
}

let acme: Fixture;
let umbrella: Fixture;

beforeAll(async () => {
  acme = await createTenant(`acme-${Date.now()}`, "Acme Mining");
  umbrella = await createTenant(`umbrella-${Date.now()}`, "Umbrella Logistics");
});

afterAll(async () => {
  await withPlatformScope("integration test fixture teardown", async (tx) => {
    for (const fixture of [acme, umbrella]) {
      if (fixture) {
        await tx
          .delete(organisations)
          .where(eq(organisations.id, fixture.organisationId));
      }
    }
  });
});

describe("tenant isolation", () => {
  it("shows a tenant its own rows", async () => {
    const rows = await withTenant(acme.organisationId, (tx) =>
      tx.select().from(courses),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(acme.courseId);
  });

  it("hides another tenant's courses even from an unfiltered query", async () => {
    // Deliberately no `where` clause. This is the mistake the whole design
    // is built to survive: row-level security must make it harmless.
    const rows = await withTenant(umbrella.organisationId, (tx) =>
      tx.select().from(courses),
    );

    const ids = rows.map((row) => row.id);
    expect(ids).toContain(umbrella.courseId);
    expect(ids).not.toContain(acme.courseId);
  });

  it("returns nothing when a tenant asks for another tenant's row by id", async () => {
    const rows = await withTenant(umbrella.organisationId, (tx) =>
      tx.select().from(courses).where(eq(courses.id, acme.courseId)),
    );

    expect(rows).toHaveLength(0);
  });

  it("hides another tenant's users", async () => {
    const rows = await withTenant(umbrella.organisationId, (tx) =>
      tx.select().from(users),
    );

    expect(rows.map((row) => row.id)).not.toContain(acme.userId);
  });

  it("shows a tenant only its own organisation record", async () => {
    const rows = await withTenant(umbrella.organisationId, (tx) =>
      tx.select().from(organisations),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(umbrella.organisationId);
  });

  it("refuses to write a row belonging to another tenant", async () => {
    await expect(
      withTenant(umbrella.organisationId, (tx) =>
        tx.insert(courses).values({
          organisationId: acme.organisationId,
          title: "Injected course",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot update another tenant's row", async () => {
    const updated = await withTenant(umbrella.organisationId, (tx) =>
      tx
        .update(courses)
        .set({ title: "Tampered" })
        .where(eq(courses.id, acme.courseId))
        .returning({ id: courses.id }),
    );

    expect(updated).toHaveLength(0);
  });

  it("cannot delete another tenant's row", async () => {
    const deleted = await withTenant(umbrella.organisationId, (tx) =>
      tx
        .delete(courses)
        .where(eq(courses.id, acme.courseId))
        .returning({ id: courses.id }),
    );

    expect(deleted).toHaveLength(0);
  });

  it("sees nothing at all when no tenant context is set", async () => {
    // The application role has no ambient access. Forgetting withTenant is a
    // bug that shows up immediately as empty results, not as a data leak.
    const rows = await db.select().from(courses);
    expect(rows).toHaveLength(0);
  });

  it("does not leak tenant context to the next transaction on the pooled connection", async () => {
    await withTenant(acme.organisationId, (tx) => tx.select().from(courses));

    const setting = await db.execute<{ value: string | null }>(
      sql`select nullif(current_setting('app.current_organisation', true), '') as value`,
    );

    expect(setting[0]?.value ?? null).toBeNull();
  });

  it("does not let the application role disable row-level security", async () => {
    await expect(
      db.execute(sql`alter table courses disable row level security`),
    ).rejects.toThrow();
  });
});
