/**
 * The shape every role's dashboard is drawn in (job sheet D25). Roland, 8
 * October 2026: "Important that everything on the dashboard is clickable and
 * basically serves as a link to the actual item." So every tile and every row
 * carries the address of the thing it names, and the view has no way to show
 * one without it.
 *
 * Imports nothing, so a client component may use the types.
 */

export type DashTone = "danger" | "warning" | "good" | "plain";

/** A count across the top, under "Needs you today". */
export type DashTile = {
  key: string;
  count: number;
  label: string;
  detail: string;
  /** What the link says, such as "Open it" or "Open the logbooks". */
  open: string;
  href: string;
  tone: DashTone;
};

export type DashRow = {
  primary: string;
  secondary?: string;
  /** A short right-hand note: a date, a status, a count. */
  right?: string;
  tone?: DashTone;
  href: string;
  /** Opens in a new tab: a meeting link. */
  external?: boolean;
  /** Progress, 0 to 100. */
  bar?: number;
};

export type DashSection = {
  id: string;
  title: string;
  intro?: string;
  rows: DashRow[];
  /** Said when there are no rows. */
  empty: string;
  more?: { label: string; href: string };
};

export type RoleDashboard = {
  role: string;
  /** The top row's own heading, where "Needs you today" does not fit the role. */
  heading?: { title: string; intro: string };
  tiles: DashTile[];
  main: DashSection[];
  side: DashSection[];
};

const ORDER: Record<DashTone, number> = { danger: 0, warning: 1, plain: 2, good: 3 };

/**
 * One dashboard for somebody with several roles: every role's tiles in one
 * row, most urgent first, then each role's sections in turn. A section two
 * roles both produce (the same id) appears once.
 */
export function combineDashboards(parts: RoleDashboard[]): RoleDashboard {
  const seen = new Set<string>();
  const unique = (sections: DashSection[]) =>
    sections.filter((section) => (seen.has(section.id) ? false : (seen.add(section.id), true)));
  const tileSeen = new Set<string>();
  return {
    role: parts.map((part) => part.role).join("+"),
    // A role's own heading holds only while it is the only role.
    heading: parts.length === 1 ? parts[0].heading : undefined,
    tiles: parts
      .flatMap((part) => part.tiles)
      .filter((tile) => (tileSeen.has(tile.key) ? false : (tileSeen.add(tile.key), true)))
      .sort((a, b) => ORDER[a.tone] - ORDER[b.tone]),
    main: unique(parts.flatMap((part) => part.main)),
    side: unique(parts.flatMap((part) => part.side)),
  };
}
