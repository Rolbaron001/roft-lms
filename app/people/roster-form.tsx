"use client";

import { useActionState } from "react";
import { AiSwitch } from "@/components/ai-switch";
import {
  commitRosterAction,
  readRosterAction,
  type RosterActionState,
} from "./roster-actions";

const buttonClass =
  "rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60";

/**
 * Creating a cohort of learners from a spreadsheet.
 *
 * Two steps with a person in the middle, like everything else that reads a
 * document: it shows what it made of the file, and nobody is created until
 * somebody has looked. Ninety learners created from a mis-read column is not
 * an import, it is an afternoon of deletions.
 *
 * The rows themselves never leave the machine. Where an extension is used at
 * all it is asked about column headings, and the form says so.
 */
export function RosterForm({
  extension,
}: {
  /** Null where this person's role has no model assistance at all. */
  extension: { on: boolean; available: boolean } | null;
}) {
  const [readState, readAction, reading] = useActionState<
    RosterActionState,
    FormData
  >(readRosterAction, {});
  const [commitState, commitAction, committing] = useActionState<
    RosterActionState,
    FormData
  >(commitRosterAction, readState);

  // The commit action starts from whatever the read produced, so once
  // something has been committed its report wins.
  const state = commitState.notice || commitState.error ? commitState : readState;
  const proposal = readState.proposal;
  const usable = proposal?.rows.filter((row) => row.problems.length === 0) ?? [];
  const problems = proposal?.rows.filter((row) => row.problems.length > 0) ?? [];

  return (
    <div className="space-y-4">
      <form action={readAction} className="space-y-3">
        <input
          type="file"
          name="file"
          accept=".csv,.xlsx,.txt"
          required
          className="block text-sm"
        />

        <button type="submit" disabled={reading} className={buttonClass}>
          {reading ? "Reading…" : "Read the spreadsheet"}
        </button>

        <p className="max-w-2xl text-xs text-[var(--muted)]">
          CSV or Excel. Column headings are matched by name — &ldquo;Surname&rdquo;,
          &ldquo;Last Name&rdquo; and &ldquo;Van&rdquo; all work, and no
          extension is needed for any of it.
          {extension?.on && extension.available ? (
            <>
              {" "}
              <span className="font-medium text-[var(--success)]">
                Your AI extension is on
              </span>{" "}
              and will try to match any heading the rules miss. It is shown the
              headings only — never the rows, which carry identity numbers.
            </>
          ) : extension ? (
            <>
              {" "}
              With your AI extension switched on it would additionally match
              headings the rules do not recognise; it would be shown the
              headings only, never the rows. The switch is at the top of the
              page.
            </>
          ) : null}
        </p>

        {extension?.available ? (
          <AiSwitch on={extension.on} />
        ) : null}
      </form>

      {state.error ? (
        <p className="text-sm text-[var(--danger)]">{state.error}</p>
      ) : null}
      {state.notice ? (
        <p className="rounded-md border border-[var(--border)] p-3 text-sm">
          {state.notice}
        </p>
      ) : null}

      {/* --- what was created, shown once ---------------------------------- */}
      {state.passwords && state.passwords.length > 0 ? (
        <div className="rounded-md border border-[var(--border)] p-3">
          <p className="text-sm font-medium">
            Their first passwords, shown once
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            These are not stored anywhere they can be read again. Copy them now,
            or reset them individually later. Each person is asked to change
            theirs on first sign-in.
          </p>
          <ul className="mt-2 space-y-0.5 font-mono text-xs">
            {state.passwords.map((person) => (
              <li key={person.email}>
                {person.email} · {person.initialPassword}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* --- the proposal --------------------------------------------------- */}
      {proposal && !state.passwords ? (
        <div className="space-y-3 rounded-md border border-[var(--border)] p-3">
          <p className="text-sm font-medium">
            {proposal.filename} · headings on line {proposal.headerLine}
          </p>

          <div className="text-xs">
            <p className="text-[var(--muted)]">Columns matched</p>
            <ul className="mt-1 space-y-0.5">
              {Object.entries(proposal.detection.mapping).map(
                ([field, index]) => (
                  <li key={field}>
                    <span className="font-mono">
                      {proposal.headings[index as number]}
                    </span>{" "}
                    → {field}
                    {proposal.assisted.some(
                      (row) =>
                        row.heading === proposal.headings[index as number],
                    ) ? (
                      <span className="ml-2 text-[var(--muted)]">
                        matched by the AI:{" "}
                        {
                          proposal.assisted.find(
                            (row) =>
                              row.heading ===
                              proposal.headings[index as number],
                          )?.because
                        }
                      </span>
                    ) : null}
                  </li>
                ),
              )}
            </ul>
          </div>

          {proposal.detection.unmatched.length > 0 ? (
            <p className="text-xs text-[var(--muted)]">
              Ignored:{" "}
              {proposal.detection.unmatched
                .map((column) => `"${column.heading}"`)
                .join(", ")}
            </p>
          ) : null}

          {proposal.warnings.map((warning, index) => (
            <p key={index} className="text-xs text-[var(--muted)]">
              {warning}
            </p>
          ))}

          <p className="text-sm">
            {usable.length} will be created
            {problems.length > 0 ? `, ${problems.length} will be skipped` : ""}.
          </p>

          {problems.length > 0 ? (
            <ul className="space-y-0.5 text-xs text-[var(--danger)]">
              {problems.slice(0, 10).map((row) => (
                <li key={row.line}>
                  Line {row.line}: {row.problems.join(" ")}
                </li>
              ))}
              {problems.length > 10 ? (
                <li>And {problems.length - 10} more.</li>
              ) : null}
            </ul>
          ) : null}

          {usable.length > 0 ? (
            <form action={commitAction} className="flex flex-wrap items-center gap-2">
              <label className="text-sm">
                <span className="mr-2 text-[var(--muted)]">Create them as</span>
                <select
                  name="role"
                  defaultValue="learner"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                >
                  <option value="learner">Learners</option>
                  <option value="assessor">Assessors</option>
                  <option value="moderator">Moderators</option>
                  <option value="instructor">Facilitators</option>
                  <option value="workplace_coach">Workplace coaches</option>
                </select>
              </label>
              <button
                type="submit"
                disabled={committing}
                className="rounded-md bg-[var(--brand-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {committing
                  ? "Creating…"
                  : `Create ${usable.length} ${usable.length === 1 ? "person" : "people"}`}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
