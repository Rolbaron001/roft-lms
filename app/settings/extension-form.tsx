"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import {
  listExtensionModelsAction,
  updateMyExtensionAction,
  type ExtensionState,
  type ModelListState,
} from "./actions";
import { useT } from "@/components/i18n";
import { Rich } from "@/components/rich-text";

const inputClass =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

export type ExtensionView = {
  /** A token is stored. */
  registered: boolean;
  /** Set up and permitted, so it can be switched on for a sitting. */
  available: boolean;
  tokenHint: string | null;
  tokenAddedAt: string | null;
  provider: string | null;
  model: string | null;
  availability: {
    available: boolean;
    reason?: string;
    remedy?: string;
    detail?: string;
  } | null;
  providers: {
    name: string;
    label: string;
    description: string;
    /**
     * Whether this provider can run on the machine the platform is on.
     *
     * Not the same as whether it is set up. Claude Code shells out to a CLI,
     * and the deployed container does not have one - so on the server it is
     * permanently unavailable however correct somebody's token is. That is
     * what the qualification test hit on 16 September, and the folder screen
     * was taught to say it. This screen, one step earlier, was not: it offers
     * Claude first and says nothing, so the whole setup can be completed
     * perfectly and still not work.
     */
    runsHere: boolean;
    /** Why not, where it cannot. */
    reason: string | null;
    /** What this provider calls its credential: a token, or an API key. */
    credentialWord: string;
    /** What it uses when nobody says. Shown as the placeholder. */
    defaultModel: string;
    /** Whether it can be asked which models this credential reaches. */
    listsModels: boolean;
  }[];
};

/**
 * Your own AI extension, in Settings and against your own profile.
 *
 * Yours rather than the tenant's: every member of the provider's staff sets
 * their own, with their own subscription, and what it then lets them do is
 * bounded by their role exactly as everything else is. An administrator setting
 * theirs up does not set anybody else's up, and does not need to.
 *
 * This page is where it is set up. It is not where it is switched on - that
 * happens per sitting, from the switch at the top of any page, and starts off
 * every time somebody signs in.
 */
export function ExtensionForm({ current }: { current: ExtensionView }) {
  const t = useT();
  const [state, action, saving] = useActionState<ExtensionState, FormData>(
    updateMyExtensionAction,
    {},
  );
  const [available, setAvailable] = useState(current.available);
  /*
   * What they already chose, or the first one that can actually run here.
   *
   * Falling through to `providers[0]` put Claude Code in front of everybody on
   * a deployment where Claude Code cannot run - so the default was the one
   * choice guaranteed to fail. Somebody's existing choice is still honoured
   * even where it cannot run, because it is theirs and the warning below says
   * what is wrong with it; changing it under them would be worse.
   */
  const [provider, setProvider] = useState(
    current.provider ??
      current.providers.find((row) => row.runsHere)?.name ??
      current.providers[0]?.name ??
      "",
  );

  /**
   * Puts the chosen provider back into the select after every render.
   *
   * The same reset that empties a file input empties this, and a controlled
   * select is only written to when its value changes - which it has not, so
   * React leaves the browser's reset in place and the box shows the wrong
   * provider. Re-asserting it on every render costs nothing and keeps the
   * screen honest. `app/qualifications/from-document.tsx` holds the chosen
   * files back the same way, for the same reason.
   */
  const providerSelect = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (providerSelect.current) providerSelect.current.value = provider;
  });

  const chosen = current.providers.find((row) => row.name === provider);

  // Held in state because the model list writes into it.
  const [model, setModel] = useState(current.model ?? "");
  const [models, setModels] = useState<ModelListState>({});
  const [asking, startAsking] = useTransition();

  /*
   * A key bought from a provider, or a token minted from a subscription.
   *
   * Claude Code is the odd one out and the only one that draws on a
   * subscription somebody already pays for. Every other provider charges per
   * call against a key, and a Gemini Advanced or ChatGPT Plus subscription
   * does not include one - which everybody assumes it does, Roland included,
   * so the screen says so rather than waiting to be asked.
   *
   * Taken from the provider rather than from its name. `provider !==
   * "claude_code"` was right for the three that exist and wrong for the first
   * subscription-backed one anybody adds next, which would be asked for an
   * API key it does not have.
   */
  const credentialKind = chosen?.credentialWord ?? "token";
  const isKeyProvider = credentialKind !== "token";
  // The provider names its credential in English; the reader gets their own word.
  const credentialWord = isKeyProvider ? t("ext.cred.apiKey") : t("ext.cred.token");

  return (
    <form action={action} className="space-y-4">
      {current.registered ? (
        <div className="rounded-md border border-[var(--border)] p-3 text-sm">
          <p className="font-medium">{t("ext.stored")}</p>
          <p className="mt-1 text-[var(--muted)]">
            {current.tokenAddedAt
              ? t("ext.endingSaved", { hint: current.tokenHint ?? "", date: current.tokenAddedAt })
              : t("ext.ending", { hint: current.tokenHint ?? "" })}{" "}
            {t("ext.encrypted")}
          </p>
          <button
            type="submit"
            name="intent"
            value="forget"
            disabled={saving}
            className="mt-2 rounded-md border border-[var(--danger)] px-3 py-1 text-xs text-[var(--danger)] disabled:opacity-60"
          >
            {t("ext.discard")}
          </button>
        </div>
      ) : null}

      {/*
        Which provider, first, because it decides what everything below is.
        
        This sat underneath the credential field and behind the "make it
        available" checkbox, and the credential defaulted to Claude's. So
        somebody opening this screen was asked for a Claude token, shown how to
        generate a Claude token, and never saw that there was a choice - which
        is exactly what Roland reported on 18 September: "Everything under AI
        Extension still only points to Claude." Gemini and OpenAI had been
        there for two days, three controls further down.
        
        A field whose meaning depends on an answer cannot come before the
        question.
      */}
      {/*
        The provider is posted from state, not from the select.

        React resets a form's DOM once a form action resolves. The select is
        controlled, so React only writes to it when its value changes - and
        after a failed save the state has not changed, so nothing re-writes it
        and the browser's reset stands. The box snaps back to the first option,
        Claude Code, while the panel below it still reads from state and still
        shows Gemini.

        Roland photographed exactly that on 19 September: "Which one" saying
        Claude, over Gemini's description, Gemini's "Your API key" field and
        Gemini's guide. The display being wrong is the visible half. The
        dangerous half is that the DOM is what a form submits, so the next save
        would post claude_code while the person read Gemini on the screen - and
        the error that came back was Claude's, about a token they had never
        been asked for.

        So a hidden field carries the answer and the select is only a control.
      */}
      <input type="hidden" name="provider" value={provider} />

      {current.providers.length > 1 ? (
        <label className="block text-sm">
          <span className="font-medium">{t("ext.which")}</span>
          <select
            ref={providerSelect}
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            className={`${inputClass} mt-1 block w-full max-w-md`}
          >
            {current.providers.map((row) => (
              <option key={row.name} value={row.name}>
                {row.label}
                {row.runsHere ? "" : ` · ${t("ext.cannotRunHere")}`}
              </option>
            ))}
          </select>
          {chosen && !chosen.runsHere ? (
            /*
              Said here rather than after a failed run. Everything below this
              still works - the token is stored and kept - because a platform
              run on somebody's own machine can use it, and telling them they
              may not set up what they have is not this screen's business.
              What it must not do is let them finish and assume it will work.
            */
            <span className="mt-2 block max-w-2xl rounded-md border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 px-3 py-2 text-xs">
              <span className="font-medium">{t("ext.cannotRun")}</span>{" "}
              {chosen.reason ?? t("ext.needsProgram")} {t("ext.chooseKey")}
            </span>
          ) : null}
          {chosen ? (
            <span className="mt-1 block max-w-2xl text-xs text-[var(--muted)]">
              {chosen.description}
            </span>
          ) : null}
        </label>
      ) : (
        <input type="hidden" name="provider" value={provider} />
      )}

      {/*
        The word depends on the provider, and so does where it comes from.
        Claude's is a subscription token generated on your own machine; Gemini's
        is an API key from Google AI Studio. Calling both "token" left somebody
        looking for the wrong thing in the wrong place.
      */}
      <label className="block text-sm">
        <span className="text-[var(--muted)]">
          {current.registered
            ? t("ext.replace", { credential: credentialWord })
            : t("ext.yours", { credential: credentialWord })}
        </span>
        <input
          name="token"
          type="password"
          autoComplete="off"
          placeholder={
            /*
              Gemini's is deliberately vague. Google has issued keys beginning
              AIza and beginning AQ., so a placeholder naming either one tells
              half the people holding a valid key that theirs is wrong.
            */
            provider === "gemini"
              ? t("ext.geminiHint")
              : provider === "openai"
                ? "sk-proj-…"
                : "sk-ant-oat…"
          }
          className={`${inputClass} mt-1 block w-full max-w-md font-mono`}
        />
      </label>

      {isKeyProvider ? <ApiKeyGuide provider={provider} /> : <SetupGuide />}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="available"
          checked={available}
          onChange={(event) => setAvailable(event.target.checked)}
        />
        {t("ext.available")}
      </label>

      {available ? (
        <>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">{t("ext.model")}</span>
            <input
              name="model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              // The provider's own default, not a third copy of the name kept
              // here. This listed gemini-2.5-flash for a fortnight after
              // Google stopped serving it.
              placeholder={chosen?.defaultModel ?? ""}
              className={`${inputClass} mt-1 block w-full max-w-md`}
            />
          </label>

          {/*
            What this key can actually reach, asked of the provider.

            Google retired gemini-2.5-flash and answered a valid request with
            "no longer available to new users". The name had been written into
            this codebase from memory - right once, wrong within the month, and
            the failure landed on the person trying to use it. Bumping it to
            the next name only resets that clock.

            So nobody has to know a model name: ask, and choose from what came
            back. A provider that cannot be asked says so rather than showing
            an empty list, which would read as "none" for a working provider.
          */}
          {chosen?.listsModels ? (
            <div className="space-y-2">
              <button
                type="button"
                disabled={asking}
                onClick={() =>
                  startAsking(async () => {
                    setModels(await listExtensionModelsAction());
                  })
                }
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60"
              >
                {asking ? t("ext.asking") : t("ext.showModels", { credential: credentialWord })}
              </button>

              {models.error ? (
                <p className="text-sm text-[var(--danger)]">{models.error}</p>
              ) : null}

              {models.models && models.models.length > 0 ? (
                <div className="max-h-48 overflow-y-auto rounded-md border border-[var(--border)] p-2">
                  <p className="mb-1 text-xs text-[var(--muted)]">
                    {t("ext.modelsAvailable", { count: models.models.length })}
                  </p>
                  <ul className="flex flex-wrap gap-1">
                    {models.models.map((name) => (
                      <li key={name}>
                        <button
                          type="button"
                          onClick={() => setModel(name)}
                          className={`rounded px-2 py-0.5 font-mono text-xs ${
                            model === name
                              ? "bg-[var(--brand-primary)] text-white"
                              : "border border-[var(--border)] hover:bg-[var(--border)]/40"
                          }`}
                        >
                          {name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {current.availability && !current.availability.available ? (
            <div className="rounded-md border border-[var(--border)] p-3 text-sm">
              <p className="font-medium">{t("ext.notReady")}</p>
              <p className="mt-1 text-[var(--muted)]">
                {current.availability.reason}
              </p>
              {current.availability.remedy ? (
                <p className="mt-1 text-[var(--muted)]">
                  {current.availability.remedy}
                </p>
              ) : null}
            </div>
          ) : null}

          {/*
            Said plainly, because per-person means the platform holds something
            it holds for nothing else, and somebody agreeing to that should know
            they are agreeing to it.
          */}
          <p className="max-w-2xl rounded-md border border-[var(--border)] p-3 text-xs text-[var(--muted)]">
            <span className="font-medium">{t("ext.keeps")}</span>{" "}
            {t("ext.keepsNote", { credential: credentialWord })}
          </p>
        </>
      ) : (
        <p className="max-w-2xl text-xs text-[var(--muted)]">
          {current.registered ? t("ext.keptUnused") : t("ext.offNote")}
        </p>
      )}

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--muted)]">{state.notice}</p>
      ) : null}

      <button
        type="submit"
        disabled={saving}
        className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {saving ? t("common.saving") : t("common.save")}
      </button>
    </form>
  );
}

/**
 * How to get a token, for somebody who has never used a terminal.
 *
 * No link can do this part. A web page cannot run a program on the reader's
 * computer, and the whole point of the design is that the credential is created
 * on their machine and never travels except as the token itself. So the next
 * best thing is to make the manual step short, exact, and copyable, and to name
 * the one failure that will otherwise stop half the people who try it.
 *
 * That failure is Windows. PowerShell refuses to run the `claude.ps1` shim npm
 * installs, with an error about scripts being disabled that reads like a broken
 * installation rather than a policy default. `claude.cmd` sidesteps it entirely
 * and needs no security setting changed, so it is what this shows to Windows
 * readers by default.
 */
function SetupGuide() {
  const t = useT();
  // Read through useSyncExternalStore rather than an effect. The server has no
  // navigator and must render something, and setting state in an effect to
  // correct it afterwards is both a cascading render and a visible flicker.
  // This gives the server its own answer and the browser the real one, with no
  // render in between. Same approach as components/zoned-time.tsx.
  const detected = useSyncExternalStore(
    subscribeToNothing,
    detectSystem,
    () => "unix" as const,
  );

  // The guess is sometimes wrong - a Mac used to reach a Windows machine, a
  // browser that reports nothing useful - so it is a starting point, not a
  // verdict.
  const [chosenSystem, setChosenSystem] = useState<"windows" | "unix" | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const system = chosenSystem ?? detected;
  const setSystem = setChosenSystem;

  const command =
    system === "windows" ? "claude.cmd setup-token" : "claude setup-token";

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the command is on screen regardless.
      setCopied(false);
    }
  }

  return (
    <div className="max-w-2xl rounded-md border border-[var(--border)] p-3 text-xs text-[var(--muted)]">
      <p className="text-sm font-medium text-[var(--foreground)]">{t("ext.tokenFrom")}</p>
      <p className="mt-1">{t("ext.tokenFromNote")}</p>

      <ol className="mt-3 space-y-3">
        <li>
          <span className="font-medium text-[var(--foreground)]">{t("ext.step1")}</span>{" "}
          <Rich
            text={t("ext.step1Rest")}
            parts={{
              link: (
                <a
                  href="https://code.claude.com/docs/en/setup"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {t("ext.installGuide")}
                </a>
              ),
            }}
          />
        </li>

        <li>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-[var(--foreground)]">{t("ext.step2")}</span>
            <span className="inline-flex overflow-hidden rounded border border-[var(--border)]">
              {(["windows", "unix"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSystem(option)}
                  className={[
                    "px-2 py-0.5 text-[11px]",
                    system === option
                      ? "bg-[var(--brand-primary)] text-white"
                      : "text-[var(--muted)]",
                  ].join(" ")}
                >
                  {option === "windows" ? t("ext.windows") : t("ext.unix")}
                </button>
              ))}
            </span>
          </div>

          <div className="mt-1 flex items-center gap-2">
            <pre className="flex-1 overflow-x-auto rounded bg-[var(--surface)] px-2 py-1 font-mono">
              {command}
            </pre>
            <button
              type="button"
              onClick={copy}
              className="shrink-0 rounded border border-[var(--border)] px-2 py-1 text-[11px]"
            >
              {copied ? t("ext.copied") : t("ext.copy")}
            </button>
          </div>

          {system === "windows" ? (
            <p className="mt-1">
              <span className="font-medium text-[var(--foreground)]">
                <Rich text={t("ext.noteCmd")} parts={{ cmd: <span className="font-mono">.cmd</span> }} />
              </span>{" "}
              <Rich
                text={t("ext.cmdNote")}
                parts={{
                  plain: <span className="font-mono">claude setup-token</span>,
                  cmd: <span className="font-mono">.cmd</span>,
                }}
              />
            </p>
          ) : null}
        </li>

        <li>
          <span className="font-medium text-[var(--foreground)]">{t("ext.step3")}</span>
          <Rich text={t("ext.step3Rest")} parts={{ prefix: <span className="font-mono">sk-ant-oat</span> }} />
        </li>
      </ol>

      <p className="mt-3">{t("ext.notApiKey")}</p>
    </div>
  );
}

/** Nothing to subscribe to: the platform does not change mid-visit. */
function subscribeToNothing(): () => void {
  return () => {};
}

function detectSystem(): "windows" | "unix" {
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ??
    navigator.platform ??
    "";
  return /win/i.test(platform) ? "windows" : "unix";
}

/**
 * Where an API key comes from, and the thing everybody gets wrong.
 *
 * A Gemini Advanced or ChatGPT Plus subscription does not include API access.
 * They are separate products with separate billing, and the assumption that
 * paying for one buys the other is near-universal — Roland made it on
 * 16 September, which is what prompted this being written down rather than
 * explained one person at a time.
 *
 * Said before the steps rather than after them, because somebody who believes
 * their subscription covers it will not read past the first instruction that
 * seems to contradict them.
 */
function ApiKeyGuide({ provider }: { provider: string }) {
  const t = useT();
  const gemini = provider === "gemini";
  const strong = (text: string) => <span className="font-medium text-[var(--foreground)]">{text}</span>;

  return (
    <div className="max-w-2xl space-y-2 rounded-md border border-[var(--border)] p-3 text-xs text-[var(--muted)]">
      <p className="text-sm font-medium text-[var(--foreground)]">{t("ext.keyFrom")}</p>

      <p>
        {strong(t("ext.notSubscription"))} {gemini ? t("ext.geminiSeparate") : t("ext.openaiSeparate")}
      </p>

      {!gemini ? (
        <p>
          <Rich
            text={t("ext.openaiCreate")}
            parts={{
              site: <span className="font-mono">platform.openai.com</span>,
              menu: strong(t("ext.apiKeys")),
              prefix: <span className="font-mono">sk-</span>,
            }}
          />{" "}
          {strong(t("ext.noFreeTier"))} {t("ext.noFreeTierNote")}
        </p>
      ) : (
        <>
          <p>
            <Rich
              text={t("ext.geminiCreate")}
              parts={{
                site: <span className="font-mono">aistudio.google.com</span>,
                menu: strong(t("ext.getApiKey")),
              }}
            />
          </p>
          <p>{t("ext.geminiFree")}</p>
        </>
      )}

      <p>{t("ext.keyYours")}</p>
    </div>
  );
}
