"use server";

import { revalidatePath } from "next/cache";
import {
  PartQualificationError,
  selectModules,
} from "@/lib/part-qualifications";
import { PermissionDeniedError } from "@/lib/rbac";
import { requireSession } from "@/lib/request";
import type { ActionState } from "../../actions";

export type { ActionState };

export async function selectModulesAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const qualificationId = String(formData.get("qualificationId") ?? "");
  const moduleIds = formData.getAll("moduleId").map(String).filter(Boolean);

  try {
    const { selected } = await selectModules(
      session,
      qualificationId,
      moduleIds,
    );

    revalidatePath(`/qualifications/${qualificationId}/modules`);
    revalidatePath(`/qualifications/${qualificationId}`);
    revalidatePath("/qualifications");

    return {
      notice:
        selected === 0
          ? "Cleared. This takes none of the parent's modules."
          : `Saved. This is assessed against ${selected} ${
              selected === 1 ? "module" : "modules"
            }.`,
    };
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return { error: "Your role does not allow that." };
    }
    if (error instanceof PartQualificationError) {
      return { error: error.message };
    }
    console.error(error);
    return { error: "That could not be saved. Please try again." };
  }
}
