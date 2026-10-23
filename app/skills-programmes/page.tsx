import { QualificationsScreen } from "@/app/qualifications/screen";

/**
 * Occupational skills programmes: their own list, and their own way in from
 * their two documents (job sheet D39, 23 October 2026). Each one opens on the
 * qualification pages, where it is built and delivered as a qualification is.
 */
export default async function SkillsProgrammesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; how?: string }>;
}) {
  return <QualificationsScreen searchParams={searchParams} programme />;
}
