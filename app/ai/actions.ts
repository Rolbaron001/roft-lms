"use server";

import { revalidatePath } from "next/cache";
import { requireSession, requestContext } from "@/lib/request";
import { setSessionAi } from "@/lib/session";
import { extensionState } from "@/lib/extensions";

/**
 * Switching the extension on or off for this sitting.
 *
 * Its own action rather than part of the settings form, because it is not a
 * setting. Settings are where somebody sets the extension up once; this is the
 * thing they reach for in the middle of a job and put down again afterwards,
 * and it is reachable from wherever they happen to be.
 *
 * Switching on is refused unless the person has actually set one up. The switch
 * is not shown to anybody else, so reaching this is either a stale page or
 * somebody posting directly, and both should be told no rather than left with a
 * switch that appears to be on and does nothing.
 */
export async function setAiAction(on: boolean): Promise<{ error?: string }> {
  const session = await requireSession();
  const state = await extensionState(session);

  if (on && !state.available) {
    return {
      error: state.registered
        ? "Your AI extension is disabled on your account page."
        : "Set up an AI extension on your account page first.",
    };
  }

  await setSessionAi(session, on, await requestContext());

  // The switch changes what half the pages in the platform offer, and which
  // ones is not knowable from here.
  revalidatePath("/", "layout");
  return {};
}
