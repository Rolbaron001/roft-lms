"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/request";
import { PermissionDeniedError } from "@/lib/rbac";
import { removeSsoProvider, saveSsoProvider, SsoError, type SsoKind } from "@/lib/single-sign-on";

export type SsoState = { error?: string; notice?: string };

function problem(error: unknown): string {
  if (error instanceof SsoError) return error.message;
  if (error instanceof PermissionDeniedError) return "Only a provider administrator may change how people sign in.";
  if (error && typeof error === "object" && "issues" in error) {
    return (error as { issues: { message: string }[] }).issues.map((i) => i.message).join(" ");
  }
  throw error;
}

export async function saveSsoAction(_previous: SsoState, formData: FormData): Promise<SsoState> {
  const session = await requireSession();
  const kind = String(formData.get("kind") ?? "") as SsoKind;
  try {
    await saveSsoProvider(session, {
      kind,
      clientId: String(formData.get("clientId") ?? ""),
      clientSecret: String(formData.get("clientSecret") ?? "") || undefined,
      directoryId: String(formData.get("directoryId") ?? "") || undefined,
      allowedDomains: String(formData.get("allowedDomains") ?? ""),
      enabled: formData.get("enabled") === "on",
    });
  } catch (error) {
    return { error: problem(error) };
  }
  revalidatePath("/settings");
  return { notice: "Saved. Sign out and try it from the sign-in page." };
}

export async function removeSsoAction(_previous: SsoState, formData: FormData): Promise<SsoState> {
  const session = await requireSession();
  try {
    await removeSsoProvider(session, String(formData.get("kind") ?? "") as SsoKind);
  } catch (error) {
    return { error: problem(error) };
  }
  revalidatePath("/settings");
  return { notice: "Switched off, and its secret forgotten." };
}
