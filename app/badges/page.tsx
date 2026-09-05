import { requirePermission, requireTenant } from "@/lib/request";
import { definedBadges, defaultBadge } from "@/lib/badges";
import { listCourses, listQualifications } from "@/lib/authoring";
import { listLearningPaths } from "@/lib/learning-paths";
import { AppShell, Card } from "@/components/app-shell";
import { BadgeMedal } from "@/components/badge-medal";
import { BADGE_KIND_LABEL, type BadgeShape } from "@/lib/badge-shapes";
import { BadgeDesigner, type BadgeTarget } from "./badge-designer";
import { RetireBadge } from "./retire";

/**
 * Badges: what has been designed, and the designer.
 *
 * Its own screen rather than a tab inside each course, because the value of a
 * badge scheme is in seeing it whole. Designed one course at a time, a provider
 * ends up with six badges in six different colours and no idea that is what
 * happened.
 *
 * Assigning one to an intervention happens here too, by choosing what earns it
 * - which is the same act as designing it. A separate "assign" step on each
 * course page would be a second place to look and a second place to forget.
 */
export default async function BadgesPage() {
  const tenant = await requireTenant();
  const session = await requirePermission("course:read");

  const canAuthor = session.permissions.includes("course:author");

  const [defined, fallback, courses, paths, qualifications] = await Promise.all([
    definedBadges(session),
    defaultBadge(session),
    canAuthor ? listCourses(session) : Promise.resolve([]),
    canAuthor ? listLearningPaths(session) : Promise.resolve([]),
    canAuthor ? listQualifications(session) : Promise.resolve([]),
  ]);

  // Only what has no badge yet. Offering something already spoken for would
  // produce a refusal from the unique index that reads like a bug.
  const spoken = new Set(
    defined
      .filter((badge) => badge.active)
      .map((badge) =>
        badge.courseTitle
          ? `course:${badge.courseTitle}`
          : badge.pathTitle
            ? `path:${badge.pathTitle}`
            : badge.qualificationTitle
              ? `qualification:${badge.qualificationTitle}`
              : "",
      ),
  );

  const targets: BadgeTarget[] = [
    ...(fallback
      ? []
      : [
          {
            value: "default",
            label: "Anything, when nothing more specific is set",
            group: "The provider's own badge",
          },
        ]),
    ...qualifications
      .filter((row) => !spoken.has(`qualification:${row.title}`))
      .map((row) => ({
        value: `qualification:${row.id}`,
        label: row.title,
        group: "Qualifications",
      })),
    ...paths
      .filter((row) => !spoken.has(`path:${row.title}`))
      .map((row) => ({
        value: `learning_path:${row.id}`,
        label: row.title,
        group: "Programmes",
      })),
    ...courses
      .filter((row) => !spoken.has(`course:${row.title}`))
      .map((row) => ({
        value: `course:${row.id}`,
        label: row.title,
        group: "Courses",
      })),
  ];

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Badges</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Recognition that arrives on the day the work is finished, rather than
          months later when the external certificate comes through. A badge is
          not a qualification and the platform never lets it look like one: no
          SAQA identifier, no credits, and a verification page that says plainly
          what it is and what it is not.
        </p>
      </div>

      {!fallback && defined.filter((row) => row.active).length === 0 ? (
        <div className="mb-6">
          <Card
            title="Nothing is earned yet"
            description="No badge has been designed, so finishing a course or a qualification currently awards nothing. Designing one below is enough — start with the provider's own badge if you do not want a different one for each thing."
          >
            <p className="text-sm text-[var(--muted)]">
              This is a legitimate choice rather than a fault. The platform will
              not invent one.
            </p>
          </Card>
        </div>
      ) : null}

      {defined.length > 0 ? (
        <div className="mb-6">
          <Card title="Designed">
            <ul className="space-y-3">
              {defined.map((badge) => (
                <li
                  key={badge.id}
                  className="flex flex-wrap items-center gap-4 rounded-md border border-[var(--border)] px-4 py-3"
                >
                  <BadgeMedal
                    glyph={badge.glyph}
                    shape={badge.shape as BadgeShape}
                    background={badge.background}
                    ink={badge.ink}
                    size={44}
                    title={badge.name}
                  />
                  <div className="min-w-[12rem] flex-1">
                    <p className="text-sm font-medium">
                      {badge.name}
                      {!badge.active ? (
                        <span className="ml-2 text-xs font-normal text-[var(--muted)]">
                          retired
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {badge.qualificationTitle ??
                        badge.pathTitle ??
                        badge.courseTitle ??
                        (badge.moduleTitle
                          ? `${badge.moduleCode ?? ""} ${badge.moduleTitle}`.trim()
                          : BADGE_KIND_LABEL[badge.kind] ?? badge.kind)}
                    </p>
                  </div>
                  <span className="text-xs text-[var(--muted)]">
                    {badge.held === 1
                      ? "1 learner"
                      : `${badge.held} learners`}
                  </span>
                  {canAuthor && badge.active ? (
                    <RetireBadge badgeId={badge.id} name={badge.name} />
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {canAuthor ? (
        <Card
          title="Design a badge"
          description="A shape, two colours and a symbol. Nothing to upload and nobody to brief."
        >
          {targets.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              Everything already has a badge. Retire one to design a different
              badge for the same thing.
            </p>
          ) : (
            <BadgeDesigner targets={targets} />
          )}
        </Card>
      ) : null}
    </AppShell>
  );
}
