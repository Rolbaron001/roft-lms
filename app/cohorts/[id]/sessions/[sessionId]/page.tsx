import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
import { sessionRegister, SchedulingError } from "@/lib/scheduling";
import { Card } from "@/components/ui";
import { RegisterForm } from "./register-form";

const KIND_LABEL: Record<string, string> = {
  induction: "Induction",
  lecture: "Lecture",
  revision: "Revision",
  summative: "Summative assessment",
  mock_eisa: "Mock EISA",
  workplace_induction: "Workplace induction",
  walk_in: "Workplace walk-in",
};

/**
 * One session's register.
 *
 * The page a facilitator opens with the cohort in front of them, so it holds
 * one thing and no navigation to get lost in.
 */
export default async function SessionRegisterPage({
  params,
}: {
  params: Promise<{ id: string; sessionId: string }>;
}) {
  const { id, sessionId } = await params;
  await requireTenant();
  const session = await requirePermission("attendance:record");

  let register;
  try {
    register = await sessionRegister(session, sessionId);
  } catch (error) {
    if (error instanceof SchedulingError) notFound();
    throw error;
  }

  const marked = register.lines.filter((line) => line.status !== null).length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Link
        href={`/cohorts/${id}`}
        className="text-sm text-[var(--muted)] hover:underline"
      >
        ← Back to the cohort
      </Link>

      <h1 className="mt-2 text-xl font-semibold">
        {register.session.title ??
          KIND_LABEL[register.session.kind] ??
          "Session"}
      </h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {KIND_LABEL[register.session.kind] ?? register.session.kind} ·{" "}
        {register.session.date} · {marked} of {register.lines.length} marked
      </p>

      <div className="mt-6">
        <Card
          title="Register"
          description="Who was here. Saved marks can be corrected later, and every change is recorded against whoever made it."
        >
          <RegisterForm
            cohortId={id}
            sessionId={sessionId}
            lines={register.lines}
          />
        </Card>
      </div>
    </main>
  );
}
