"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import { defineBadge, retireBadge } from "@/lib/badges";
import { PermissionDeniedError } from "@/lib/rbac";

export type BadgeFormState = {
  error?: string;
  notice?: string;
  /** Returned so a refused form comes back filled in rather than emptied. */
  values?: Record<string, string>;
  attempt?: number;
};

/**
 * Designing a badge.
 *
 * The target arrives as one field - "course:<id>", "default", and so on -
 * rather than a kind plus four possible identifiers only one of which may be
 * set. A single select cannot produce an inconsistent pair, so the state the
 * validator exists to reject cannot be expressed by the form at all.
 */
export async function defineBadgeAction(
  previous: BadgeFormState,
  formData: FormData,
): Promise<BadgeFormState> {
  const session = await requireSession();

  const raw = Object.fromEntries(
    ["name", "description", "glyph", "shape", "background", "ink", "target"].map(
      (field) => [field, String(formData.get(field) ?? "")],
    ),
  );

  const [kind, id] = raw.target.split(":");

  try {
    await defineBadge(session, {
      kind: kind as "default",
      name: raw.name,
      description: raw.description || undefined,
      glyph: raw.glyph || undefined,
      shape: (raw.shape || "circle") as "circle",
      background: raw.background || undefined,
      ink: raw.ink || undefined,
      ...(kind === "course"
        ? { courseId: id }
        : kind === "learning_path"
          ? { learningPathId: id }
          : kind === "qualification"
            ? { qualificationId: id }
            : kind === "curriculum_module"
              ? { curriculumModuleId: id }
              : {}),
    });
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error: "Your role does not include designing badges.",
        values: raw,
        attempt: (previous.attempt ?? 0) + 1,
      };
    }

    // A unique index refusing a second badge for the same thing, most likely.
    const message =
      error instanceof Error && /duplicate|unique/i.test(error.message)
        ? "That already has a badge. Retire the existing one first, or choose something else."
        : error instanceof Error
          ? error.message
          : "That could not be saved.";

    return {
      error: message,
      values: raw,
      attempt: (previous.attempt ?? 0) + 1,
    };
  }

  revalidatePath("/badges");
  return { notice: "Badge created. It is earned from now on." };
}

export async function retireBadgeAction(
  _previous: BadgeFormState,
  formData: FormData,
): Promise<BadgeFormState> {
  const session = await requireSession();

  try {
    await retireBadge(session, String(formData.get("badgeId") ?? ""));
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "That could not be retired.",
    };
  }

  revalidatePath("/badges");
  return {
    notice:
      "Retired. Nobody earns it from now on, and everybody who already holds it keeps it.",
  };
}
