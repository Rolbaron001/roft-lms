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
  const credentialWord = chosen?.credentialWord ?? "token";
  const isKeyProvider = credentialWord !== "token";

  return (
    <form action={action} className="space-y-4">
      {current.registered ? (
        <div className="rounded-md border border-[var(--border)] p-3 text-sm">
          <p className="font-medium">A token is stored</p>
          <p className="mt-1 text-[var(--muted)]">
            Ending {current.tokenHint}
            {current.tokenAddedAt ? `, saved ${current.tokenAddedAt}` : ""}. It
            is encrypted and is never shown again, here or anywhere else.
          </p>
          <button
            type="submit"
            name="intent"
            value="forget"
            disabled={saving}
            className="mt-2 rounded-md border border-[var(--danger)] px-3 py-1 text-xs text-[var(--danger)] disabled:opacity-60"
          >
            Discard it
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
          <span className="font-medium">Which one</span>
          <select
            ref={providerSelect}
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            className={`${inputClass} mt-1 block w-full max-w-md`}
          >
            {current.providers.map((row) => (
              <option key={row.name} value={row.name}>
                {row.label}
                {row.runsHere ? "" : " — cannot run on this platform"}
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
              <span className="font-medium">
                This one cannot run on this platform, so setting it up here will
                not make the AI features work.
              </span>{" "}
              {chosen.reason ??
                "It needs a program installed on the machine the platform runs on."}{" "}
              Choose one of the API-key providers instead — those call the
              provider over the internet and work wherever the platform is
              installed.
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
            ? `Replace it with a new ${credentialWord} — leave empty to keep the stored one`
            : `Your ${credentialWord}`}
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
              ? "your key from Google AI Studio"
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
        Make it available to switch on
      </label>

      {available ? (
        <>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">
              Model — leave empty for the provider&rsquo;s own default
            </span>
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
                {asking
                  ? "Asking…"
                  : `Show the models this ${credentialWord} can use`}
              </button>

              {models.error ? (
                <p className="text-sm text-[var(--danger)]">{models.error}</p>
              ) : null}

              {models.models && models.models.length > 0 ? (
                <div className="max-h-48 overflow-y-auto rounded-md border border-[var(--border)] p-2">
                  <p className="mb-1 text-xs text-[var(--muted)]">
                    {models.models.length} available to you today. Choosing one
                    fills the box above; it is saved when you press Save.
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
              <p className="font-medium">Not ready yet</p>
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
            <span className="font-medium">What the platform keeps.</span> Your{" "}
            {credentialWord}, encrypted, until you discard it. It is used only for work you
            ask for, only while you have the switch on, and it is never shown
            back to you or written to any log. Available is not the same as on:
            every sitting starts with it off, you switch it on for a job, and
            signing out switches it off for you if you forget.
          </p>
        </>
      ) : (
        <p className="max-w-2xl text-xs text-[var(--muted)]">
          {current.registered
            ? "Your token is kept but cannot be used. Nothing in the platform will offer AI assistance until you make it available again."
            : "With this off, the platform behaves exactly as it does without an extension — the affordances are absent rather than offered and failing."}
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
        {saving ? "Saving…" : "Save"}
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
      <p className="text-sm font-medium text-[var(--foreground)]">
        Where the token comes from
      </p>
      <p className="mt-1">
        This part happens on your own computer, not here — which is the point:
        your subscription is authorised by you, on your machine, and only the
        token it produces ever reaches this platform.
      </p>

      <ol className="mt-3 space-y-3">
        <li>
          <span className="font-medium text-[var(--foreground)]">
            1. Install Claude Code
          </span>{" "}
          if you have not already —{" "}
          <a
            href="https://code.claude.com/docs/en/setup"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            the install guide
          </a>
          . You need a Claude subscription of your own.
        </li>

        <li>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-[var(--foreground)]">
              2. Run this
            </span>
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
                  {option === "windows" ? "Windows" : "Mac or Linux"}
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
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          {system === "windows" ? (
            <p className="mt-1">
              <span className="font-medium text-[var(--foreground)]">
                Note the <span className="font-mono">.cmd</span>.
              </span>{" "}
              Plain <span className="font-mono">claude setup-token</span> in
              PowerShell usually fails with &ldquo;running scripts is disabled
              on this system&rdquo;. That is a Windows default rather than
              anything wrong with your installation, and the{" "}
              <span className="font-mono">.cmd</span> form avoids it without
              changing any security setting.
            </p>
          ) : null}
        </li>

        <li>
          <span className="font-medium text-[var(--foreground)]">
            3. Sign in when it opens your browser
          </span>
          , then copy the token it prints — it begins{" "}
          <span className="font-mono">sk-ant-oat</span> — and paste it above.
        </li>
      </ol>

      <p className="mt-3">
        It is not an API key and there is no per-token cost: it draws on the
        Claude subscription you already pay for. Never give anybody your
        Anthropic password — this platform has no field for one and would not
        accept it here.
      </p>
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
  const gemini = provider === "gemini";

  return (
    <div className="max-w-2xl space-y-2 rounded-md border border-[var(--border)] p-3 text-xs text-[var(--muted)]">
      <p className="text-sm font-medium text-[var(--foreground)]">
        Where the key comes from
      </p>

      <p>
        <span className="font-medium text-[var(--foreground)]">
          A subscription is not an API key.
        </span>{" "}
        {gemini
          ? "Gemini Advanced and the Gemini API are separate products with separate billing. Paying for the first does not give you the second, and there is no way to make it."
          : "ChatGPT Plus and the OpenAI API are separate products with separate billing. Paying for the first does not give you the second, and there is no way to make it."}
      </p>

      {!gemini ? (
        <p>
          Create a key at{" "}
          <span className="font-mono">platform.openai.com</span>, under{" "}
          <span className="font-medium text-[var(--foreground)]">API keys</span>
          , and paste it above. It begins{" "}
          <span className="font-mono">sk-</span>.{" "}
          <span className="font-medium text-[var(--foreground)]">
            There is no free tier
          </span>{" "}
          — unlike Gemini, every call is charged to the account the key belongs
          to, so expect a bill, however small.
        </p>
      ) : (
        <>
          <p>
            Sign in at{" "}
            <span className="font-mono">aistudio.google.com</span>, choose{" "}
            <span className="font-medium text-[var(--foreground)]">
              Get API key
            </span>
            , create one, and paste it above. Google has issued keys in more
            than one format, so paste whatever it gives you — this platform
            does not second-guess it.
          </p>
          <p>
            The Gemini API has a free tier, so this costs nothing to try. It
            limits how many requests you may make in a minute rather than
            charging for them — reading a large folder can hit that, and the
            platform will say so plainly if it does.
          </p>
        </>
      )}

      <p>
        It is yours, not the tenant&rsquo;s. It is encrypted, used only for work
        you ask for while your switch is on, never shown back to you, and never
        written to a log.
      </p>
    </div>
  );
}
