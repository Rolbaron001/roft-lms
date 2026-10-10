import { pageT } from "@/lib/request";
import { isAssignedOnly, reachOf } from "@/lib/staff-scope";
import type { AuthenticatedSession } from "@/lib/session";

/**
 * One line under a list's heading for a facilitator, assessor or moderator,
 * who sees only what they are assigned to (lib/staff-scope.ts). Without it an
 * empty list reads as an empty platform. Nothing for anybody else.
 */
export async function AssignedNote({ session }: { session: AuthenticatedSession }) {
  if (!isAssignedOnly(session)) return null;
  const t = await pageT();
  const reach = await reachOf(session);
  const none = !reach.whole && reach.courses.size === 0 && reach.cohorts.size === 0 && reach.qualifications.size === 0;
  return <p className="mb-4 text-sm text-[var(--muted)]">{t(none ? "scope.assignedNone" : "scope.assignedOnly")}</p>;
}
