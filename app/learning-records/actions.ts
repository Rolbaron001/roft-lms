"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { importStatements, XapiError, type ImportSummary } from "@/lib/xapi";
import {
  RecordStoreError,
  removeRecordStore,
  saveRecordStore,
  sendToRecordStore,
} from "@/lib/record-store";
import { PermissionDeniedError } from "@/lib/rbac";
import { requireSession } from "@/lib/request";

export type ImportState = { error?: string; summary?: ImportSummary };
export type StoreState = { error?: string; notice?: string };

function storeProblem(error: unknown): string {
  if (error instanceof RecordStoreError) return error.message;
  if (error instanceof PermissionDeniedError) {
    return "Only a provider administrator may connect a learning record store.";
  }
  if (error && typeof error === "object" && "issues" in error) {
    return (error as { issues: { message: string }[] }).issues.map((i) => i.message).join(" ");
  }
  throw error;
}

/** The provider's own address, worked out as the export download does. */
async function ownAddress(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const scheme = host.startsWith("localhost") || host.includes(".localhost") ? "http" : "https";
  return `${scheme}://${host}`;
}

export async function saveStoreAction(_previous: StoreState, formData: FormData): Promise<StoreState> {
  const session = await requireSession();
  try {
    await saveRecordStore(
      session,
      {
        endpoint: String(formData.get("endpoint") ?? ""),
        username: String(formData.get("username") ?? ""),
        secret: String(formData.get("secret") ?? "") || undefined,
        enabled: formData.get("enabled") === "on",
      },
      await ownAddress(),
    );
  } catch (error) {
    return { error: storeProblem(error) };
  }
  revalidatePath("/learning-records");
  return { notice: "Saved. Records go to the store every hour; send them now to check the connection." };
}

export async function sendNowAction(): Promise<StoreState> {
  const session = await requireSession();
  if (!session.permissions.includes("records:manage")) {
    return { error: "Only a provider administrator may send records." };
  }
  const result = await sendToRecordStore(session.organisationId);
  revalidatePath("/learning-records");
  if (!result) return { error: "No store is connected, or it is switched off." };
  if (result.error) return { error: `${result.sent} sent before it stopped. ${result.error}` };
  return {
    notice:
      result.sent + result.alreadyHeld === 0
        ? "Nothing new to send. The store has every record."
        : `Sent ${result.sent}${result.alreadyHeld ? `; the store already held ${result.alreadyHeld}` : ""}.`,
  };
}

export async function removeStoreAction(): Promise<StoreState> {
  const session = await requireSession();
  try {
    await removeRecordStore(session);
  } catch (error) {
    return { error: storeProblem(error) };
  }
  revalidatePath("/learning-records");
  return { notice: "Disconnected, and its key forgotten." };
}

export async function importStatementsAction(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const session = await requireSession();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose the file of statements to import." };
  }

  try {
    const summary = await importStatements(session, {
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    revalidatePath("/learning-records");
    return { summary };
  } catch (error) {
    if (error instanceof XapiError) return { error: error.message };
    if (error instanceof PermissionDeniedError) {
      return { error: "Only a provider administrator may import learning records." };
    }
    throw error;
  }
}
