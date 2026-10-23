import { QualificationsScreen } from "./screen";

/**
 * Full and part qualifications. Skills programmes have their own list and
 * their own way in at /skills-programmes (job sheet D39); the screen is shared.
 */
export default async function QualificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; how?: string }>;
}) {
  return <QualificationsScreen searchParams={searchParams} programme={false} />;
}
