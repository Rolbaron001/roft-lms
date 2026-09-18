import Image from "next/image";
import { platformIllustration } from "@/lib/platform";
import { currentTenant } from "@/lib/request";

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
export async function EmptyState({
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
  /*
   * The tenant's own picture, or this deployment's, or none.
   *
   * It was the deployment's alone, which was right while a deployment served
   * one operator and wrong as soon as it serves several - one tenant's mascot
   * has no business appearing in another tenant's product. A tenant that never
   * sets one is unaffected: null falls through to exactly what was there
   * before.
   */
  const tenant = showIllustration ? await currentTenant() : null;
  const illustration = showIllustration
    ? (tenant?.illustrationUrl ?? platformIllustration())
    : null;

  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-12 text-center">
      {/*
        A remote address is drawn without the image optimiser, which refuses a
        host that is not in next.config's remotePatterns and answers 400. A
        tenant who pasted an https address got no picture and no explanation.
        See components/tenant-illustration.tsx for the whole reasoning; the
        same rule has to hold in both places, or the same graphic appears on
        one screen and not the other.
      */}
      {illustration ? (
        /^https?:\/\//i.test(illustration) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={illustration} alt="" className="h-24 w-auto opacity-90" />
        ) : (
          <Image
            src={illustration}
            alt=""
            width={60}
            height={145}
            className="h-24 w-auto opacity-90"
          />
        )
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
