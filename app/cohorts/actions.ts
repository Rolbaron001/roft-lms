"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/request";
import {
  addMember,
  CohortError,
  createCohort,
  removeMember,
  rescheduleCohort,
  setSchedule,
} from "@/lib/cohorts";
import { EnrolmentError } from "@/lib/enrolment";
import {
  scheduleSession,
  SchedulingError,
  setSessionStatus,
  takeRegister,
} from "@/lib/scheduling";
import { PermissionDeniedError } from "@/lib/rbac";

export type CohortActionState = { error?: string; done?: string };

/**
 * Every action here hands back the message the library wrote.
 *
 * Those messages say which cohort is finished, or that a step cannot be due
 * before it opens. A generic "could not save" would throw that away and leave
 * a facilitator guessing at a rule they cannot see.
 */
async function run(
  work: () => Promise<unknown>,
  done: string,
  paths: string[],
): Promise<CohortActionState> {
  try {
    await work();
  } catch (error) {
    if (
      error instanceof CohortError ||
      error instanceof EnrolmentError ||
      error instanceof SchedulingError ||
      error instanceof PermissionDeniedError
    ) {
      return { error: error.message };
    }
    throw error;
  }

  for (const path of paths) revalidatePath(path);
  return { done };
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export async function createCohortAction(
  _previous: CohortActionState,
  formData: FormData,
): Promise<CohortActionState> {
  const session = await requirePermission("enrolment:manage");

  let created: { id: string } | undefined;

  const state = await run(
    async () => {
      created = await createCohort(session, {
        courseId: field(formData, "courseId"),
        name: field(formData, "name"),
        code: field(formData, "code") || undefined,
        startDate: field(formData, "startDate"),
        endDate: field(formData, "endDate") || undefined,
      });
    },
    "Cohort created.",
    ["/cohorts"],
  );

  // Straight into the new cohort: the next thing to do is always add people
  // and set the schedule, and both are on that page.
  if (!state.error && created) redirect(`/cohorts/${created.id}`);

  return state;
}

export async function rescheduleCohortAction(
  _previous: CohortActionState,
  formData: FormData,
): Promise<CohortActionState> {
  const session = await requirePermission("enrolment:manage");
  const cohortId = field(formData, "cohortId");

  return run(
    () => rescheduleCohort(session, cohortId, field(formData, "startDate")),
    "Start date moved. Every date on the schedule moved with it.",
    [`/cohorts/${cohortId}`, "/cohorts"],
  );
}

export async function addMemberAction(
  _previous: CohortActionState,
  formData: FormData,
): Promise<CohortActionState> {
  const session = await requirePermission("enrolment:manage");
  const cohortId = field(formData, "cohortId");

  return run(
    () => addMember(session, cohortId, field(formData, "userId")),
    "Added to the cohort and enrolled on its course.",
    [`/cohorts/${cohortId}`],
  );
}

export async function removeMemberAction(
  _previous: CohortActionState,
  formData: FormData,
): Promise<CohortActionState> {
  const session = await requirePermission("enrolment:manage");
  const cohortId = field(formData, "cohortId");

  return run(
    () => removeMember(session, cohortId, field(formData, "userId")),
    "Removed from the cohort.",
    [`/cohorts/${cohortId}`],
  );
}

/**
 * Saves the whole rollout in one write.
 *
 * The form posts every step, including the ones left blank, because the
 * library replaces a cohort's schedule rather than merging into it. Posting
 * only the changed rows would delete the rest.
 */
export async function setScheduleAction(
  _previous: CohortActionState,
  formData: FormData,
): Promise<CohortActionState> {
  const session = await requirePermission("enrolment:manage");
  const cohortId = field(formData, "cohortId");
  const stepIds = formData.getAll("stepId").map(String);

  const schedule = stepIds
    .map((stepId) => ({
      stepId,
      opensAfterDays: dayValue(formData, `opens-${stepId}`),
      dueAfterDays: dayValue(formData, `due-${stepId}`),
      closesAfterDays: dayValue(formData, `closes-${stepId}`),
    }))
    // A step with nothing set carries no release at all, which is what an
    // empty row means: no date, rather than day zero.
    .filter(
      (entry) =>
        entry.opensAfterDays !== null ||
        entry.dueAfterDays !== null ||
        entry.closesAfterDays !== null,
    );

  return run(
    () => setSchedule(session, cohortId, schedule),
    "Schedule saved.",
    [`/cohorts/${cohortId}`],
  );
}

function dayValue(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) ?? "").trim();
  if (raw === "") return null;

  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

// ---------------------------------------------------------------------------
// Sessions and the register
// ---------------------------------------------------------------------------

export async function scheduleSessionAction(
  _previous: CohortActionState,
  formData: FormData,
): Promise<CohortActionState> {
  const session = await requirePermission("session:manage");
  const cohortId = field(formData, "cohortId");

  return run(
    () =>
      scheduleSession(session, {
        cohortId,
        kind: (field(formData, "kind") || "lecture") as "lecture",
        title: field(formData, "title") || undefined,
        scheduledDate: field(formData, "scheduledDate"),
        startTime: field(formData, "startTime") || undefined,
        endTime: field(formData, "endTime") || undefined,
        deliveryMode: (field(formData, "deliveryMode") || "virtual") as "virtual",
        meetingUrl: field(formData, "meetingUrl") || undefined,
        venue: field(formData, "venue") || undefined,
        sequence: field(formData, "sequence")
          ? Number(field(formData, "sequence"))
          : undefined,
      }),
    "Session added to the schedule.",
    [`/cohorts/${cohortId}`],
  );
}

export async function setSessionStatusAction(
  _previous: CohortActionState,
  formData: FormData,
): Promise<CohortActionState> {
  const session = await requirePermission("session:manage");
  const cohortId = field(formData, "cohortId");
  const sessionId = field(formData, "sessionId");
  const status = field(formData, "status") as
    | "scheduled"
    | "completed"
    | "cancelled"
    | "postponed";

  return run(
    () => setSessionStatus(session, sessionId, status, field(formData, "note")),
    "Session updated.",
    [`/cohorts/${cohortId}`, `/cohorts/${cohortId}/sessions/${sessionId}`],
  );
}

/**
 * Takes the register from the form.
 *
 * Every learner on the register is submitted together, including the ones left
 * unmarked, which arrive as an empty value and are skipped. Submitting only
 * the changed rows would make an unmarked learner indistinguishable from one
 * marked and then cleared.
 */
export async function takeRegisterAction(
  _previous: CohortActionState,
  formData: FormData,
): Promise<CohortActionState> {
  const session = await requirePermission("attendance:record");
  const cohortId = field(formData, "cohortId");
  const sessionId = field(formData, "sessionId");

  const marks: {
    userId: string;
    status: "present" | "absent" | "excused";
    note?: string;
  }[] = [];

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("mark:")) continue;
    const status = String(value);
    if (status !== "present" && status !== "absent" && status !== "excused") {
      continue;
    }
    const userId = key.slice("mark:".length);
    marks.push({
      userId,
      status,
      note: field(formData, `note:${userId}`) || undefined,
    });
  }

  return run(
    () => takeRegister(session, sessionId, marks),
    `Register taken: ${marks.length} marked.`,
    [`/cohorts/${cohortId}`, `/cohorts/${cohortId}/sessions/${sessionId}`],
  );
}
