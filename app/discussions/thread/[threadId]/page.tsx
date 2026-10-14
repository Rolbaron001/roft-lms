import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { pageLocale, requireSession, requireTenant } from "@/lib/request";
import { DiscussionError, getThread } from "@/lib/discussions";
import { AppShell } from "@/components/app-shell";
import { ReplyForm } from "../../forms";
import { removePostAction, threadFlagsAction } from "../../actions";

/** One discussion: its posts in order, a reply box, and a facilitator's controls. */
export default async function ThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const tenant = await requireTenant();
  const session = await requireSession();
  const { t, when } = await pageLocale();

  let thread;
  try {
    thread = await getThread(session, threadId);
  } catch (error) {
    if (error instanceof DiscussionError) {
      if (error.code === "not_permitted") redirect("/not-permitted");
      notFound();
    }
    throw error;
  }

  const canReply = thread.access.post && !thread.hidden && (!thread.locked || thread.access.moderate);

  return (
    <AppShell tenant={tenant} session={session}>
      <div className="mb-6">
        <Link href={`/discussions/${thread.courseId}`} className="text-sm text-[var(--muted)] hover:underline">
          ← {thread.courseTitle}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{thread.title}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {[thread.pinned ? t("discuss.pinned") : null, thread.locked ? t("discuss.closedLong") : null, thread.hidden ? t("discuss.removedLong") : null]
            .filter(Boolean)
            .join(" · ")}
        </p>

        {thread.access.moderate ? (
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <form action={threadFlagsAction}>
              <input type="hidden" name="threadId" value={thread.id} />
              <input type="hidden" name="flag" value="pinned" />
              <input type="hidden" name="on" value={String(!thread.pinned)} />
              <button type="submit" className="rounded-md border border-[var(--border)] px-3 py-1.5">
                {thread.pinned ? t("discuss.unpin") : t("discuss.pin")}
              </button>
            </form>
            <form action={threadFlagsAction}>
              <input type="hidden" name="threadId" value={thread.id} />
              <input type="hidden" name="flag" value="locked" />
              <input type="hidden" name="on" value={String(!thread.locked)} />
              <button type="submit" className="rounded-md border border-[var(--border)] px-3 py-1.5">
                {thread.locked ? t("discuss.reopen") : t("discuss.close")}
              </button>
            </form>
          </div>
        ) : null}
      </div>

      <ol className="space-y-4">
        {thread.posts.map((post) => (
          <li
            key={post.id}
            id={`post-${post.id}`}
            className={`scroll-mt-24 rounded-lg border bg-[var(--surface)] p-4 ${
              post.authorIsStaff ? "border-[var(--brand-accent)]/40" : "border-[var(--border)]"
            } ${post.hidden ? "opacity-60" : ""}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">
                {post.authorName}
                {post.authorIsStaff ? (
                  <span className="ml-2 text-xs font-normal text-[var(--brand-accent)]">{t("discuss.staff")}</span>
                ) : null}
              </span>
              <span className="text-xs text-[var(--muted)]">{when(post.createdAt)}</span>
            </div>
            {post.body === null ? (
              <p className="mt-2 text-sm italic text-[var(--muted)]">{t("discuss.postRemoved")}</p>
            ) : (
              <>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{post.body}</p>
                {post.hidden ? <p className="mt-1 text-xs italic text-[var(--muted)]">{t("discuss.removedStaffSee")}</p> : null}
              </>
            )}
            {!post.hidden && (post.mine || thread.access.moderate) ? (
              <form action={removePostAction} className="mt-2">
                <input type="hidden" name="postId" value={post.id} />
                <button type="submit" className="text-xs text-[var(--danger)] underline underline-offset-2">
                  {t("discuss.remove")}
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ol>

      <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
        {canReply ? (
          <ReplyForm threadId={thread.id} />
        ) : (
          <p className="text-sm text-[var(--muted)]">{thread.hidden ? t("discuss.removedLong") : t("discuss.closedLong")}</p>
        )}
      </section>
    </AppShell>
  );
}
