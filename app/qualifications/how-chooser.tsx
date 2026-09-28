import Link from "next/link";
import { pageT } from "@/lib/request";
import type { MessageKey } from "@/lib/i18n";

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
  id: "documents" | "folder" | "blank";
  title: MessageKey;
  /** What it is for, in one line. */
  summary: MessageKey;
  /** What it needs from the person. */
  needs: MessageKey;
  /** What it costs in time, honestly. */
  speed: MessageKey;
};

export const HOW_OPTIONS: HowOption[] = (["documents", "folder", "blank"] as const).map((id) => ({
  id,
  title: `how.${id}.title`,
  summary: `how.${id}.summary`,
  needs: `how.${id}.needs`,
  speed: `how.${id}.speed`,
}));

/**
 * Three cards with "or" between them, and one link each.
 *
 * Each says what it needs and what it costs, because that is what somebody is
 * actually choosing between. "From its documents" and "From a folder" are not
 * distinguishable by name alone.
 */
export async function HowChooser({ basePath }: { basePath: string }) {
  const t = await pageT();
  return (
    <div>
      <h2 className="text-sm font-semibold">{t("how.title")}</h2>
      <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("how.intro")}</p>

      <ol className="mt-4 space-y-3">
        {HOW_OPTIONS.map((option, index) => (
          <li key={option.id}>
            {index > 0 ? (
              <p className="mb-3 text-sm font-medium text-[var(--muted)]">{t("how.or")}</p>
            ) : null}

            <Link
              href={`${basePath}?view=add&how=${option.id}`}
              className="block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 hover:border-[var(--brand-accent)]"
            >
              <p className="font-medium">{t(option.title)}</p>
              <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t(option.summary)}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">
                <span className="font-medium text-[var(--foreground)]">{t("how.needs")}</span>{" "}
                {t(option.needs)}{" "}
                <span className="font-medium text-[var(--foreground)]">{t("how.takes")}</span>{" "}
                {t(option.speed)}
              </p>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The way back, shown above whichever one was chosen. */
export async function ChooseDifferently({ basePath }: { basePath: string }) {
  const t = await pageT();
  return (
    <p className="mb-4">
      <Link
        href={`${basePath}?view=add`}
        className="text-sm text-[var(--muted)] underline-offset-2 hover:underline"
      >
        {t("how.back")}
      </Link>
    </p>
  );
}
