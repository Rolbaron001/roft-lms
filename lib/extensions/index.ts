import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { aiRuns, aiUserSettings } from "@/db/schema";
import { assertSessionCan, type AuthenticatedSession } from "../session";
import { hintOf, seal, sealingAvailable, unseal } from "../secret-box";
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

/**
 * Whether the AI extension is offered at all.
 *
 * On by default now that each person brings their own token, and turned off
 * for a whole deployment with LMS_AI_EXTENSION=off.
 *
 * It was parked for a day in September while the question of whose
 * subscription paid was open. Per-person tokens answered it: there is no
 * shared sign-in to argue about, because each person's own credential is used
 * for their own work and nobody else's.
 *
 * With it off, nothing in the interface mentions an extension, and the one
 * thing that needs one - working a qualification's structure out of documents
 * that carry no summary - simply says so without inviting anybody to go and
 * switch something on.
 */
export function extensionOffered(): boolean {
  return (process.env.LMS_AI_EXTENSION ?? "on").toLowerCase() !== "off";
}

export function knownProviders(): AiProvider[] {
  return PROVIDER_NAMES.map((name) => PROVIDERS[name]);
}

export function providerByName(name: string | null): AiProvider | null {
  if (!name) return null;
  return (PROVIDERS as Record<string, AiProvider>)[name] ?? null;
}

export type ExtensionState = {
  /**
   * Switched on right now, in this sitting.
   *
   * This is the one every caller should be asking about before it offers to do
   * something. It is false at the start of every sitting and false again after
   * signing out, whatever else is true.
   */
  on: boolean;
  /**
   * Set up and permitted, so it can be switched on.
   *
   * A token is stored, the person has not disabled it, and the deployment
   * offers extensions at all. Being available is what puts the switch on the
   * screen; being on is what makes it act.
   */
  available: boolean;
  /** A token is stored, whether or not the person has it available. */
  registered: boolean;
  /** The last four characters of the stored token, for telling it apart. */
  tokenHint: string | null;
  tokenAddedAt: Date | null;
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

  const provider = extensionOffered()
    ? providerByName(mine?.provider ?? null)
    : null;

  const registered = Boolean(mine?.tokenSealed);
  const available =
    extensionOffered() && registered && (mine?.available ?? false);

  return {
    // Three separate questions, and collapsing any two of them was the bug
    // waiting to happen. A deployment may offer extensions; a person may have
    // set one up and left it available; and this sitting may have it switched
    // on. Only the last one licenses doing anything.
    on: available && session.aiOn,
    available,
    registered,
    tokenHint: mine?.tokenHint ?? null,
    tokenAddedAt: mine?.tokenAddedAt ?? null,
    provider: mine?.provider ?? null,
    providerLabel: provider?.label ?? null,
    model: mine?.model ?? null,
    availability: provider
      ? await provider.availability(session.organisationId)
      : null,
  };
}

/**
 * This person's token, decrypted, or null.
 *
 * Deliberately not part of `extensionState`: that is read by pages and passed
 * to components, and a token that travels with it would eventually reach a
 * browser. This is called only at the moment of a run, by `runExtension`, and
 * its result is never returned to a caller above it.
 */
async function tokenFor(
  session: AuthenticatedSession,
): Promise<string | null> {
  const mine = await withTenant(session.organisationId, async (tx) => {
    const [own] = await tx
      .select({
        sealed: aiUserSettings.tokenSealed,
        available: aiUserSettings.available,
      })
      .from(aiUserSettings)
      .where(eq(aiUserSettings.userId, session.userId));
    return own ?? null;
  });

  if (!mine?.available) return null;
  return unseal(mine.sealed);
}

/**
 * The shape of a Claude Code subscription token.
 *
 * Checked before it is stored, because a mistyped token fails at the moment
 * somebody is trying to get work done rather than at the moment they set it up,
 * and by then it looks like the extension is broken rather than like a typo.
 * Deliberately loose about length and the tail: this validates that somebody
 * pasted a token rather than a password or an API key, not that the token is
 * genuine. Only the provider can say that.
 */
const TOKEN_SHAPE = /^sk-ant-oat[0-9]{2}-[A-Za-z0-9_-]{20,}$/;

export class ExtensionSetupError extends Error {}

/**
 * One person setting up their own extension.
 *
 * Under a permission every member of the provider's staff holds, not the
 * administrator's. A facilitator building a programme has the same use for
 * this as the person who bought the subscription, and a platform where only
 * the administrator may set it up is a platform where only the administrator
 * has it.
 *
 * What is stored is that person's own credential, which is a real departure
 * from how the rest of the platform works and was decided knowingly. Two
 * things follow, and both are enforced here rather than left to the interface:
 * the token never comes back out except to be handed to the provider, and the
 * person who put it there can withdraw it at any moment without asking anybody.
 */
export async function setMyExtension(
  session: AuthenticatedSession,
  input: {
    provider: string | null;
    model?: string | null;
    /** A new token, or undefined to keep the stored one. */
    token?: string | null;
    /** Their own standing switch. False disables without discarding the token. */
    available: boolean;
    /** Discards the stored token outright. */
    forget?: boolean;
  },
) {
  assertSessionCan(session, "extension:use");

  const token = input.token?.trim() || null;

  if (input.available && !providerByName(input.provider)) {
    throw new ExtensionSetupError("Choose a provider the platform knows.");
  }

  if (token && !TOKEN_SHAPE.test(token)) {
    throw new ExtensionSetupError(
      "That does not look like a Claude Code token. Run `claude setup-token` on your own computer and paste what it prints — it begins sk-ant-oat.",
    );
  }

  if (token && !sealingAvailable()) {
    throw new ExtensionSetupError(
      "This deployment has no encryption key set, so a token cannot be stored safely. Nothing was saved. Tell whoever runs the server.",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [existing] = await tx
      .select({ id: aiUserSettings.id, sealed: aiUserSettings.tokenSealed })
      .from(aiUserSettings)
      .where(eq(aiUserSettings.userId, session.userId));

    // Available means available *to switch on*, and it cannot be true without
    // something to switch on. Refused rather than quietly corrected, because a
    // person who thinks they have set this up and has not is worse off than one
    // who is told they have not.
    const willHold = input.forget ? false : Boolean(token || existing?.sealed);
    // Discarding wins over asking for it to stay available. The two together
    // are contradictory rather than wrong, and resolving it here means no
    // caller has to remember to send both consistently.
    const wantsAvailable = input.available && !input.forget;

    if (wantsAvailable && !willHold) {
      throw new ExtensionSetupError(
        "Paste a token first. Run `claude setup-token` on your own computer; it prints one.",
      );
    }

    const values = {
      provider: input.provider,
      model: input.model || null,
      available: wantsAvailable && willHold,
      updatedAt: new Date(),
      ...(input.forget
        ? { tokenSealed: null, tokenHint: null, tokenAddedAt: null }
        : token
          ? {
              tokenSealed: seal(token),
              tokenHint: hintOf(token),
              tokenAddedAt: new Date(),
            }
          : {}),
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

  if (!state.registered || !state.provider) {
    return {
      ok: false,
      error:
        "You have not set up an AI extension. It is on your account page under Settings, it is yours rather than the tenant's, and it uses a token you generate on your own computer.",
    };
  }

  if (!state.available) {
    return {
      ok: false,
      error:
        "Your AI extension is disabled on your account page. Nothing was discarded — switch it back on there when you want it.",
    };
  }

  if (!state.on) {
    return {
      ok: false,
      error:
        "Your AI extension is not switched on for this sitting. Switch it on where you want to use it; it starts off every time you sign in, and switches off again when you sign out.",
    };
  }

  const token = await tokenFor(session);
  if (!token) {
    return {
      ok: false,
      error:
        "Your stored token could not be read. This usually means the server's secret has changed since you saved it. Paste a fresh one on your account page.",
    };
  }

  const provider = providerByName(state.provider);
  if (!provider) {
    return { ok: false, error: "That provider is no longer available." };
  }

  const available = await provider.availability(session.organisationId);
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
    tenantId: session.organisationId,
    token,
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
