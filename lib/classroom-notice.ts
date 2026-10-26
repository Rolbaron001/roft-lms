import { and, eq } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import { classroomAcknowledgements, organisations } from "@/db/schema";
import { recordAudit } from "./audit";
import type { AuthenticatedSession } from "./session";
import { mediaConfigured } from "./classroom-media";
import { transcriberConfigured } from "./classroom-transcriber";

/**
 * Whether classes are transcribed, and the notice that says so (job sheet
 * D41, phase B). Every participant is told on joining that what is said is
 * transcribed to write the class's notes and the voice then deleted, and
 * acknowledges it once before joining their first class. The acknowledgement
 * is kept: it is the provider's evidence the notice was given.
 */

/** Whether this server can capture and transcribe classes at all. */
export function transcriptionAvailable(): boolean {
  return mediaConfigured() && transcriberConfigured();
}

/** Whether this provider's classes are transcribed: the server can, and the provider has switched it on. */
export async function transcribingWithin(tx: TenantDatabase, organisationId: string): Promise<boolean> {
  if (!transcriptionAvailable()) return false;
  const [provider] = await tx.select({ on: organisations.classroomTranscribe }).from(organisations).where(eq(organisations.id, organisationId));
  return Boolean(provider?.on);
}

export async function classesTranscribed(session: AuthenticatedSession): Promise<boolean> {
  return withTenant(session.organisationId, (tx) => transcribingWithin(tx, session.organisationId));
}

/** Whether this person must acknowledge the notice before joining. Asked once per person, not once per class. */
export async function noticeOwed(session: AuthenticatedSession): Promise<boolean> {
  return withTenant(session.organisationId, async (tx) => {
    if (!(await transcribingWithin(tx, session.organisationId))) return false;
    const [given] = await tx
      .select({ id: classroomAcknowledgements.id })
      .from(classroomAcknowledgements)
      .where(and(eq(classroomAcknowledgements.organisationId, session.organisationId), eq(classroomAcknowledgements.userId, session.userId)));
    return !given;
  });
}

export async function acknowledgeNotice(session: AuthenticatedSession): Promise<void> {
  await withTenant(session.organisationId, async (tx) => {
    const added = await tx
      .insert(classroomAcknowledgements)
      .values({ organisationId: session.organisationId, userId: session.userId })
      .onConflictDoNothing()
      .returning({ id: classroomAcknowledgements.id });
    if (added.length === 0) return;
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "classroom.notice_acknowledged",
      entityType: "user",
      entityId: session.userId,
    });
  });
}
