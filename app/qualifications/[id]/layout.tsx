import { requireInReach } from "@/lib/request";

/** Every page of one qualification: only for staff assigned to it (lib/staff-scope.ts). */
export default async function QualificationLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  await requireInReach({ qualificationId: (await params).id });
  return children;
}
