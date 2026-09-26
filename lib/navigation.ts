import type { Capability } from "./features";
import type { Permission } from "./rbac";
import type { TermKey, Vocabulary } from "./terms";

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
  /** The standard word. Used when the provider has not renamed the term. */
  label: string;
  /**
   * The renameable term this item is named after, where it is named after one.
   *
   * Only the plural is used here, because every one of these is a list. An
   * item with no term - Home, Mail, Settings - is not something a provider
   * renames, so it keeps its label.
   */
  term?: TermKey;
  permission?: Permission;
  /** Shown when the person holds any one of these. */
  anyPermission?: Permission[];
  /**
   * A capability the tenant has to have switched on.
   *
   * Separate from permission, because they answer different questions: a
   * permission asks whether this person may, and this asks whether the feature
   * exists here at all. Offline was reachable by URL and in no menu, so on a
   * tenant that had switched it on there was no way for a learner to find the
   * one page the whole feature is for.
   *
   * Offline was the only one of these for a long time and has a column of its
   * own. The five capabilities beside it live in `featureFlags` and are read
   * through lib/features.ts, where a missing flag means on rather than off.
   */
  feature?: Capability | "offline";
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
      { href: "/courses", label: "Courses", term: "course", permission: "course:read" },
      {
        href: "/paths",
        label: "Programmes",
        term: "programme",
        permission: "course:author",
        feature: "programmes",
      },
      /*
        Read by everybody who delivers or judges against it.

        Gated on the permission to *manage* qualifications until 16 September,
        which meant a facilitator, an assessor and a moderator could not reach
        the curriculum they teach and mark against. The screens now show the
        building controls only to somebody who may use them, so the entry can
        be offered to everybody who has a reason to look.
      */
      {
        href: "/qualifications",
        label: "Qualifications",
        feature: "qualifications",
        anyPermission: [
          "qualification:manage",
          "course:author",
          "assessment:assess",
          "assessment:moderate",
        ],
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
      { href: "/cohorts", label: "Cohorts", term: "cohort", permission: "enrolment:read_all" },
      { href: "/tracker", label: "Tracker", permission: "enrolment:read_all" },
      // Reached by learners, coaches and staff alike, so it is gated on any
      // one of the three permissions rather than a single role's.
      {
        href: "/workplace",
        label: "Work experience",
        feature: "workplace_experience",
        anyPermission: ["workplace:sign", "workplace:manage", "workplace:log"],
      },
      { href: "/conduct", label: "Conduct", permission: "grievance:manage" },
      /*
        A learner reaches their own; a coordinator reaches anybody's with
        ?learner=. Gated on the learner's own permission so it appears for
        everybody who has one to fill in, which is the point of it.
      */
      {
        href: "/enrolment-form",
        label: "Enrolment form",
        anyPermission: ["report:own", "enrolment:read_all"],
      },
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
      /*
        Its own entry beside the external one, because they are different
        things: an EISA is set by the Assessment Quality Partner, a FISA is set
        and moderated by the provider itself.
      */
      {
        href: "/fisa",
        label: "FISA",
        anyPermission: [
          "assessment:author",
          "assessment:moderate",
          "assessment:assess",
        ],
      },
      {
        href: "/eisa",
        label: "EISA entry",
        permission: "enrolment:read_all",
        feature: "qualifications",
      },
      {
        href: "/readiness",
        label: "EISA readiness",
        permission: "enrolment:read_all",
        feature: "qualifications",
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
      {
        href: "/statutory",
        label: "Statutory",
        permission: "report:statutory",
        feature: "statutory_reporting",
      },
      /*
        Its own entry rather than a tab inside Statutory: this one has a clock
        on it. A coordinator needs to see that something is overdue without
        first deciding to go and look.
      */
      {
        href: "/statutory/notify",
        label: "Enrolment notification",
        permission: "report:statutory",
        feature: "statutory_reporting",
      },
      /*
        The two reports about the material rather than about the people, and
        the pair most worth finding without being sent: a criterion nothing
        tests holds a readiness figure below 100% however hard a cohort works.
        Reachable only from a link inside Reports until now.
      */
      {
        href: "/reports/programme",
        label: "Programme quality",
        anyPermission: ["report:tenant", "qualification:manage"],
      },
    ],
  },

  // Everyone who has been given a platform mailbox. The page itself explains
  // it when somebody has not. Left as its own link: it is opened all day.
  { label: null, items: [{ href: "/mail", label: "Mail", permission: "report:own" }] },

  /*
    Working without a signal. Only on a tenant that switched it on, and shown
    to everybody there rather than gated on a permission: a learner going into
    the field is the person who needs it most, and they hold the fewest rights.
  */
  {
    label: null,
    items: [
      {
        href: "/offline",
        label: "Offline",
        permission: "report:own",
        feature: "offline",
      },
    ],
  },

  /**
   * Management: what the provider runs, as distinct from what it delivers.
   *
   * Roland, 15 September: a proper place for "things that are done by the
   * administrative staff, assessors, moderators, updating, changing or
   * creating templates that are held inside the system, but exported to
   * clients, learners, other role-players".
   *
   * These were reachable before and several were badly buried - the document
   * templates in particular sat inside Settings behind the branding and the
   * clock, which is not where anybody would look for the layout of a Statement
   * of Results. Gathered here by what they are for rather than by which screen
   * happened to hold them.
   */
  {
    label: "Management",
    items: [
      {
        href: "/templates",
        label: "Templates",
        anyPermission: ["tenant:manage_branding", "tenant:manage_settings"],
      },
      /*
        Who is placed where, under whom, and on which modules.

        Staff work, and it was in no menu at all: the only route to it was
        somebody already being on the work experience screen and noticing the
        link. The coach's own view stays under People, which is where a coach
        goes; this is the setting-up half.
      */
      {
        href: "/workplace/setup",
        label: "Work experience setup",
        permission: "workplace:manage",
      },
      {
        href: "/imports",
        /*
         * Not "AI history". The page was renamed on 19 September because most
         * of what it lists never involved a model - a folder carrying its own
         * blueprint is read by the platform alone, and a folder of material
         * never asks one - and the menu was left saying otherwise. So somebody
         * arriving from the menu was promised AI and shown a list mostly
         * labelled "read by the platform, no AI involved", which is a fair
         * reason to wonder whether you are on the right screen.
         */
        label: "Folders that have been read",
        permission: "qualification:manage",
      },
      /*
        Checking a certificate somebody has been handed.

        The page itself is public and needs no account, because the people who
        most need it - an employer, a SETA, a compliance officer - will never
        have one. It is listed here as well because an administrator asked to
        confirm one of their own should not have to find the printed URL.
      */
      {
        href: "/verify",
        label: "Verify a certificate",
        permission: "enrolment:read_all",
      },
      // Learning records in and out, as xAPI statements (job sheet A10).
      {
        href: "/learning-records",
        label: "Learning records",
        permission: "records:manage",
      },
      {
        href: "/settings",
        // Reachable by anybody with something on it. An administrator sees the
        // tenant's branding, clock and filenames; everybody else sees their
        // own AI extension and nothing they cannot change.
        label: "Settings",
        anyPermission: ["tenant:manage_branding", "extension:use"],
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
 * Headings the platform has renamed, old to new.
 *
 * A stored arrangement names its headings as text, so renaming one in the
 * catalogue strands every provider who had saved the old name: their pages
 * stay under the old heading, and anything added to the new one arrives in a
 * section of its own beside it. That is exactly what happened to Curiosa.
 * "Admin" became "Management" on 15 September; their saved arrangement still
 * said Admin, so every Management page they already had stayed there and only
 * Templates - the one page that was new - landed under Management. A heading
 * with one item renders as a bare link, so what Roland saw was a Templates
 * link on the bar and no Management section at all.
 *
 * Folding the old name into the new one repairs it without touching anybody's
 * stored arrangement, and keeps repairing it for a tenant whose arrangement is
 * restored from an old backup. A provider who had made their own heading
 * called Admin is folded too, which is the cost: the alternative is leaving
 * every provider who used the shipped default with a menu quietly split in
 * two.
 */
const RENAMED_HEADINGS: Record<string, string> = { Admin: "Management" };


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
  /**
   * The provider's own words. Applied to item labels here rather than at each
   * screen, so the bar and the pages cannot disagree about what a thing is
   * called.
   */
  words?: Vocabulary,
): NavSection[] {
  const named = words
    ? NAV.map((section) => ({
        label: section.label,
        items: section.items.map((item) =>
          item.term ? { ...item, label: words.many(item.term) } : item,
        ),
      }))
    : NAV;

  if (!saved || saved.length === 0) return named;

  const known = new Map<string, NavItem>();
  const defaultHeading = new Map<string, string | null>();
  for (const section of named) {
    for (const item of section.items) {
      known.set(item.href, item);
      defaultHeading.set(item.href, section.label);
    }
  }

  const placed = new Set<string>();
  const sections: NavSection[] = [];

  for (const section of saved) {
    // A heading the platform has since renamed keeps its pages rather than
    // being left behind beside the new one.
    const label =
      section.label === null
        ? null
        : (RENAMED_HEADINGS[section.label] ?? section.label);

    const items = section.items
      .filter((href) => known.has(href) && !placed.has(href))
      .map((href) => {
        placed.add(href);
        return known.get(href)!;
      });

    // Two saved headings can now be one - an arrangement that had both Admin
    // and Management, or was saved mid-rename. Merged rather than repeated,
    // because the same heading twice on a bar is worse than either name.
    const existing = sections.find((one) => one.label === label);
    if (existing) existing.items.push(...items);
    else sections.push({ label, items });
  }

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
