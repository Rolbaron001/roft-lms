"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { users } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { requireSession } from "@/lib/request";
import { mayViewAs, VIEW_AS_COOKIE } from "@/lib/view-as";

/**
 * Starts seeing the platform as one of the provider's people (lib/view-as.ts).
 * Refused unless the person asking may manage the provider's settings; the
 * person must be someone else in the same provider, and active.
 */
export async function startViewAsAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const userId = String(formData.get("userId") ?? "");
  if (!mayViewAs(session) || !userId || userId === session.userId) redirect("/not-permitted");

  const person = await withTenant(session.organisationId, async (tx) => {
    const [row] = await tx.select({ id: users.id, status: users.status, firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.id, userId));
    if (!row || row.status !== "active") return null;
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "person.viewed_as",
      entityType: "user",
      entityId: row.id,
      after: { name: `${row.firstName} ${row.lastName}` },
    });
    return row;
    // Administrator View may look as somebody too: the look is read-only
    // either way, and this records only that it began.
  }, { ownSitting: true });
  if (!person) redirect(`/people/${userId}`);

  (await cookies()).set(VIEW_AS_COOKIE, person.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Two hours at most; Stop ends it at once.
    maxAge: 2 * 60 * 60,
  });
  redirect("/");
}
