import Link from "next/link";
import { pageLocale, requireSession, requireTenant } from "@/lib/request";
import { myBoards } from "@/lib/discussions";
import { AppShell, Card } from "@/components/app-shell";

/**
 * Every discussion board a person may read: a learner's courses, and the
 * programmes a member of staff is named on (job sheet D30, 14 October 2026).
 */
export default async function DiscussionsPage() {
  const tenant = await requireTenant();
  const session = await requireSession();
  const { t, day } = await pageLocale();
  const boards = await myBoards(session);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t("discuss.boards")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{t("discuss.boardsIntro")}</p>
      </div>
      {boards.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">{t("discuss.noBoards")}</p>
        </Card>
      ) : (
        <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          {boards.map((board) => (
            <li key={board.courseId}>
              <Link href={`/discussions/${board.courseId}`} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 hover:bg-[var(--border)]/20">
                <span className="font-medium">{board.title}</span>
                <span className="text-xs text-[var(--muted)]">
                  {board.threads === 0
                    ? t("discuss.none")
                    : board.threads === 1
                      ? t("discuss.oneThread")
                      : t("discuss.threads", { count: board.threads })}
                  {board.lastPostAt ? ` · ${t("discuss.latest", { date: day(board.lastPostAt, { short: true }) })}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
