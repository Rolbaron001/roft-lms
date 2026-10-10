import { requireInReach } from "@/lib/request";

/** One person's page: for staff, only learners on the programmes they are assigned to (lib/staff-scope.ts). */
export default async function PersonLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  await requireInReach({ learnerId: (await params).id });
  return children;
}
