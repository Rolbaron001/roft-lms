/**
 * Names every facilitator, assessor and moderator of a test provider on
 * every course it holds.
 *
 * Since 10 October 2026 staff see only what they are assigned to
 * (lib/staff-scope.ts). Tests written before then are about marking,
 * moderation, readiness and certificates, not about who is assigned, and
 * create their courses as they go. Calling this before each of their tests
 * keeps them testing what they were written to test. The assignment rule
 * itself is tested in tests/staff-scope.test.ts.
 */
import { sql } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";

/** A course-making function that names the provider's staff on what it makes. */
export function withStaffAssigned<A extends unknown[], R extends { organisationId: string }>(
  make: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const made = await make(...args);
    await assignStaffEverywhere(made.organisationId);
    return made;
  };
}

export async function assignStaffEverywhere(organisationId: string): Promise<void> {
  await withPlatformScope("test helper: assign staff to every course", (tx) =>
    tx.execute(sql`
      insert into programme_staff (organisation_id, user_id, capacity, course_id)
      select ${organisationId}::uuid, r.user_id, c.capacity::staff_capacity, k.id
      from user_roles r
      join (values ('instructor', 'facilitator'), ('assessor', 'assessor'), ('moderator', 'moderator')) as c(role, capacity)
        on c.role = r.role::text
      cross join courses k
      where r.organisation_id = ${organisationId}::uuid
        and k.organisation_id = ${organisationId}::uuid
        and r.revoked_at is null
        and not exists (
          select 1 from programme_staff p
          where p.user_id = r.user_id and p.capacity::text = c.capacity and p.course_id = k.id
        )`),
  );
}
