"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import {
  readFolderAction,
  type ImportActionState,
} from "@/app/imports/actions";
import { AiSwitch } from "./ai-switch";

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
  label,
  hint,
  extension,
}: {
  /** Exactly one of these files against something that already exists. */
  qualificationId?: string;
  courseId?: string;
  learningPathId?: string;
  label: string;
  hint: React.ReactNode;
  /** Null where this person has no extension set up at all. */
  extension?: {
    /** Switched on for this sitting. */
    on: boolean;
    /** The provider can actually run here. */
    available: boolean;
    reason: string | null;
  } | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ImportActionState>({});
  const [chosen, setChosen] = useState<{ count: number; name: string } | null>(
    null,
  );
  const [pending, start] = useTransition();

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

  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="text-[var(--muted)]">{label}</span>
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
          className="mt-1 block text-sm"
        />
      </label>

      {chosen ? (
        <p className="text-xs text-[var(--muted)]">
          {chosen.name} — {chosen.count}{" "}
          {chosen.count === 1 ? "file" : "files"}, including everything in its
          subfolders.
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

      <button
        type="button"
        onClick={send}
        disabled={pending || !chosen}
        className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Reading…" : "Read this folder"}
      </button>

      <div className="max-w-2xl text-xs text-[var(--muted)]">{hint}</div>

      {extension ? (
        <div className="max-w-2xl space-y-2 border-t border-[var(--border)] pt-3">
          <p className="text-xs text-[var(--muted)]">
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
