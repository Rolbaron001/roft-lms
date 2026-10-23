import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { pageLocale, requireSession, requireTenant } from "@/lib/request";
import { ClassroomError, getClassroom } from "@/lib/classroom";
import { clockInZone } from "@/lib/timezone";
import { maybe } from "@/lib/i18n/maybe";
import { AppShell } from "@/components/app-shell";
import { Classroom } from "./classroom";

/**
 * One class in the LMS classroom (job sheet D41). The link in every reminder
 * and on every dashboard leads here; who may come in, and when, is decided by
 * lib/classroom.ts, not by holding the link.
 */
export default async function ClassroomPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();
  const { t, day } = await pageLocale();

  let view;
  try {
    view = await getClassroom(session, sessionId);
  } catch (error) {
    if (error instanceof ClassroomError) {
      if (error.code === "not_permitted") redirect("/not-permitted");
      if (error.code === "not_found") notFound();
      return (
        <AppShell tenant={tenant} session={session}>
          <p className="text-sm text-[var(--muted)]">{error.message}</p>
        </AppShell>
      );
    }
    throw error;
  }

  const name = view.title ?? maybe(t, `session.kind.${view.kind}`) ?? view.kind;
  const heading = !view.title && view.sequence && view.kind === "lecture" ? `${name} ${view.sequence}` : name;
  const when = `${day(view.scheduledDate)}${view.startTime ? `, ${view.startTime}${view.endTime ? `–${view.endTime}` : ""}` : ""}`;

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-4">
        {view.role === "learner" ? null : (
          <Link href={`/cohorts/${view.cohortId}`} className="text-sm text-[var(--muted)] hover:underline">
            ← {view.cohortName}
          </Link>
        )}
        <h1 className="mt-1 text-xl font-semibold">{heading}</h1>
        <p className="text-sm text-[var(--muted)]">
          {[view.cohortName, when, view.facilitatorName].filter(Boolean).join(" · ")}
        </p>
      </div>
      <Classroom
        sessionId={view.sessionId}
        cohortId={view.cohortId}
        facilitatorName={view.facilitatorName}
        role={view.role}
        initialState={view.state}
        opensAtClock={clockInZone(view.opensAt, tenant.timezone)}
        cameras={view.cameras}
        configured={view.configured}
        chat={view.chat.map((line) => ({ id: line.id, name: line.name, body: line.body, sentAt: line.sentAt.toISOString(), mine: line.mine, group: line.group }))}
        notes={view.notes}
        polls={view.polls}
        breakout={view.breakout}
      />
    </AppShell>
  );
}
