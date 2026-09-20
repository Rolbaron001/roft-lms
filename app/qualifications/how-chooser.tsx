import Link from "next/link";

/**
 * The three ways to add a qualification, and nothing else until one is picked.
 *
 * Roland, 20 September: "Initially only display the 3 options with 'or'
 * in-between, selecting one will display its specific window to work from...
 * This just makes the process clearer. You don't need to read a whole page for
 * something you're not going to use."
 *
 * Before this, all three were on the screen at once: a panel, then a folder
 * card, then a drive card, then a dashed box with a form of eight fields. Four
 * hundred words of explanation for three jobs, of which somebody is doing one.
 *
 * He suggested a modal and I have not used one, deliberately. Two of these
 * three are work surfaces rather than dialogs - the folder route runs for
 * minutes with a progress counter, and the documents route is read, review,
 * then commit. A modal dismissed by a stray Escape or a click on the backdrop
 * would throw that away; a modal that refuses to be dismissed is not a modal.
 * A panel chosen by the URL closes to a link, survives a reload, and can be
 * sent to somebody.
 */

export type HowOption = {
  /** The value in the query string. */
  id: string;
  title: string;
  /** What it is for, in one line. */
  summary: string;
  /** What it needs from the person. */
  needs: string;
  /** What it costs in time, honestly. */
  speed: string;
};

export const HOW_OPTIONS: HowOption[] = [
  {
    id: "documents",
    title: "From its documents",
    summary:
      "The curriculum document, the SAQA qualification document and the assessment specification. The App reads the whole curriculum out of them.",
    needs: "Two or three PDFs or Word files.",
    speed: "Seconds. No AI involved at any point.",
  },
  {
    id: "folder",
    title: "From a folder",
    summary:
      "Everything at once: the curriculum, the study units, the guides, the workbooks and the policies, filed as they are read.",
    needs: "The qualification's whole folder, from your computer or a drive.",
    speed:
      "Minutes. A folder that includes a summary of itself needs no AI; one that does not has its structure worked out, and that part does.",
  },
  {
    id: "blank",
    title: "From scratch",
    summary:
      "An empty qualification you build by hand - the title, the code, the level and credits, then its modules one at a time.",
    needs: "The details in front of you.",
    speed: "As long as it takes. Nothing is read for you.",
  },
];

/**
 * Three cards with "or" between them, and one link each.
 *
 * Each says what it needs and what it costs, because that is what somebody is
 * actually choosing between. "From its documents" and "From a folder" are not
 * distinguishable by name alone.
 */
export function HowChooser({ basePath }: { basePath: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold">
        How would you like to add it?
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
        Three ways in. Pick one and only that one opens; you can close it again
        and choose differently.
      </p>

      <ol className="mt-4 space-y-3">
        {HOW_OPTIONS.map((option, index) => (
          <li key={option.id}>
            {index > 0 ? (
              <p className="mb-3 text-sm font-medium text-[var(--muted)]">or</p>
            ) : null}

            <Link
              href={`${basePath}?view=add&how=${option.id}`}
              className="block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 hover:border-[var(--brand-accent)]"
            >
              <p className="font-medium">{option.title}</p>
              <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
                {option.summary}
              </p>
              <p className="mt-2 text-xs text-[var(--muted)]">
                <span className="font-medium text-[var(--foreground)]">
                  Needs:
                </span>{" "}
                {option.needs}{" "}
                <span className="font-medium text-[var(--foreground)]">
                  Takes:
                </span>{" "}
                {option.speed}
              </p>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The way back, shown above whichever one was chosen. */
export function ChooseDifferently({ basePath }: { basePath: string }) {
  return (
    <p className="mb-4">
      <Link
        href={`${basePath}?view=add`}
        className="text-sm text-[var(--muted)] underline-offset-2 hover:underline"
      >
        ← Choose a different way
      </Link>
    </p>
  );
}
