"use server";

import { revalidatePath } from "next/cache";
import { requireSession, said } from "@/lib/request";
import {
  CoachError,
  messageStaff,
  READINESS_DIMENSIONS,
  recordObservationChecklist,
  recordReadiness,
  recordWitnessTestimony,
} from "@/lib/coach";

export type CoachState = { error?: string; notice?: string };

const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

async function run(learnerId: string, work: () => Promise<string>): Promise<CoachState> {
  try {
    const notice = await work();
    revalidatePath(`/workplace/learners/${learnerId}`);
    return said({ notice });
  } catch (error) {
    if (error instanceof CoachError) return said({ error: error.message });
    return said({ error: "That could not be saved. Try again." });
  }
}

export async function checklistAction(_previous: CoachState, formData: FormData): Promise<CoachState> {
  const session = await requireSession();
  const learnerId = text(formData, "learnerId");
  const count = Number(formData.get("count") ?? 0);
  const items: { label: string; observed: boolean; comment?: string }[] = [];
  for (let index = 0; index < count; index++) {
    items.push({
      label: text(formData, `label_${index}`),
      observed: formData.get(`observed_${index}`) === "yes",
      comment: text(formData, `comment_${index}`) || undefined,
    });
  }
  return run(learnerId, async () => {
    await recordObservationChecklist(session, {
      learnerId,
      logbookId: text(formData, "logbookId") || null,
      title: text(formData, "title"),
      observedOn: text(formData, "observedOn"),
      items,
    });
    return "Checklist signed. The learner, their facilitator and their assessor have been told.";
  });
}

export async function witnessAction(_previous: CoachState, formData: FormData): Promise<CoachState> {
  const session = await requireSession();
  const learnerId = text(formData, "learnerId");
  return run(learnerId, async () => {
    await recordWitnessTestimony(session, {
      learnerId,
      logbookId: text(formData, "logbookId") || null,
      witnessName: text(formData, "witnessName"),
      witnessRole: text(formData, "witnessRole"),
      observedOn: text(formData, "observedOn"),
      statement: text(formData, "statement"),
    });
    return "Witness testimony signed.";
  });
}

export async function readinessAction(_previous: CoachState, formData: FormData): Promise<CoachState> {
  const session = await requireSession();
  const learnerId = text(formData, "learnerId");
  const ratings = Object.fromEntries(READINESS_DIMENSIONS.map((one) => [one, Number(formData.get(one) ?? 0)]));
  return run(learnerId, async () => {
    await recordReadiness(session, {
      learnerId,
      ratings,
      recommendation: text(formData, "recommendation"),
      comments: text(formData, "comments"),
    });
    return "Feedback signed and sent.";
  });
}

export async function messageAction(_previous: CoachState, formData: FormData): Promise<CoachState> {
  const session = await requireSession();
  const learnerId = text(formData, "learnerId");
  return run(learnerId, async () => {
    const sent = await messageStaff(session, { learnerId, body: text(formData, "body") });
    return sent === 1 ? "Sent to 1 person." : `Sent to ${sent} people.`;
  });
}
