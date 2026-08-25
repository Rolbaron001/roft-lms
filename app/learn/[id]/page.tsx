import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession, requireTenant } from "@/lib/request";
import { EnrolmentError, getEnrolmentForDelivery } from "@/lib/enrolment";
import { listCourseAssessments } from "@/lib/assessment";
import { AppShell } from "@/components/app-shell";
import { CoursePlayer } from "./course-player";
import { StepList } from "./step-list";
import { stepsForLearner } from "@/lib/spine";

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

  // A course with a spine is walked in order. One without is not gated at
  // all, and is listed the way it always was — gating is something a course
  // opts into by having a spine, not something imposed on every course that
  // existed before it.
  const steps = await stepsForLearner(
    session,
    delivery.course.id,
    delivery.enrolment.userId,
  );

  // Only published assessments are offered; a draft is unfinished by
  // definition and its questions may still change.
  const assessments =
    steps.length > 0
      ? []
      : (await listCourseAssessments(session, delivery.course.id)).filter(
          (assessment) => assessment.status === "published",
        );

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

      {steps.length > 0 ? (
        <StepList
          steps={steps}
          enrolmentId={id}
          isOwn={delivery.isOwn}
        />
      ) : null}

      {assessments.length > 0 ? (
        <section className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Assessments
          </h2>
          <ul className="mt-3 space-y-2">
            {assessments.map((assessment) => (
              <li
                key={assessment.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--border)] px-4 py-3"
              >
                <span className="text-sm">
                  <span className="font-medium">{assessment.title}</span>
                  <span className="block text-xs text-[var(--muted)]">
                    {assessment.purpose === "summative"
                      ? "Counts towards your qualification"
                      : "Practice"}{" "}
                    · pass mark {assessment.passMark}%
                  </span>
                </span>
                {delivery.isOwn ? (
                  <Link
                    href={`/learn/${id}/assessment/${assessment.id}`}
                    className="rounded-md px-3 py-1.5 text-sm font-semibold text-white"
                    style={{ background: "var(--brand-primary)" }}
                  >
                    Start
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
            mediaMimeType: lesson.mediaMimeType,
            mediaFilename: lesson.mediaFilename,
            mediaSizeBytes: lesson.mediaSizeBytes,
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
