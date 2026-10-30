"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/request";
import { setActingRole } from "@/lib/session";
import { userRole } from "@/db/schema";
import type { Role } from "@/lib/rbac";

const ROLES: readonly string[] = userRole.enumValues;

/**
 * Working in one role, or back in all of them (Heidi, 30 October 2026). The
 * badges on the home page and the banner on every page post here. An empty
 * role means all assigned roles. Home afterwards, since it is the page that
 * changes most.
 */
export async function chooseRoleAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const chosen = String(formData.get("role") ?? "");
  const role = ROLES.includes(chosen) ? (chosen as Role) : null;
  if (chosen && !role) redirect("/");
  await setActingRole(session, role);
  revalidatePath("/", "layout");
  redirect("/");
}
