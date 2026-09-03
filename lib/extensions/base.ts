/**
 * The AI extension contract.
 *
 * An extension is an optional provider of model-assisted work, switched on per
 * tenant by that tenant. With none enabled the platform behaves exactly as it
 * did before: the interface omits the affordances rather than offering
 * something that would fail.
 *
 * The contract is deliberately small - availability, and one call that takes a
 * prompt and returns text. Everything that makes a provider useful for this
 * platform (what to ask, how to read the answer, what may be written) lives
 * above it, so a second provider is a file rather than a project.
 *
 * This module imports nothing, so the shapes can be used from a form.
 */

export type Availability = {
  available: boolean;
  /** Why not, in words somebody can act on. */
  reason?: string;
  /** What they should do about it. */
  remedy?: string;
  /** Where it was found, when it was. */
  detail?: string;
};

export type ExtensionResult = {
  ok: boolean;
  text?: string;
  model?: string;
  durationMs?: number;
  /**
   * What the call cost, where the provider reports it.
   *
   * Zero on a subscription-backed provider, which is the point of choosing
   * one. Recorded anyway so that a tenant who later switches to a metered
   * provider can see what changed.
   */
  costUsd?: number;
  error?: string;
  raw?: unknown;
};

export type AiProvider = {
  /** Stable identifier, stored against the tenant. Never change one. */
  name: string;
  label: string;
  description: string;
  /** What it uses when the caller does not say. */
  defaultModel: string;
  availability(tenantId?: string): Promise<Availability> | Availability;
  run(input: {
    prompt: string;
    system?: string;
    model?: string;
    timeoutMs?: number;
    /**
     * A directory the provider may read, and write its answer into.
     *
     * Optional, and the difference between asking a coding assistant for
     * JSON and getting it. Claude Code is an agent with file tools sitting
     * behind its own system prompt, and a system prompt that is appended to
     * rather than replacing it loses an argument about output format every
     * time - it answered the first attempt in prose with a markdown table.
     *
     * Given a workspace it reads the documents as files and writes the answer
     * as a file, which is what it is built to do and what it does reliably.
     * Without one it runs in an empty temporary directory and sees nothing.
     */
    workdir?: string;
    /** Whose working directory to use. Each tenant has its own. */
    tenantId?: string;
    /**
     * The caller's own subscription token, for this run only.
     *
     * Supplied per call rather than configured, because it belongs to the
     * person who asked and not to the platform. A provider must pass it to the
     * tool it runs and must not write it anywhere: no file, no log, no error
     * message. Nothing above this contract ever sees it - the registry reads it
     * at the moment of a run and does not return it.
     */
    token?: string;
  }): Promise<ExtensionResult>;
};

/** Every provider name the platform knows. Used to validate a stored setting. */
export const PROVIDER_NAMES = ["claude_code"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];
