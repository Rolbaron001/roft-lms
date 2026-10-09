import { Card } from "@/components/ui";
import { StaffForm } from "@/components/staff-form";
import { eligibleStaff, programmeStaffFor, type StaffScope } from "@/lib/programme-staff";
import type { Translate } from "@/lib/i18n";
import type { AuthenticatedSession } from "@/lib/session";

/**
 * "People on this programme" (job sheet D27): its facilitators, assessors and
 * moderators, for any kind of programme. A study unit's course names people
 * for the study unit; where it names none, the qualification's hold.
 */
export async function StaffCard({ session, scope, path, t, intro }: { session: AuthenticatedSession; scope: StaffScope; path: string; t: Translate; intro: string }) {
  const canManage = session.permissions.includes("user:manage_roles");
  const [rows, eligible] = await Promise.all([
    programmeStaffFor(session, scope),
    canManage ? eligibleStaff(session) : Promise.resolve({ facilitator: [], assessor: [], moderator: [] }),
  ]);
  const [name, id] = Object.entries(scope)[0] as ["qualificationId" | "studyUnitId" | "courseId" | "learningPathId", string];
  return (
    <Card section={{ id: "people", label: t("staff.title") }} title={t("staff.title")} description={intro}>
      <StaffForm scope={{ name, id }} path={path} rows={rows} eligible={eligible} canManage={canManage} />
    </Card>
  );
}
