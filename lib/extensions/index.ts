import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { aiRuns, aiUserSettings } from "@/db/schema";
import { assertSessionCan, type AuthenticatedSession } from "../session";
import { claudeCodeProvider } from "./claude-code";
import {
  PROVIDER_NAMES,
  type AiProvider,
  type Availability,
  type ExtensionResult,
  type ProviderName,
} from "./base";

export * from "./base";

/**
 * The registry.
 *
 * One provider today. The shape is a registry rather than a direct call
 * because the choice of tool was asked to stay open, and a second provider
 * should be a file added here rather than a change anywhere else. Nothing
 * above this module names a provider.
 */
const PROVIDERS: Record<ProviderName, AiProvider> = {
  claude_code: claudeCodeProvider,
};

export function knownProviders(): AiProvider[] {
  return PROVIDER_NAMES.map((name) => PROVIDERS[name]);
}

export function providerByName(name: string | null): AiProvider | null {
  if (!name) return null;
  return (PROVIDERS as Record<string, AiProvider>)[name] ?? null;
}

export type ExtensionState = {
  /** This person's own choice. */
  enabled: boolean;
  provider: string | null;
  providerLabel: string | null;
  model: string | null;
  /** What the chosen provider says about itself right now. */
  availability: Availability | null;
};

/**
 * What this person has switched on, and whether it can actually run.
 *
 * Read from their own row. There is nothing tenant-wide to read alongside it:
 * folders are chosen from the person's own computer at the moment they are
 * needed, so nothing has to be registered anywhere and nothing restricted.
 *
 * Availability is asked at read time rather than remembered, because the
 * answer changes without anything in the platform changing: somebody signs in
 * on the machine, or the container is rebuilt, or the desktop application
 * updates and moves its executable.
 */
export async function extensionState(
  session: AuthenticatedSession,
): Promise<ExtensionState> {
  const mine = await withTenant(session.organisationId, async (tx) => {
    const [own] = await tx
      .select()
      .from(aiUserSettings)
      .where(eq(aiUserSettings.userId, session.userId));
    return own ?? null;
  });

  const provider = providerByName(mine?.provider ?? null);

  return {
    enabled: mine?.enabled ?? false,
    provider: mine?.provider ?? null,
    providerLabel: provider?.label ?? null,
    model: mine?.model ?? null,
    availability: provider ? await provider.availability() : null,
  };
}

/**
 * One person switching their own extension on or off.
 *
 * Under a permission every member of the provider's staff holds, not the
 * administrator's. A facilitator building a programme has the same use for
 * this as the person who bought the subscription, and a platform where only
 * the administrator may enable it is a platform where only the administrator
 * has it.
 */
export async function setMyExtension(
  session: AuthenticatedSession,
  input: { enabled: boolean; provider: string | null; model?: string | null },
) {
  assertSessionCan(session, "extension:use");

  if (input.enabled && !providerByName(input.provider)) {
    throw new Error("Choose a provider the platform knows.");
  }

  return withTenant(session.organisationId, async (tx) => {
    const [existing] = await tx
      .select({ id: aiUserSettings.id })
      .from(aiUserSettings)
      .where(eq(aiUserSettings.userId, session.userId));

    const values = {
      provider: input.provider,
      model: input.model || null,
      enabled: input.enabled,
      updatedAt: new Date(),
    };

    if (existing) {
      const [updated] = await tx
        .update(aiUserSettings)
        .set(values)
        .where(eq(aiUserSettings.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await tx
      .insert(aiUserSettings)
      .values({
        organisationId: session.organisationId,
        userId: session.userId,
        ...values,
      })
      .returning();
    return created;
  });
}

/**
 * Runs the tenant's provider and records that it happened.
 *
 * Every call is logged, whether it worked or not. A provider that keeps
 * failing is itself a finding - a usage limit reached, nobody signed in, a
 * machine that has moved - and without the failures the log says the extension
 * is never used, which is a different conclusion.
 *
 * The prompt is hashed rather than stored. It carries whatever document was
 * being read, and a log is read by more people than the thing it describes.
 */
export async function runExtension(
  session: AuthenticatedSession,
  input: {
    task: string;
    prompt: string;
    system?: string;
    timeoutMs?: number;
    workdir?: string;
  },
): Promise<ExtensionResult> {
  const state = await extensionState(session);

  if (!state.enabled || !state.provider) {
    return {
      ok: false,
      error:
        "You have not switched on an AI extension. It is on your account page, it is yours rather than the tenant's, and it is off until you turn it on.",
    };
  }

  const provider = providerByName(state.provider);
  if (!provider) {
    return { ok: false, error: "That provider is no longer available." };
  }

  const available = await provider.availability();
  if (!available.available) {
    await log(session, {
      provider: provider.name,
      model: state.model,
      task: input.task,
      prompt: input.prompt,
      outcome: "refused",
      error: available.reason ?? "Unavailable.",
    });

    return {
      ok: false,
      error: [available.reason, available.remedy].filter(Boolean).join(" "),
    };
  }

  const result = await provider.run({
    prompt: input.prompt,
    system: input.system,
    model: state.model ?? undefined,
    timeoutMs: input.timeoutMs,
    workdir: input.workdir,
  });

  await log(session, {
    provider: provider.name,
    model: result.model ?? state.model,
    task: input.task,
    prompt: input.prompt,
    outcome: result.ok ? "ok" : "failed",
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    error: result.error,
  });

  return result;
}

async function log(
  session: AuthenticatedSession,
  entry: {
    provider: string;
    model: string | null | undefined;
    task: string;
    prompt: string;
    outcome: "ok" | "failed" | "refused";
    durationMs?: number;
    costUsd?: number;
    error?: string;
  },
) {
  const promptHash = createHash("sha256").update(entry.prompt).digest("hex");

  await withTenant(session.organisationId, (tx) =>
    tx.insert(aiRuns).values({
      organisationId: session.organisationId,
      provider: entry.provider,
      model: entry.model ?? null,
      task: entry.task,
      promptHash,
      promptBytes: Buffer.byteLength(entry.prompt, "utf8"),
      outcome: entry.outcome,
      durationMs: entry.durationMs ?? null,
      costUsd:
        entry.costUsd === undefined ? null : entry.costUsd.toFixed(6),
      error: entry.error ?? null,
      requestedById: session.userId,
    }),
  );
}

/** The last runs, for the settings page. */
export async function recentRuns(session: AuthenticatedSession, limit = 20) {
  assertSessionCan(session, "tenant:manage_settings");

  return withTenant(session.organisationId, (tx) =>
    tx
      .select()
      .from(aiRuns)
      .orderBy(aiRuns.createdAt)
      .limit(limit),
  );
}

/**
 * Reads JSON out of a model's answer.
 *
 * Tolerant on purpose. Asked for JSON and nothing else, a model will still
 * wrap it in a code fence or put a sentence in front of it, and a strict
 * parser turns a good answer into a failed run. Verified against this
 * provider, which fenced its reply on the first call despite being told not
 * to.
 */
export function readJson<T>(text: string): T | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      continue;
    }
  }
  return null;
}
