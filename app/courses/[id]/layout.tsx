import { requireInReach } from "@/lib/request";

/** Every page of one course: only for staff assigned to it (lib/staff-scope.ts). */
export default async function CourseLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  await requireInReach({ courseId: (await params).id });
  return children;
}
