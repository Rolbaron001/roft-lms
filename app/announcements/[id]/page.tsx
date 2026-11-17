import Link from "next/link";
import { notFound } from "next/navigation";
import { pageLocale, requireSession, requireTenant } from "@/lib/request";
import { getAnnouncement } from "@/lib/announcements";
import { AppShell, Card } from "@/components/app-shell";

/**
 * One announcement to a cohort, where its notification leads (job sheet D52
 * (1)). Its learners and its staff may read it; anybody else is shown nothing.
 */
export default async function AnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();
  const { t, day } = await pageLocale();
  const announcement = await getAnnouncement(session, id);
  if (!announcement) notFound();
  const staff = session.permissions.includes("enrolment:read_all");

  return (
    <AppShell tenant={tenant} session={session}>
      <p className="mb-4 text-sm">
        <Link href={staff ? `/cohorts/${announcement.cohortId}#announcements` : "/"} className="text-[var(--muted)] hover:underline">
          ← {staff ? announcement.cohortName : t("announce.home")}
        </Link>
      </p>
      <Card title={announcement.subject} description={`${announcement.cohortName} · ${day(announcement.postedAt)}${announcement.author ? ` · ${announcement.author}` : ""}`}>
        <p className="max-w-2xl whitespace-pre-line text-sm">{announcement.body}</p>
      </Card>
    </AppShell>
  );
}
