"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { organisations } from "@/db/schema";
import { requireSession, requireTenant } from "@/lib/request";
import { assertSessionCan } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { clearTenantCache } from "@/lib/tenant";
import { PermissionDeniedError } from "@/lib/rbac";
import { TERMS, TERM_KEYS, type TermKey, type TermOverrides } from "@/lib/terms";
import { authorityTerms } from "@/lib/dictionary";

export type TerminologyState = { error?: string; notice?: string };

/**
 * What this provider calls things.
 *
 * Two rules, and each exists because of a specific way this could go wrong.
 *
 * A provider may only rename words the registry holds, which excludes every
 * term a regulator defines. That is enforced by the registry itself and by a
 * test; nothing here has to check it.
 *
 * A provider may not rename one of their own words *to* a term a regulator
 * defines. Calling a course a "Qualification" is not a translation, it is a
 * claim - and the platform would then print it on screens a learner reads.
 * That is checked here, because only here is the new word known.
 */
export async function saveTerminologyAction(
  _previous: TerminologyState,
  formData: FormData,
): Promise<TerminologyState> {
  const session = await requireSession();
  const tenant = await requireTenant();

  try {
    assertSessionCan(session, "tenant:manage_branding");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error:
          "Only an administrator can change what things are called, because it is the same wording for everybody at this provider.",
      };
    }
    throw error;
  }

  if (formData.get("intent") === "reset") {
    await write(tenant.id, session.userId, null, "tenant.terminology_reset");
    return { notice: "Back to the standard wording." };
  }

  const reserved = authorityTerms();
  const overrides: TermOverrides = {};

  for (const key of TERM_KEYS) {
    const one = String(formData.get(`${key}.one`) ?? "").trim();
    const many = String(formData.get(`${key}.many`) ?? "").trim();

    if (!one && !many) continue;

    if (!one || !many) {
      return {
        error: `Give both the singular and the plural for ${TERMS[key].one.toLowerCase()}, or leave both empty to keep the default.`,
      };
    }

    if (one.length > 40 || many.length > 40) {
      return { error: "Keep each word under 40 characters." };
    }

    for (const word of [one, many]) {
      const clash = reserved.find(
        (term) => term.toLowerCase() === word.toLowerCase(),
      );
      if (clash) {
        return {
          error: `"${word}" is defined by a regulator, so it cannot be used for something else. Renaming one of your own words to it would put a claim on a learner's screen that the record does not support.`,
        };
      }
    }

    // Unchanged from the default is not an override; storing it would freeze
    // this provider on today's wording if the default ever improved.
    if (one === TERMS[key].one && many === TERMS[key].many) continue;

    overrides[key as TermKey] = { one, many };
  }

  await write(
    tenant.id,
    session.userId,
    Object.keys(overrides).length > 0 ? overrides : null,
    "tenant.terminology_changed",
  );

  return {
    notice:
      Object.keys(overrides).length > 0
        ? "Saved. Everybody at this provider sees this wording."
        : "Nothing differs from the standard wording, so the defaults are back.",
  };
}

async function write(
  organisationId: string,
  actorId: string,
  value: TermOverrides | null,
  action: string,
) {
  await withTenant(organisationId, async (tx) => {
    await tx
      .update(organisations)
      .set({ terminology: value })
      .where(eq(organisations.id, organisationId));

    await recordAudit(tx, {
      organisationId,
      actorId,
      action,
      entityType: "organisation",
      entityId: organisationId,
      after: value ?? {},
    });
  });

  // The tenant's identity is cached and every page reads its wording from it.
  // Without this the save reports success and nothing changes - which is how
  // the menu editor failed the first time it was tested.
  clearTenantCache();
  revalidatePath("/", "layout");
}
