"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, requireTenant } from "@/lib/request";
import {
  ConductError,
  acknowledgeGrievance,
  acknowledgeWarning,
  appointInvestigator,
  closeDisciplinaryCase,
  convenehearing,
  decideGrievance,
  issueWarning,
  lodgeGrievance,
  openDisciplinaryCase,
  recordHearingOutcome,
  recordOutcomeGiven,
} from "@/lib/conduct";
import { PermissionDeniedError } from "@/lib/rbac";

export type ConductActionState = {
  error?: string;
  notice?: string;
  values?: Record<string, string>;
  attempt?: number;
};

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function run(
  work: () => Promise<unknown>,
  notice: string,
  paths: string[],
  keep?: { previous: ConductActionState; values: Record<string, string> },
): Promise<ConductActionState> {
  const refused = (state: ConductActionState): ConductActionState =>
    keep
      ? { ...state, values: keep.values, attempt: (keep.previous.attempt ?? 0) + 1 }
      : state;

  try {
    await work();
  } catch (error) {
    if (error instanceof ConductError) return refused({ error: error.message });
    if (error instanceof PermissionDeniedError) {
      return refused({ error: "Your role does not allow that." });
    }
    if (error && typeof error === "object" && "issues" in error) {
      return refused({
        error: (error as { issues: { message: string }[] }).issues
          .map((issue) => issue.message)
          .join(" "),
      });
    }
    console.error(error);
    return refused({ error: "That could not be saved. Please try again." });
  }

  for (const path of paths) revalidatePath(path);
  return { notice };
}

export async function openCaseAction(
  previous: ConductActionState,
  formData: FormData,
): Promise<ConductActionState> {
  const session = await requirePermission("conduct:manage");
  const learnerId = field(formData, "learnerId");

  const values = {
    grade: field(formData, "grade"),
    allegation: field(formData, "allegation"),
    occurredOn: field(formData, "occurredOn"),
  };

  return run(
    () =>
      openDisciplinaryCase(session, {
        learnerId,
        grade: values.grade as "minor" | "serious" | "gross",
        allegation: values.allegation,
        occurredOn: values.occurredOn,
      }),
    "Case opened.",
    [`/people/${learnerId}`],
    { previous, values },
  );
}

export async function issueWarningAction(
  previous: ConductActionState,
  formData: FormData,
): Promise<ConductActionState> {
  const session = await requirePermission("conduct:manage");
  const learnerId = field(formData, "learnerId");

  const values = {
    kind: field(formData, "kind"),
    issuedOn: field(formData, "issuedOn"),
    terms: field(formData, "terms"),
  };

  return run(
    () =>
      issueWarning(session, {
        caseId: field(formData, "caseId"),
        kind: values.kind as "verbal" | "written" | "final_written",
        issuedOn: values.issuedOn,
        terms: values.terms,
      }),
    "Warning issued.",
    [`/people/${learnerId}`],
    { previous, values },
  );
}

export async function acknowledgeWarningAction(
  _previous: ConductActionState,
  formData: FormData,
): Promise<ConductActionState> {
  const session = await requirePermission("conduct:manage");
  const learnerId = field(formData, "learnerId");

  return run(
    () => acknowledgeWarning(session, field(formData, "warningId")),
    "Receipt recorded.",
    [`/people/${learnerId}`],
  );
}

export async function convenehearingAction(
  previous: ConductActionState,
  formData: FormData,
): Promise<ConductActionState> {
  const session = await requirePermission("conduct:manage");
  const learnerId = field(formData, "learnerId");

  const values = {
    scheduledFor: field(formData, "scheduledFor"),
    venue: field(formData, "venue"),
    meetingUrl: field(formData, "meetingUrl"),
    allegations: field(formData, "allegations"),
    sanctionsAdvised: field(formData, "sanctionsAdvised"),
  };

  return run(
    () =>
      convenehearing(session, {
        caseId: field(formData, "caseId"),
        scheduledFor: values.scheduledFor,
        venue: values.venue || undefined,
        meetingUrl: values.meetingUrl || undefined,
        allegations: values.allegations,
        sanctionsAdvised: values.sanctionsAdvised,
        rightsAdvised: formData.get("rightsAdvised") === "on",
      }),
    "Hearing convened. The notice period is met.",
    [`/people/${learnerId}`],
    { previous, values },
  );
}

export async function recordFindingsAction(
  previous: ConductActionState,
  formData: FormData,
): Promise<ConductActionState> {
  const session = await requirePermission("conduct:manage");
  const learnerId = field(formData, "learnerId");
  const values = { findings: field(formData, "findings") };

  return run(
    () =>
      recordHearingOutcome(session, {
        hearingId: field(formData, "hearingId"),
        assistedBy: field(formData, "assistedBy") || undefined,
        findings: values.findings,
      }),
    "Findings recorded.",
    [`/people/${learnerId}`],
    { previous, values },
  );
}

export async function closeCaseAction(
  previous: ConductActionState,
  formData: FormData,
): Promise<ConductActionState> {
  const session = await requirePermission("conduct:manage");
  const { timezone } = await requireTenant();
  const learnerId = field(formData, "learnerId");

  const values = {
    sanction: field(formData, "sanction"),
    outcomeReason: field(formData, "outcomeReason"),
  };

  return run(
    () =>
      closeDisciplinaryCase(session, timezone, {
        caseId: field(formData, "caseId"),
        sanction: values.sanction as
          | "no_action"
          | "counselled"
          | "verbal_warning"
          | "written_warning"
          | "final_written_warning"
          | "terminated"
          | "expelled",
        outcomeReason: values.outcomeReason,
      }),
    "Closed. Give the learner the outcome in writing, then record that you have.",
    [`/people/${learnerId}`],
    { previous, values },
  );
}

export async function outcomeGivenAction(
  _previous: ConductActionState,
  formData: FormData,
): Promise<ConductActionState> {
  const session = await requirePermission("conduct:manage");
  const { timezone } = await requireTenant();
  const learnerId = field(formData, "learnerId");

  return run(
    () => recordOutcomeGiven(session, timezone, field(formData, "caseId")),
    "Recorded. The five working days to appeal run from today.",
    [`/people/${learnerId}`],
  );
}

// ---------------------------------------------------------------------------
// Grievances
// ---------------------------------------------------------------------------

export async function lodgeGrievanceAction(
  previous: ConductActionState,
  formData: FormData,
): Promise<ConductActionState> {
  const session = await requirePermission("grievance:lodge");
  const { timezone } = await requireTenant();
  const learnerId = field(formData, "learnerId") || session.userId;

  const values = {
    nature: field(formData, "nature"),
    individualsInvolved: field(formData, "individualsInvolved"),
    occurredOn: field(formData, "occurredOn"),
    desiredOutcome: field(formData, "desiredOutcome"),
  };

  return run(
    () =>
      lodgeGrievance(session, timezone, {
        learnerId,
        informalAttempted: formData.get("informalAttempted") === "on",
        nature: values.nature,
        individualsInvolved: values.individualsInvolved || undefined,
        occurredOn: values.occurredOn || undefined,
        desiredOutcome: values.desiredOutcome || undefined,
      }),
    "Lodged. It will be acknowledged within two working days.",
    ["/conduct", `/people/${learnerId}`],
    { previous, values },
  );
}

export async function acknowledgeGrievanceAction(
  _previous: ConductActionState,
  formData: FormData,
): Promise<ConductActionState> {
  const session = await requirePermission("grievance:manage");

  return run(
    () => acknowledgeGrievance(session, field(formData, "grievanceId")),
    "Acknowledged.",
    ["/conduct"],
  );
}

export async function appointInvestigatorAction(
  _previous: ConductActionState,
  formData: FormData,
): Promise<ConductActionState> {
  const session = await requirePermission("grievance:manage");

  return run(
    () =>
      appointInvestigator(session, {
        grievanceId: field(formData, "grievanceId"),
        investigatorId: field(formData, "investigatorId"),
      }),
    "Appointed.",
    ["/conduct"],
  );
}

export async function decideGrievanceAction(
  previous: ConductActionState,
  formData: FormData,
): Promise<ConductActionState> {
  const session = await requirePermission("grievance:manage");
  const { timezone } = await requireTenant();
  const values = {
    meetingHeldOn: field(formData, "meetingHeldOn"),
    decision: field(formData, "decision"),
  };

  return run(
    () =>
      decideGrievance(session, timezone, {
        grievanceId: field(formData, "grievanceId"),
        meetingHeldOn: values.meetingHeldOn,
        decision: values.decision,
      }),
    "Decided, and the learner has it in writing.",
    ["/conduct"],
    { previous, values },
  );
}
