"use server";

import { revalidatePath } from "next/cache";
import {
  DocumentTemplateError,
  revertToPlatformLayout,
  saveTemplate,
} from "@/lib/document-templates";
import { DOCUMENT_KINDS, type DocumentKind } from "@/lib/document-fields";
import { PermissionDeniedError } from "@/lib/rbac";
import { requireSession } from "@/lib/request";

export type TemplateState = { error?: string; notice?: string };

function kindFrom(formData: FormData): DocumentKind {
  const raw = String(formData.get("kind") ?? "");
  const kind = DOCUMENT_KINDS.find((value) => value === raw);
  if (!kind) {
    throw new DocumentTemplateError(
      "That is not a document the platform produces.",
      "invalid",
    );
  }
  return kind;
}

export async function saveTemplateAction(
  _previous: TemplateState,
  formData: FormData,
): Promise<TemplateState> {
  const session = await requireSession();

  try {
    const kind = kindFrom(formData);
    const activate = formData.get("intent") === "activate";

    const saved = await saveTemplate(session, {
      kind,
      name: String(formData.get("name") ?? ""),
      body: String(formData.get("body") ?? ""),
      activate,
    });

    revalidatePath("/settings");

    return {
      notice: activate
        ? `Saved as version ${saved.version}, and now in use. Documents of this kind are produced from it from now on; ones already issued keep the version that produced them.`
        : `Saved as version ${saved.version}, as a draft. It is not in use until you put it in use.`,
    };
  } catch (error) {
    if (error instanceof DocumentTemplateError) return { error: error.message };
    if (error instanceof PermissionDeniedError) {
      return { error: "Your role does not allow that." };
    }
    throw error;
  }
}

export async function revertTemplateAction(
  _previous: TemplateState,
  formData: FormData,
): Promise<TemplateState> {
  const session = await requireSession();

  try {
    const kind = kindFrom(formData);
    const { reverted } = await revertToPlatformLayout(session, kind);

    revalidatePath("/settings");

    return {
      notice: reverted
        ? "Back to the platform's own layout. Your template is kept, not deleted, so you can put it back."
        : "There was no template in use for that document.",
    };
  } catch (error) {
    if (error instanceof DocumentTemplateError) return { error: error.message };
    if (error instanceof PermissionDeniedError) {
      return { error: "Your role does not allow that." };
    }
    throw error;
  }
}
