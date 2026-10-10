import { requireInReach } from "@/lib/request";

/** Marking one submission: only for staff assigned to its programme (lib/staff-scope.ts). */
export default async function SubmissionLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  await requireInReach({ submissionId: (await params).id });
  return children;
}
