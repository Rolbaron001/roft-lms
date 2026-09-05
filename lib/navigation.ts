import type { Permission } from "./rbac";

/**
 * The catalogue of pages, and how they are arranged by default.
 *
 * Moved out of the shell so that the shell and the settings screen that edits
 * the arrangement read one list. Two lists would drift, and the way they would
 * drift is a page added to the menu that the editor cannot see - so a provider
 * who has customised their menu would silently never receive it.
 *
 * This module imports only the permission type, so a form can use it.
 */
export type NavItem = {
  href: string;
  label: string;
  permission?: Permission;
  /** Shown when the person holds any one of these. */
  anyPermission?: Permission[];
};

/**
 * A heading on the bar, and what sits under it.
 *
 * `label: null` means the items stand as their own links rather than behind a
 * heading - kept for the two places somebody goes many times a day, where a
 * click to open a menu first would be a tax rather than a tidy-up.
 *
 * Order is by how often a section is opened, not by importance: the work
 * somebody does daily sits left of the work they do monthly.
 */
export type NavSection = { label: string | null; items: NavItem[] };

export const NAV: NavSection[] = [
  { label: null, items: [{ href: "/", label: "Home", permission: "report:own" }] },

  {
    label: "Learning",
    items: [
      { href: "/courses", label: "Courses", permission: "course:read" },
      { href: "/paths", label: "Programmes", permission: "course:author" },
      {
        href: "/qualifications",
        label: "Qualifications",
        permission: "qualification:manage",
      },
      { href: "/capture", label: "Capture", permission: "assessment:author" },
      // A reference, not a record. Every signed-in person can read it,
      // learners included - it exists so that everybody uses the same words.
      {
        href: "/records",
        label: "Policies & documents",
        permission: "course:read",
      },
      { href: "/dictionary", label: "Dictionary", permission: "report:own" },
      // Designed alongside the courses they recognise rather than under Admin:
      // a badge is part of how an intervention is set up, not a setting.
      { href: "/badges", label: "Badges", permission: "course:read" },
    ],
  },

  {
    label: "People",
    items: [
      { href: "/people", label: "People", permission: "user:invite" },
      { href: "/cohorts", label: "Cohorts", permission: "enrolment:read_all" },
      { href: "/tracker", label: "Tracker", permission: "enrolment:read_all" },
      // Reached by learners, coaches and staff alike, so it is gated on any
      // one of the three permissions rather than a single role's.
      {
        href: "/workplace",
        label: "Work experience",
        anyPermission: ["workplace:sign", "workplace:manage", "workplace:log"],
      },
      { href: "/conduct", label: "Conduct", permission: "grievance:manage" },
    ],
  },

  {
    label: "Assessment",
    items: [
      { href: "/assess", label: "To assess", permission: "assessment:assess" },
      {
        href: "/moderate",
        label: "To moderate",
        permission: "assessment:moderate",
      },
      // Learners held after a second not-yet-competent result. Work waiting to
      // be done rather than a register to browse.
      {
        href: "/reassessments",
        label: "Held for review",
        permission: "enrolment:read_all",
      },
      { href: "/appeals", label: "Appeals", permission: "appeal:manage" },
      // Recognition of prior learning and credit transfer. Under either
      // permission: the person who records a judgement and the person who
      // moderates it are deliberately different people.
      {
        href: "/recognition",
        label: "Prior learning",
        anyPermission: ["recognition:manage", "assessment:moderate"],
      },
      { href: "/eisa", label: "EISA entry", permission: "enrolment:read_all" },
      {
        href: "/readiness",
        label: "EISA readiness",
        permission: "enrolment:read_all",
      },
    ],
  },

  {
    label: "Reports",
    items: [
      // Every signed-in person holds report:own, but a learner has no
      // dashboard worth a menu entry, so this is gated on team-or-wider
      // reporting.
      {
        href: "/reports",
        label: "Reports",
        anyPermission: ["report:team", "report:tenant"],
      },
      { href: "/statutory", label: "Statutory", permission: "report:statutory" },
    ],
  },

  // Everyone who has been given a platform mailbox. The page itself explains
  // it when somebody has not. Left as its own link: it is opened all day.
  { label: null, items: [{ href: "/mail", label: "Mail", permission: "report:own" }] },

  {
    label: "Admin",
    items: [
      {
        href: "/settings",
        label: "Settings",
        // Reachable by anybody with something on it. An administrator sees the
        // tenant's branding, clock and filenames; everybody else sees their
        // own AI extension and nothing they cannot change.
        anyPermission: ["tenant:manage_branding", "extension:use"],
      },
      {
        href: "/imports",
        label: "AI history",
        permission: "qualification:manage",
      },
      // ROFT's own console, for managing every other client.
      {
        href: "/platform",
        label: "Clients",
        permission: "platform:manage_tenants",
      },
    ],
  },
];


/**
 * A stored arrangement applied to the catalogue.
 *
 * `saved` names headings and the pages under them by href. Anything the
 * platform knows about that the arrangement does not mention is appended under
 * its default heading rather than dropped, which is the whole reason the stored
 * shape is an arrangement rather than a copy: a provider who reorganised the
 * bar in March still receives a page added in July.
 *
 * An href in the arrangement that no longer exists is ignored, so removing a
 * page from the platform does not leave a dead entry in somebody's menu.
 */
export function arrangeNavigation(
  saved: { label: string | null; items: string[] }[] | null,
): NavSection[] {
  if (!saved || saved.length === 0) return NAV;

  const known = new Map<string, NavItem>();
  const defaultHeading = new Map<string, string | null>();
  for (const section of NAV) {
    for (const item of section.items) {
      known.set(item.href, item);
      defaultHeading.set(item.href, section.label);
    }
  }

  const placed = new Set<string>();
  const sections: NavSection[] = saved.map((section) => ({
    label: section.label,
    items: section.items
      .filter((href) => known.has(href) && !placed.has(href))
      .map((href) => {
        placed.add(href);
        return known.get(href)!;
      }),
  }));

  // Whatever the arrangement never mentioned - a page added since it was
  // saved. Appended under the heading it ships with, creating that heading if
  // the provider had removed it.
  for (const [href, item] of known) {
    if (placed.has(href)) continue;

    const heading = defaultHeading.get(href) ?? null;
    const existing = sections.find((section) => section.label === heading);
    if (existing) existing.items.push(item);
    else sections.push({ label: heading, items: [item] });
  }

  return sections.filter((section) => section.items.length > 0);
}

/** Every page in the catalogue, for the editor. */
export function navigationCatalogue(): {
  href: string;
  label: string;
  heading: string | null;
}[] {
  return NAV.flatMap((section) =>
    section.items.map((item) => ({
      href: item.href,
      label: item.label,
      heading: section.label,
    })),
  );
}
