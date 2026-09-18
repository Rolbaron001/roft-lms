"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  readFolderAction,
  type ImportActionState,
} from "@/app/imports/actions";
import { AiSwitch } from "./ai-switch";
import { AttentionMascot } from "./tenant-illustration";

/**
 * Choosing a folder to read.
 *
 * `extension` is null for anybody who has not set one up, and the note about it
 * disappears with it - so somebody without an extension sees a plain folder
 * picker rather than an advertisement for something they do not have.
 *
 * A folder picker rather than a path, which is the difference between a person
 * offering their own files and a server being told to go and read something.
 * They can only offer what they can already open, so nothing has to be
 * registered anywhere and nothing has to be restricted.
 *
 * The form is built by hand rather than posted straight, because the browser
 * hands over each file's folder-relative path separately from the file, and
 * both are needed: `_control/blueprint.json` has to be recognisable as the
 * blueprint, and a theory guide has to keep enough of its path to be filed
 * under the right study unit.
 */
export function FolderPicker({
  qualificationId,
  courseId,
  learningPathId,
  topUp,
  label,
  hint,
  extension,
}: {
  /** Exactly one of these files against something that already exists. */
  qualificationId?: string;
  courseId?: string;
  learningPathId?: string;
  /**
   * With a qualification: read its curriculum too, not only its documents.
   *
   * For finishing a qualification that was loaded from an incomplete folder.
   * What is already held stays; only what is missing is added.
   */
  topUp?: boolean;
  label: string;
  hint: React.ReactNode;
  /** Null where this person has no extension set up at all. */
  extension?: {
    /** Switched on for this sitting. */
    on: boolean;
    /** The provider can actually run here. */
    available: boolean;
    /**
     * A credential is stored, so there is a provider to ask about at all.
     *
     * Separate from `available` because the two were being collapsed, and the
     * message that came out of it was wrong. Somebody who has never set up an
     * extension has no provider, so nothing can report on whether it runs -
     * and this screen told them "your AI extension cannot run here", followed
     * by the empty space where the reason would have gone. Both halves are
     * false: they have no extension, and nothing is stopping them setting one
     * up.
     */
    registered: boolean;
    reason: string | null;
  } | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ImportActionState>({});
  const [chosen, setChosen] = useState<{ count: number; name: string } | null>(
    null,
  );
  const [pending, start] = useTransition();

  /*
   * How long it has been going, counted honestly.
   *
   * A reading takes minutes, and the button said "Reading…" and nothing else -
   * which is indistinguishable from a page that has hung. There is no real
   * progress to report: the work happens in one server call and does not
   * report back. So this counts the seconds and says what it is doing, rather
   * than drawing a bar that advances on a guess. A fake bar that reaches 90%
   * and stops is worse than no bar.
   */
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!pending) return;

    const started = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.round((Date.now() - started) / 1000)),
      1000,
    );
    // Reset on the way out rather than on the way in: setting state straight
    // away inside an effect makes React render twice for nothing.
    return () => {
      clearInterval(timer);
      setSeconds(0);
    };
  }, [pending]);

  function openPicker() {
    input.current?.click();
  }

  function choose() {
    const files = Array.from(input.current?.files ?? []);
    if (files.length === 0) {
      setChosen(null);
      return;
    }

    const first = relativePathOf(files[0]);
    setChosen({ count: files.length, name: first.split("/")[0] || "a folder" });
    setState({});
  }

  function send() {
    const files = Array.from(input.current?.files ?? []);
    if (files.length === 0) return;

    const body = new FormData();
    if (qualificationId) body.append("qualificationId", qualificationId);
    if (courseId) body.append("courseId", courseId);
    if (learningPathId) body.append("learningPathId", learningPathId);
    if (topUp) body.append("topUp", "yes");
    body.append("folderName", chosen?.name ?? "an uploaded folder");

    // Appended in step, so the two lists line up on the server.
    for (const file of files) {
      body.append("files", file);
      body.append("paths", relativePathOf(file));
    }

    start(async () => {
      setState(await readFolderAction({}, body));
    });
  }

  /*
   * Said before anything is chosen, not after it fails.
   *
   * The qualification test on 16 September failed here. Reading a folder that
   * does not describe itself needs an AI extension, and on the hosted server
   * no extension can run at all - the only provider shells out to a CLI that
   * is not in the container. So the screen invited Heidi to do the one thing
   * that could not work, and said so only once she had tried it.
   *
   * Nothing is disabled. A folder that carries a blueprint.json imports with
   * no extension whatever, and a folder of material never needed one. What is
   * new is that the condition is on the screen before the choice rather than
   * in the error afterwards.
   */
  const needsExtension = !qualificationId && !courseId && !learningPathId;
  const extensionUsable = Boolean(extension?.on && extension?.available);
  const extensionPossible = extension ? extension.available : false;

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--muted)]">{label}</p>

      {needsExtension && !extensionUsable ? (
        <div className="max-w-2xl rounded-md border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 px-3 py-2 text-sm">
          <p className="font-medium">
            Building a qualification from a folder needs an AI extension, unless
            the folder describes itself.
          </p>
          <p className="mt-1 text-[var(--muted)]">
            {extensionPossible
              ? "Yours is not switched on for this sitting. Switch it on below, or use the documents route instead — that needs no AI at all and reads the whole curriculum."
              : extension
                ? `Yours cannot run here: ${extension.reason ?? "it is not available on this machine."} Use the documents route instead — it needs no AI at all and reads the whole curriculum.`
                : "You do not have one set up. Use the documents route instead — it needs no AI at all and reads the whole curriculum, which is how the Commercial Cleaner qualification was imported."}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            A folder produced by a programme development system includes a
            summary of itself (a <code>_control/blueprint.json</code>), and one
            of those imports here in seconds with no extension involved.
          </p>
        </div>
      ) : null}

      {/*
        Driven by the button below rather than shown.
        
        It was visible until somebody reported the button as broken, and they
        were right to. A native file control renders as a small "Choose Files"
        with "No file chosen" beside it, which does not read as the first step
        of anything - so the eye goes to the large button underneath, which sat
        disabled until the control nobody had noticed had been used. A disabled
        button with no stated reason is indistinguishable from a broken one.
      */}
      <input
        ref={input}
        type="file"
        multiple
        onChange={choose}
        // Not in the React types, and the reason this works at all: it makes
        // the picker choose a folder and report every file inside it.
        {...({
          webkitdirectory: "",
          directory: "",
        } as Record<string, string>)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
      />

      {chosen ? (
        <p className="text-xs text-[var(--muted)]">
          <span className="font-medium text-[var(--foreground)]">
            {chosen.name}
          </span>{" "}
          — {chosen.count} {chosen.count === 1 ? "file" : "files"}, including
          everything in its subfolders.{" "}
          <button
            type="button"
            onClick={openPicker}
            className="underline"
          >
            Choose a different folder
          </button>
        </p>
      ) : null}

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--muted)]">
          {state.notice}{" "}
          {state.jobId ? (
            <Link href={`/imports/${state.jobId}`} className="underline">
              Review it
            </Link>
          ) : null}
        </p>
      ) : null}

      {/*
        One button, two steps. Never disabled while there is something for it
        to do, so it cannot look broken.

        Once a folder is chosen the button changes what it does, and nothing
        said so. Heidi chose a folder and did not realise the next step had
        appeared - so the button now announces itself when it becomes the thing
        to press.
      */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={chosen ? send : openPicker}
          disabled={pending}
          className={`rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${
            chosen && !pending
              ? "ring-2 ring-[var(--brand-accent)] ring-offset-2 ring-offset-[var(--surface)] motion-safe:animate-pulse"
              : ""
          }`}
        >
          {pending
            ? "Reading…"
            : chosen
              ? "Read this folder"
              : "Choose a folder…"}
        </button>

        {chosen && !pending ? (
          <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--brand-accent)]">
            {/* The tenant's character where one is set, and nothing where none
                is. Both it and the arrow are hidden from a screen reader, which
                is told the same thing by the sentence beside them. */}
            <AttentionMascot className="mr-1" />
            <span aria-hidden className="motion-safe:animate-bounce">
              ←
            </span>
            Now press this to read it. Nothing is saved yet.
          </p>
        ) : null}

        {pending ? (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-[var(--muted)]"
          >
            <span
              aria-hidden
              className="inline-block h-4 w-4 rounded-full border-2 border-[var(--border)] border-t-[var(--brand-accent)] motion-safe:animate-spin"
            />
            {seconds < 20
              ? "Reading the folder…"
              : seconds < 90
                ? `Still reading — ${seconds} seconds so far. A curriculum document takes a few minutes.`
                : `Still going — ${Math.floor(seconds / 60)} min ${seconds % 60}s. This is normal for a large folder; leave the page open.`}
          </p>
        ) : null}
      </div>

      <div className="max-w-2xl text-xs text-[var(--muted)]">{hint}</div>

      {extension ? (
        <div className="max-w-2xl space-y-2 border-t border-[var(--border)] pt-3">
          {/*
            The block at the top of the card already says the extension cannot
            run, or is off. Saying it again here made one card state the same
            fact three times. What is still worth having at the bottom is the
            switch itself, and the note for somebody whose extension is working.
          */}
          <p
            className="text-xs text-[var(--muted)]"
            hidden={needsExtension && !extensionUsable}
          >
            {extension.on && extension.available ? (
              <>
                <span className="font-medium text-[var(--success)]">
                  Your AI extension is on for this sitting.
                </span>{" "}
                A folder that does not include a summary of itself will have its
                structure worked out from the documents instead — slower, and
                worth checking against the curriculum document. Switch it off
                when you are done with it.
              </>
            ) : !extension.registered ? (
              /*
                Checked before "cannot run", because somebody with no extension
                has no provider for anything to report on. This screen used to
                fall through to the branch below and tell them their extension
                could not run here, followed by the gap where the reason would
                have been - two statements about a thing they do not have.
              */
              <>
                <span className="font-medium">
                  You do not have an AI extension set up.
                </span>{" "}
                It adds one thing here: working out the structure from the
                documents, when a folder does not include a summary of itself.
                Everything else on this page works without it. Settings, under
                your AI extension, if you want one.
              </>
            ) : !extension.available ? (
              <>
                <span className="font-medium">
                  Your AI extension cannot run here.
                </span>{" "}
                {extension.reason} A folder that includes a summary of itself
                still imports normally; one without it cannot have its structure
                worked out.
              </>
            ) : (
              <>
                <span className="font-medium">
                  Your AI extension is off, which is how every sitting starts.
                </span>{" "}
                It adds one thing here: working out the structure from the
                documents, when a folder does not include a summary of itself.
                Everything else on this page works without it.
              </>
            )}
          </p>

          {/* Switchable from here rather than only from the header, because
              this is where somebody finds out they wanted it on. */}
          {extension.available ? <AiSwitch on={extension.on} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The path the browser reports for a file inside a picked folder.
 *
 * `webkitRelativePath` is where every browser puts it despite the name. It is
 * empty for a file chosen individually, in which case the bare name is all
 * there is.
 */
function relativePathOf(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string })
    .webkitRelativePath;
  return relative && relative.length > 0 ? relative : file.name;
}
