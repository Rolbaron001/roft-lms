import Link from "next/link";

/**
 * Two jobs on one screen, told apart.
 *
 * Roland, 19 September: "Please separate the qualification detail that is
 * available from the upload process... Let's untangle the screens please."
 *
 * A qualification page was doing two unrelated things at once - showing what a
 * provider has, and offering the controls to add more - interleaved, so the
 * curriculum sat below three upload cards and the list of documents sat below
 * four. Somebody reading a curriculum had to scroll past the machinery for
 * building one, and somebody building one had to hunt for the controls among
 * five hundred lines of curriculum.
 *
 * A query parameter rather than client state, for three reasons: the tab
 * survives a reload, it can be linked to from elsewhere on the page, and the
 * whole thing stays a server component. `#anchor` still works within a tab,
 * which is what lets a module chip in one view jump to that module in another.
 */
export type ViewTab = {
  /** The value in the query string. The first one is the default. */
  id: string;
  label: string;
  /** A figure worth seeing without opening the tab. */
  count?: number;
};

export function ViewTabs({
  tabs,
  current,
  param = "view",
  basePath,
}: {
  tabs: ViewTab[];
  current: string;
  /** The query parameter this strip drives. */
  param?: string;
  /** The page the tabs belong to, without a query string. */
  basePath: string;
}) {
  return (
    <nav
      /*
        Named apart from the in-page navigation.
        
        Both were "Sections of this page", and a qualification page carries
        both at once - so a screen reader announced two landmarks with the same
        name and no way to tell which was which. They are different things:
        this switches between views of the page, PageNav moves within one.
      */
      aria-label="Views of this page"
      className="mb-6 flex flex-wrap gap-1 border-b border-[var(--border)]"
    >
      {tabs.map((tab, index) => {
        // The first tab is the default, so it needs no parameter - which keeps
        // the plain URL the one somebody would share.
        const href =
          index === 0 ? basePath : `${basePath}?${param}=${tab.id}`;
        const active = tab.id === current;

        return (
          <Link
            key={tab.id}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${
              active
                ? "border-[var(--brand-primary)] font-medium text-[var(--foreground)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {tab.label}
            {typeof tab.count === "number" ? (
              <span className="ml-1.5 text-xs text-[var(--muted)] tabular-nums">
                {tab.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
