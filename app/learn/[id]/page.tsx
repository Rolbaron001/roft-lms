import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
import { EnrolmentError, getEnrolmentForDelivery } from "@/lib/enrolment";
import { AppShell } from "@/components/app-shell";
import { CoursePlayer } from "./course-player";

export default async function LearnPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();

  let delivery;
  try {
    delivery = await getEnrolmentForDelivery(session, id);
  } catch (error) {
    if (error instanceof EnrolmentError) {
      if (error.code === "not_permitted") {
        redirect("/not-permitted");
      }
      notFound();
    }
    throw error;
  }

  const percentage =
    delivery.totalLessons === 0
      ? 0
      : Math.round((delivery.completedLessons / delivery.totalLessons) * 100);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link href="/" className="text-sm text-[var(--muted)] hover:underline">
          ← My learning
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{delivery.course.title}</h1>
        {delivery.course.description ? (
          <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
            {delivery.course.description}
          </p>
        ) : null}

        {!delivery.isOwn ? (
          <p className="mt-3 rounded-md border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/10 px-3 py-2 text-sm">
            You are viewing someone else&rsquo;s enrolment. You can see their
            progress but cannot record it for them.
          </p>
        ) : null}
      </div>

      <CoursePlayer
        enrolmentId={id}
        sections={delivery.sections.map((section) => ({
          id: section.id,
          title: section.title,
          lessons: section.lessons.map((lesson) => ({
            id: lesson.id,
            title: lesson.title,
            contentType: lesson.contentType,
            body: lesson.body,
            externalUrl: lesson.externalUrl,
            durationMinutes: lesson.durationMinutes,
            state: lesson.state,
          })),
        }))}
        completedLessons={delivery.completedLessons}
        totalLessons={delivery.totalLessons}
        percentage={percentage}
        canRecordProgress={delivery.isOwn}
      />
    </AppShell>
  );
}
