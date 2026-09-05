"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { organisations } from "@/db/schema";
import { requireSession } from "@/lib/request";
import { requireTenant } from "@/lib/request";
import { assertSessionCan } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { clearTenantCache } from "@/lib/tenant";
import { PermissionDeniedError } from "@/lib/rbac";

export type MenuState = { error?: string; notice?: string };

const arrangement = z.array(
  z.object({
    label: z.string().trim().max(40).nullable(),
    items: z.array(z.string().startsWith("/")),
  }),
);

/**
 * Saving how this provider wants their menu arranged.
 *
 * Stored as headings and hrefs rather than as a rendered menu, so a page added
 * to the platform later still reaches a provider who customised theirs - see
 * `arrangeNavigation`. Validated here rather than trusted, because this arrives
 * as a JSON string from a form field and a malformed one would otherwise be
 * written straight into the column every page then reads.
 */
export async function saveMenuAction(
  _previous: MenuState,
  formData: FormData,
): Promise<MenuState> {
  const session = await requireSession();
  const tenant = await requireTenant();

  try {
    assertSessionCan(session, "tenant:manage_branding");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error:
          "Only an administrator can rearrange the menu, because it is the same menu for everybody at this provider.",
      };
    }
    throw error;
  }

  const reset = formData.get("intent") === "reset";
  let value: z.infer<typeof arrangement> | null = null;

  if (!reset) {
    try {
      value = arrangement.parse(
        JSON.parse(String(formData.get("arrangement") ?? "[]")),
      );
    } catch {
      return { error: "That arrangement could not be read. Nothing changed." };
    }

    if (value.every((section) => section.items.length === 0)) {
      return {
        error:
          "That would leave every heading empty, which is a menu with nothing in it. Nothing changed.",
      };
    }
  }

  await withTenant(tenant.id, async (tx) => {
    await tx
      .update(organisations)
      .set({ navigation: value })
      .where(eq(organisations.id, tenant.id));

    await recordAudit(tx, {
      organisationId: tenant.id,
      actorId: session.userId,
      action: reset ? "tenant.menu_reset" : "tenant.menu_arranged",
      entityType: "organisation",
      entityId: tenant.id,
    });
  });

  // The tenant's identity is cached for a few seconds, and the shell reads the
  // arrangement from it. Without this the save succeeds, says so, and the menu
  // does not change - which is what happened the first time this was tested.
  // Every other tenant-level change clears it; this one has to as well.
  clearTenantCache();

  // The menu is in the shell of every page.
  revalidatePath("/", "layout");

  return {
    notice: reset
      ? "Back to the standard menu."
      : "Saved. Everybody at this provider sees this arrangement.",
  };
}
