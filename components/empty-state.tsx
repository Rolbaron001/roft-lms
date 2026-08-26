import Image from "next/image";
import { platformIllustration } from "@/lib/platform";

/**
 * What a screen says when there is nothing on it yet.
 *
 * An empty page reading "No results" tells somebody they are lost. This says
 * what would be here and what to do to put something here, which is the only
 * useful thing an empty state can do.
 *
 * The illustration comes from this deployment's configuration rather than
 * being named here: the same codebase is deployed for more than one operator,
 * and one of them having a mascot must not put that mascot in the other's
 * product. Where none is set the words stand alone, which is fine — they are
 * carrying the meaning anyway, and the picture is marked decorative for a
 * screen reader for exactly that reason.
 */
export function EmptyState({
  title,
  children,
  showIllustration = true,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  /** Set false where a picture would be flippant — a failed audit, say. */
  showIllustration?: boolean;
  action?: React.ReactNode;
}) {
  const illustration = showIllustration ? platformIllustration() : null;

  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
      {illustration ? (
        <Image
          src={illustration}
          alt=""
          width={60}
          height={145}
          className="h-24 w-auto opacity-90"
        />
      ) : null}

      <div className="max-w-sm space-y-1.5">
        <p className="text-sm font-semibold">{title}</p>
        {children ? (
          <div className="text-sm text-[var(--muted)]">{children}</div>
        ) : null}
      </div>

      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
