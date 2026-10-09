import { pageLocale, requirePermission, requireTenant } from "@/lib/request";
import { maybe } from "@/lib/i18n";
import { vocabulary } from "@/lib/terms";
import { definedBadges, defaultBadge, learnerBadges } from "@/lib/badges";
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
  const { t, locale, day } = await pageLocale();
  const words = vocabulary(tenant.terminology, tenant.featureFlags, locale);

  const canAuthor = session.permissions.includes("course:author");

  // A learner's own page: what they have earned and what they can earn,
  // written for them (job sheet D21, Heidi, 8 October 2026: the designer's
  // page "is not right for a learner to see").
  if (!canAuthor && !session.permissions.includes("enrolment:read_all")) {
    const [earned, all] = await Promise.all([learnerBadges(session, session.userId), definedBadges(session)]);
    const available = all.filter((badge) => badge.active && !earned.some((held) => held.name === badge.name));
    return (
      <AppShell tenant={tenant} session={session}>
        <div className="mb-6">
          <h1 className="text-xl font-semibold">{t("badges.mine.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("badges.mine.intro")}</p>
        </div>
        <div className="space-y-6">
          <Card title={t("badges.mine.earned")}>
            {earned.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">{t("badges.mine.none")}</p>
            ) : (
              <ul className="flex flex-wrap gap-3">
                {earned.map((badge) => (
                  <li key={badge.id} className="rounded-lg border border-[var(--border)] px-4 py-3">
                    <p className="text-sm font-medium">
                      <span className="mr-2" aria-hidden>{badge.glyph}</span>
                      {badge.name}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{day(badge.earnedOn)} · {badge.reference}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {available.length > 0 ? (
            <Card title={t("badges.mine.toEarn")}>
              <ul className="space-y-3">
                {available.map((badge) => (
                  <li key={badge.id} className="flex items-center gap-4">
                    <BadgeMedal glyph={badge.glyph} shape={badge.shape as BadgeShape} background={badge.background} ink={badge.ink} size={40} title={badge.name} />
                    <div>
                      <p className="text-sm font-medium">{badge.name}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {badge.qualificationTitle ?? badge.pathTitle ?? badge.courseTitle ??
                          (badge.moduleTitle ? `${badge.moduleCode ?? ""} ${badge.moduleTitle}`.trim() : t("badges.mine.anything"))}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </AppShell>
    );
  }

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
            label: t("badges.target.default"),
            group: t("badges.group.provider"),
          },
        ]),
    ...qualifications
      .filter((row) => !spoken.has(`qualification:${row.title}`))
      .map((row) => ({
        value: `qualification:${row.id}`,
        label: row.title,
        group: t("badges.group.qualifications"),
      })),
    ...paths
      .filter((row) => !spoken.has(`path:${row.title}`))
      .map((row) => ({
        value: `learning_path:${row.id}`,
        label: row.title,
        group: words.many("programme"),
      })),
    ...courses
      .filter((row) => !spoken.has(`course:${row.title}`))
      .map((row) => ({
        value: `course:${row.id}`,
        label: row.title,
        group: words.many("course"),
      })),
  ];

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("badges.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("badges.intro")}</p>
      </div>

      {!fallback && defined.filter((row) => row.active).length === 0 ? (
        <div className="mb-6">
          <Card title={t("badges.nothing")} description={t("badges.nothingNote")}>
            <p className="text-sm text-[var(--muted)]">{t("badges.legitimate")}</p>
          </Card>
        </div>
      ) : null}

      {defined.length > 0 ? (
        <div className="mb-6">
          <Card title={t("badges.designed")}>
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
                          {t("badges.retired")}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {badge.qualificationTitle ??
                        badge.pathTitle ??
                        badge.courseTitle ??
                        (badge.moduleTitle
                          ? `${badge.moduleCode ?? ""} ${badge.moduleTitle}`.trim()
                          : (maybe(t, `badges.kind.${badge.kind}`) ?? BADGE_KIND_LABEL[badge.kind] ?? badge.kind))}
                    </p>
                  </div>
                  <span className="text-xs text-[var(--muted)]">
                    {badge.held === 1 ? t("badges.heldOne") : t("badges.held", { count: badge.held })}
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
        <Card title={t("badges.design")} description={t("badges.designNote")}>
          {targets.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t("badges.allHave")}</p>
          ) : (
            <BadgeDesigner targets={targets} />
          )}
        </Card>
      ) : null}
    </AppShell>
  );
}
