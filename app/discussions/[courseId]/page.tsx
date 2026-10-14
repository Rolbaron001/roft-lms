import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { pageLocale, requireSession, requireTenant } from "@/lib/request";
import { DiscussionError, getBoard } from "@/lib/discussions";
import { AppShell, Card } from "@/components/app-shell";
import { StartThreadForm } from "../forms";

/** One course's discussion board: its discussions, pinned first, then the liveliest. */
export default async function BoardPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();
  const { t, day } = await pageLocale();

  let board;
  try {
    board = await getBoard(session, courseId);
  } catch (error) {
    if (error instanceof DiscussionError) {
      if (error.code === "not_permitted") redirect("/not-permitted");
      notFound();
    }
    throw error;
  }

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link href="/discussions" className="text-sm text-[var(--muted)] hover:underline">
          {t("discuss.allBoards")}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{board.courseTitle}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          {board.access.moderate ? t("discuss.boardIntroStaff") : t("discuss.boardIntro")}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div>
          {board.threads.length === 0 ? (
            <Card>
              <p className="text-sm text-[var(--muted)]">{t("discuss.empty")}</p>
            </Card>
          ) : (
            <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              {board.threads.map((thread) => (
                <li key={thread.id} className={thread.hidden ? "opacity-60" : ""}>
                  <Link href={`/discussions/thread/${thread.id}`} className="block px-4 py-3 hover:bg-[var(--border)]/20">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">
                        {thread.pinned ? <span className="mr-2 text-xs font-semibold uppercase text-[var(--brand-accent)]">{t("discuss.pinned")}</span> : null}
                        {thread.title}
                      </span>
                      <span className="text-xs text-[var(--muted)]">{day(thread.lastPostAt, { short: true })}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {thread.authorName}
                      {thread.authorIsStaff ? ` (${t("discuss.staff")})` : ""}
                      {" · "}
                      {thread.replies === 1 ? t("discuss.oneReply") : t("discuss.replies", { count: thread.replies })}
                      {thread.locked ? ` · ${t("discuss.closed")}` : ""}
                      {thread.hidden ? ` · ${t("discuss.removed")}` : ""}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {board.access.post ? (
          <Card title={t("discuss.new")} description={board.access.moderate ? t("discuss.newStaff") : undefined}>
            <StartThreadForm courseId={courseId} />
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
