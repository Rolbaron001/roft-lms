import { requireInReach } from "@/lib/request";

/** Every page of one cohort: only for staff assigned to it (lib/staff-scope.ts). */
export default async function CohortLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  await requireInReach({ cohortId: (await params).id });
  return children;
}
