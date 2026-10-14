"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession, said } from "@/lib/request";
import { DiscussionError, removePost, reply, setThreadFlags, startThread } from "@/lib/discussions";
import { PermissionDeniedError } from "@/lib/rbac";

export type PostState = { error?: string; posted?: number };

export async function startThreadAction(_previous: PostState, formData: FormData): Promise<PostState> {
  const session = await requireSession();
  const courseId = String(formData.get("courseId") ?? "");
  let threadId: string;
  try {
    threadId = await startThread(session, {
      courseId,
      title: String(formData.get("title") ?? ""),
      body: String(formData.get("body") ?? ""),
    });
  } catch (error) {
    if (error instanceof DiscussionError || error instanceof PermissionDeniedError) return said({ error: error.message });
    throw error;
  }
  revalidatePath(`/discussions/${courseId}`);
  redirect(`/discussions/thread/${threadId}`);
}

export async function replyAction(_previous: PostState, formData: FormData): Promise<PostState> {
  const session = await requireSession();
  const threadId = String(formData.get("threadId") ?? "");
  try {
    await reply(session, { threadId, body: String(formData.get("body") ?? "") });
  } catch (error) {
    if (error instanceof DiscussionError || error instanceof PermissionDeniedError) return said({ error: error.message });
    throw error;
  }
  revalidatePath(`/discussions/thread/${threadId}`);
  return said({ posted: Date.now() });
}

export async function removePostAction(formData: FormData) {
  const session = await requireSession();
  const threadId = await removePost(session, String(formData.get("postId") ?? ""));
  revalidatePath(`/discussions/thread/${threadId}`);
}

export async function threadFlagsAction(formData: FormData) {
  const session = await requireSession();
  const threadId = String(formData.get("threadId") ?? "");
  const flag = String(formData.get("flag") ?? "");
  const on = formData.get("on") === "true";
  await setThreadFlags(session, threadId, flag === "pinned" ? { pinned: on } : { locked: on });
  revalidatePath(`/discussions/thread/${threadId}`);
}
