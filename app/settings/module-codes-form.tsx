"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  moduleCodeCore,
  permutationsFor,
  type AliasRow,
} from "@/lib/module-codes";
import {
  updateModuleCodesAction,
  type ModuleCodesState,
} from "./module-codes-actions";

const field =
  "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[var(--brand-accent)]/30";

/**
 * The spellings this provider's documents use for a module code.
 *
 * Roland, 21 September: "Once a code is selected under settings, let the
 * system create permutations and display them in a modal window so that the
 * user can alter, add others, and confirm them. Then the system can use these
 * when uploading."
 *
 * The section on the page is deliberately small - a count and a button. The
 * table is fifteen rows of several spellings each, which is a great deal of
 * screen for something looked at twice a year, and Heidi asked that these
 * screens not become cluttered. So the detail lives in the modal and the page
 * says only what is in force.
 *
 * A native <dialog>, because the browser already does the hard parts properly:
 * focus is trapped inside it, Escape closes it, and the rest of the page is
 * inert while it is open. A div pretending to be a modal gets all three wrong.
 */
export function ModuleCodesForm({
  rows,
  confirmed,
}: {
  rows: AliasRow[];
  confirmed: boolean;
}) {
  const [state, act, pending] = useActionState<ModuleCodesState, FormData>(
    updateModuleCodesAction,
    {},
  );

  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [table, setTable] = useState(rows);
  const [adding, setAdding] = useState<Record<string, string>>({});
  const [newStandard, setNewStandard] = useState("");

  // showModal() rather than the open attribute: only the method gives the
  // top layer, the backdrop and the focus trap.
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  /*
   * Saving does not close this.
   *
   * Closing it on success needed a setState inside an effect, which React now
   * warns about and rightly: it is a cascading render to do something the
   * markup can say for itself. It also hid the confirmation, since the
   * result appeared behind the dialog that was still on screen when the save
   * began. So the result is shown here, in the footer, next to the table it
   * describes, and the person closes it when they have read it.
   */

  const total = table.reduce((sum, row) => sum + row.aliases.length, 0);

  function removeAlias(canonical: string, alias: string) {
    setTable((current) =>
      current.map((row) =>
        row.canonical === canonical
          ? { ...row, aliases: row.aliases.filter((one) => one !== alias) }
          : row,
      ),
    );
  }

  /*
   * A standard the loaded documents have not shown yet.
   *
   * Roland, 21 September: "the user only needs to input the standard ... Then
   * the system will automatically create the permutations/variations of the
   * code that might be relevant." So one box, and the variations appear.
   * Generated here in the browser, which is why lib/module-codes.ts imports
   * nothing.
   */
  function addStandard() {
    const standard = moduleCodeCore(newStandard);
    if (!standard) return;
    if (table.some((row) => row.canonical === standard)) {
      setNewStandard("");
      return;
    }

    const held = new Set(table.map((row) => row.canonical));
    setTable(
      [
        ...table,
        {
          canonical: standard,
          aliases: permutationsFor(standard).filter(
            (alias) => !held.has(alias),
          ),
          rejected: [],
        },
      ].sort((a, b) => a.canonical.localeCompare(b.canonical)),
    );
    setNewStandard("");
  }

  function addAlias(canonical: string) {
    const typed = moduleCodeCore(adding[canonical] ?? "");
    if (!typed) return;

    setTable((current) =>
      current.map((row) =>
        row.canonical === canonical && !row.aliases.includes(typed)
          ? { ...row, aliases: [...row.aliases, typed].sort() }
          : row,
      ),
    );
    setAdding((current) => ({ ...current, [canonical]: "" }));
  }

  function restoreProposed() {
    setTable(
      table.map((row) => ({
        ...row,
        aliases: [
          ...new Set([
            ...row.aliases,
            ...permutationsFor(row.canonical).filter(
              (alias) =>
                !row.rejected.some((one) => one.alias === alias) &&
                !table.some((other) => other.canonical === alias),
            ),
          ]),
        ].sort(),
      })),
    );
  }

  return (
    <section
      id="module-codes"
      data-settings-section="Module codes"
      className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        Module codes
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
        One module is written down differently in different documents &mdash;
        <span className="font-mono"> 242303-001-00-KM-01 </span> in the
        curriculum, <span className="font-mono">KM-01</span> in the alignment
        table, <span className="font-mono">KM1</span> in a summary. The long
        identifier, the punctuation and the capitals are handled by rule. This
        is where the App is told about the rest, so an upload links the module
        instead of reporting it missing.
      </p>

      {state.error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {state.error}
        </p>
      ) : null}

      {state.saved ? (
        <p
          className="mt-3 rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm"
          style={{ color: "var(--success)" }}
        >
          Saved. Uploads will use these from now on.
        </p>
      ) : null}

      <p className="mt-3 text-sm">
        {rows.length === 0 ? (
          <span className="text-[var(--muted)]">
            No curriculum has been loaded yet, so there are no standards to
            infer. Load a qualification and this fills itself in from its
            module codes.
          </span>
        ) : confirmed ? (
          <>
            <strong>{total}</strong> alternative spellings across{" "}
            <strong>{rows.length}</strong> modules, in use.
          </>
        ) : (
          <>
            <strong>{total}</strong> spellings proposed across{" "}
            <strong>{rows.length}</strong> modules.{" "}
            <span style={{ color: "var(--danger)" }}>
              Not in use until you have looked at them and confirmed.
            </span>
          </>
        )}
      </p>

      {rows.length > 0 ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 rounded-md px-3 py-1.5 text-sm font-medium text-white"
          style={{ background: "var(--brand-primary)" }}
        >
          {confirmed ? "View and edit them" : "Review and confirm"} &rarr;
        </button>
      ) : null}

      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        className="w-[min(56rem,92vw)] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--fg)] backdrop:bg-black/40"
      >
        <form action={act}>
          <div className="border-b border-[var(--border)] px-6 py-4">
            <h3 className="text-base font-semibold">Module codes</h3>
            <p className="mt-1 text-sm text-[var(--muted)]">
              The code on the left is your standard. The spellings beside it
              are what a document may use instead. Remove any that do not
              belong, add your own, then confirm.
            </p>
            <p className="mt-2 text-xs text-[var(--muted)]">
              A full QCTO identifier &mdash;{" "}
              <span className="font-mono">242303-001-00-KM-01</span> &mdash; is
              read as its module code by rule, and needs no row here. So are
              hyphens, spaces and capitals.
            </p>
          </div>

          <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                  <th className="pb-2 pr-4 font-medium">Module</th>
                  <th className="pb-2 font-medium">Also read as</th>
                </tr>
              </thead>
              <tbody>
                {table.map((row) => (
                  <tr
                    key={row.canonical}
                    className="border-t border-[var(--border)] align-top"
                  >
                    <td className="py-3 pr-4 font-mono font-medium">
                      {row.canonical}
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {row.aliases.map((alias) => (
                          <span
                            key={alias}
                            className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-0.5 font-mono text-xs"
                          >
                            {alias}
                            <button
                              type="button"
                              onClick={() => removeAlias(row.canonical, alias)}
                              aria-label={`Stop reading ${alias} as ${row.canonical}`}
                              className="text-[var(--muted)] hover:text-[var(--danger)]"
                            >
                              &times;
                            </button>
                          </span>
                        ))}

                        {row.aliases.length === 0 ? (
                          <span className="text-xs text-[var(--muted)]">
                            Only {row.canonical} itself.
                          </span>
                        ) : null}

                        <input
                          value={adding[row.canonical] ?? ""}
                          onChange={(event) =>
                            setAdding((current) => ({
                              ...current,
                              [row.canonical]: event.target.value,
                            }))
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              // Otherwise this submits the whole table while
                              // somebody is halfway through typing one code.
                              event.preventDefault();
                              addAlias(row.canonical);
                            }
                          }}
                          placeholder="add"
                          aria-label={`Another spelling of ${row.canonical}`}
                          className={`${field} w-24 font-mono text-xs`}
                        />
                      </div>

                      {/*
                        What was considered and withheld, with the reason.
                        Without this the first thing somebody does is add it
                        back by hand, which is the one edit that would make a
                        module match the wrong one.
                      */}
                      {row.rejected.length > 0 ? (
                        <ul className="mt-1.5 space-y-0.5 text-xs text-[var(--muted)]">
                          {row.rejected.map((one) => (
                            <li key={one.alias}>
                              <span className="font-mono">{one.alias}</span> was
                              not offered &mdash; {one.because}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/*
              A standard the loaded documents have not shown. The rows above
              are inferred from the curriculum, which covers the ordinary case;
              this is for a scheme that is coming rather than one already here.
            */}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
              <label htmlFor="new-standard" className="text-sm">
                Add a standard code
              </label>
              <input
                id="new-standard"
                value={newStandard}
                onChange={(event) => setNewStandard(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addStandard();
                  }
                }}
                placeholder="KM-06"
                className={`${field} w-28 font-mono text-xs`}
              />
              <button
                type="button"
                onClick={addStandard}
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium"
              >
                Add
              </button>
              <span className="text-xs text-[var(--muted)]">
                Its variations are worked out for you.
              </span>
            </div>
          </div>

          {/* The edited table, as the server reads it. The chips above are the
              state; this is what is actually submitted. */}
          <input
            type="hidden"
            name="table"
            value={JSON.stringify(
              Object.fromEntries(
                table.map((row) => [row.canonical, row.aliases]),
              ),
            )}
          />

          {state.error ? (
            <p
              role="alert"
              className="mx-6 mb-2 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-sm text-[var(--danger)]"
            >
              {state.error}
            </p>
          ) : null}

          {state.saved ? (
            <p
              className="mx-6 mb-2 rounded-md border border-[var(--success)]/30 bg-[var(--success)]/5 px-3 py-2 text-sm"
              style={{ color: "var(--success)" }}
            >
              Saved. Uploads will use these from now on.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-6 py-4">
            <button
              type="button"
              onClick={restoreProposed}
              className="text-sm underline underline-offset-2"
            >
              Put back everything the App proposed
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium"
              >
                {state.saved ? "Close" : "Close without saving"}
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                style={{ background: "var(--brand-primary)" }}
              >
                {pending ? "Saving…" : "Confirm these"}
              </button>
            </div>
          </div>
        </form>
      </dialog>
    </section>
  );
}
