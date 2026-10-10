import { requireInReach } from "@/lib/request";

/** One programme of courses: only for staff assigned to it (lib/staff-scope.ts). */
export default async function PathLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  await requireInReach({ learningPathId: (await params).id });
  return children;
}
