"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, requireTenant } from "@/lib/request";
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
import {
  addCohortTask,
  setTaskStatus,
  TrackerError,
} from "@/lib/tracker";
import {
  acceptSittingDeclaration,
  createSitting,
  setSittingStatus,
  acknowledgeScript,
  admitCandidate,
  confirmCamera,
  InvigilationError,
  recordDropOut,
  recordIncident,
} from "@/lib/invigilation";
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
      error instanceof TrackerError ||
      error instanceof InvigilationError ||
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

// ---------------------------------------------------------------------------
// The work of running a cohort
// ---------------------------------------------------------------------------

export async function addCohortTaskAction(
  _previous: CohortActionState,
  formData: FormData,
): Promise<CohortActionState> {
  const session = await requirePermission("session:manage");
  const cohortId = field(formData, "cohortId");

  return run(
    () =>
      addCohortTask(session, {
        cohortId,
        name: field(formData, "name"),
        description: field(formData, "description") || undefined,
        startDate: field(formData, "startDate") || undefined,
        dueDate: field(formData, "dueDate") || undefined,
      }),
    "Task added.",
    [`/cohorts/${cohortId}`, "/tracker"],
  );
}

export async function setTaskStatusAction(
  _previous: CohortActionState,
  formData: FormData,
): Promise<CohortActionState> {
  const session = await requirePermission("session:manage");
  const cohortId = field(formData, "cohortId");

  return run(
    () =>
      setTaskStatus(
        session,
        field(formData, "taskId"),
        field(formData, "status") as "complete",
      ),
    "Task updated.",
    [`/cohorts/${cohortId}`, "/tracker"],
  );
}

// ---------------------------------------------------------------------------
// Invigilation
//
// The provider's own offset from UTC, so a sitting scheduled at 09:00 is
// judged against 09:00 where the provider is. Passed rather than guessed: the
// session deliberately holds a date and a clock time apart, and the server's
// idea of the zone is not the provider's.
//
// Read off the tenant record, which is where a provider sets it in Settings. A
// tenant outside South Africa is then a configuration change rather than a
// fork, and the cut-off is judged against the clock the invigilator is
// actually watching.
// ---------------------------------------------------------------------------

/**
 * Setting up a supervised sitting on a scheduled session.
 *
 * The gap this closes: the register, the admission cut-off, the declaration,
 * the camera check and the incident log were all built and reachable - but only
 * for a sitting that already existed, and nothing in the platform could create
 * one. An invigilator opening the session page found the supervision machinery
 * absent with no way to ask for it.
 *
 * Under session:manage rather than attendance:record. Setting the rules of a
 * sitting - what may be brought in, how late somebody may arrive, what they
 * declare - is scheduling, not invigilating; the person running the room on the
 * day records against those rules rather than choosing them.
 */
export async function createSittingAction(
  _previous: CohortActionState,
  formData: FormData,
): Promise<CohortActionState> {
  const session = await requirePermission("session:manage");
  const cohortId = field(formData, "cohortId");
  const sessionId = field(formData, "sessionId");

  return run(
    () =>
      createSitting(session, {
        sessionId,
        assessmentId: field(formData, "assessmentId"),
        invigilatorId: field(formData, "invigilatorId") || undefined,
        admissionClosesAfterMinutes: field(
          formData,
          "admissionClosesAfterMinutes",
        ),
        arriveBeforeMinutes: field(formData, "arriveBeforeMinutes"),
        cameraRequired: formData.get("cameraRequired") === "on",
        permittedMaterials: field(formData, "permittedMaterials") || undefined,
        declarationText: field(formData, "declarationText") || undefined,
      }),
    "Sitting set up. It is scheduled until you open it.",
    [`/cohorts/${cohortId}/sessions/${sessionId}`, `/cohorts/${cohortId}`],
  );
}

/**
 * Moving a sitting between scheduled, open, in progress, closed and cancelled.
 *
 * The status is what the admission window is judged against, so this is not
 * cosmetic: a sitting nobody opened admits nobody, and one nobody closed leaves
 * the register looking like it is still running. The library enforces which
 * moves are allowed.
 */
export async function setSittingStatusAction(
  _previous: CohortActionState,
  formData: FormData,
): Promise<CohortActionState> {
  const session = await requirePermission("session:manage");
  const cohortId = field(formData, "cohortId");
  const sessionId = field(formData, "sessionId");
  const status = field(formData, "status") as
    | "scheduled"
    | "open"
    | "in_progress"
    | "closed"
    | "cancelled";

  return run(
    () => setSittingStatus(session, field(formData, "sittingId"), status),
    `Sitting ${status.replace("_", " ")}.`,
    [`/cohorts/${cohortId}/sessions/${sessionId}`, `/cohorts/${cohortId}`],
  );
}

export async function admitCandidateAction(
  _previous: CohortActionState,
  formData: FormData,
): Promise<CohortActionState> {
  const session = await requirePermission("attendance:record");
  const cohortId = field(formData, "cohortId");
  const sittingId = field(formData, "sittingId");
  const { timezone } = await requireTenant();

  return run(
    () =>
      admitCandidate(session, {
        sittingId,
        userId: field(formData, "userId"),
        outcome: field(formData, "outcome") as "admitted" | "refused",
        reason: field(formData, "reason") || undefined,
        timeZone: timezone,
      }),
    "Register updated.",
    [`/cohorts/${cohortId}/sessions/${field(formData, "sessionId") || ""}`, `/cohorts/${cohortId}`],
  );
}

export async function acceptDeclarationAction(
  _previous: CohortActionState,
  formData: FormData,
): Promise<CohortActionState> {
  const session = await requirePermission("attendance:record");
  const cohortId = field(formData, "cohortId");

  return run(
    () =>
      acceptSittingDeclaration(
        session,
        field(formData, "sittingId"),
        field(formData, "userId"),
      ),
    "Declaration recorded.",
    [`/cohorts/${cohortId}`],
  );
}

export async function confirmCameraAction(
  _previous: CohortActionState,
  formData: FormData,
): Promise<CohortActionState> {
  const session = await requirePermission("attendance:record");
  const cohortId = field(formData, "cohortId");

  return run(
    () =>
      confirmCamera(
        session,
        field(formData, "sittingId"),
        field(formData, "userId"),
      ),
    "Camera confirmed.",
    [`/cohorts/${cohortId}`],
  );
}

export async function recordDropOutAction(
  _previous: CohortActionState,
  formData: FormData,
): Promise<CohortActionState> {
  const session = await requirePermission("attendance:record");
  const cohortId = field(formData, "cohortId");

  return run(
    () =>
      recordDropOut(
        session,
        field(formData, "sittingId"),
        field(formData, "userId"),
        field(formData, "reason") || undefined,
      ),
    "Drop-out recorded. They cannot be readmitted to this sitting.",
    [`/cohorts/${cohortId}`],
  );
}

export async function acknowledgeScriptAction(
  _previous: CohortActionState,
  formData: FormData,
): Promise<CohortActionState> {
  const session = await requirePermission("attendance:record");
  const cohortId = field(formData, "cohortId");

  return run(
    () =>
      acknowledgeScript(
        session,
        field(formData, "sittingId"),
        field(formData, "userId"),
        field(formData, "reference") || undefined,
      ),
    "Script receipted.",
    [`/cohorts/${cohortId}`],
  );
}

export async function recordIncidentAction(
  _previous: CohortActionState,
  formData: FormData,
): Promise<CohortActionState> {
  const session = await requirePermission("attendance:record");
  const cohortId = field(formData, "cohortId");

  return run(
    () =>
      recordIncident(session, {
        sittingId: field(formData, "sittingId"),
        userId: field(formData, "userId") || null,
        description: field(formData, "description"),
        actionTaken: field(formData, "actionTaken") || undefined,
      }),
    "Incident filed.",
    [`/cohorts/${cohortId}`],
  );
}
