import Link from "next/link";
import type { Translate } from "@/lib/i18n";
import type { AuthenticatedSession } from "@/lib/session";
import { pageDates } from "@/lib/request";
import { recordStepOpened, type StepView } from "@/lib/spine";
import { learnerMaterial, programmeHandbooks, unitOverview, workbooksBegunHere, type LearnerMaterial, type UnitOverview } from "@/lib/learner-unit";
import { HandbookLink } from "@/components/programme-handbooks";
import { listLibrary } from "@/lib/library";
import { describeSize } from "@/lib/media";
import { PageReader } from "@/components/page-reader";
import { YoutubePlayer } from "@/components/youtube-player";
import { StepList } from "./step-list";

/** What a study unit is about, what the learner will learn, and its modules. */
export function UnitIntro({ overview, t, children }: { overview: UnitOverview; t: Translate; children?: React.ReactNode }) {
  return (
    <section className="grid gap-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 md:grid-cols-3">
      <div className="md:col-span-2">
        <h2 className="text-lg font-semibold">{t("learnUnit.about")}</h2>
        {overview.outcome ? <p className="mt-2 leading-relaxed">{overview.outcome}</p> : null}
        {overview.topics.length > 0 ? (
          <>
            <h3 className="mt-4 text-sm font-semibold">{t("learnUnit.learn")}</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
              {overview.topics.map((topic, index) => (
                <li key={index}>{topic}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
      <aside className="rounded-lg bg-[var(--background)] p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{t("learnUnit.modules")}</p>
        <ul className="mt-3 space-y-2 text-sm">
          {overview.modules.map((module) => (
            <li key={module.code}>
              <span className="font-semibold">{module.code}</span> {module.title}
              {module.credits ? <span className="text-[var(--muted)]"> · {t("learnUnit.credits", { credits: module.credits })}</span> : null}
            </li>
          ))}
        </ul>
        {children}
      </aside>
    </section>
  );
}

/**
 * A study unit, as a learner opens it (Roland's design of 5 October 2026):
 * what it is about and what they will learn, the theory guide to read here or
 * download, the videos and diagrams it uses, then its workbooks and
 * assessments. Everything below the introduction reaches the learner as
 * their cohort releases it (lib/spine.ts); before a cohort, the introduction
 * and an outline only.
 */
export async function StudyUnitView({
  session,
  enrolmentId,
  studyUnitId,
  steps,
  isOwn,
  t,
  preview = null,
  chosenDoc = null,
  basePath = "",
}: {
  session: AuthenticatedSession;
  /** The learner's enrolment; empty in an administrator's preview. */
  enrolmentId: string;
  studyUnitId: string;
  steps: StepView[];
  isOwn: boolean;
  t: Translate;
  /** No longer used: dates follow the provider's date style (pageDates). */
  dateLocale?: string;
  /**
   * An administrator looking at the unit as a learner would, with everything
   * unlocked and nothing recorded (Roland, 5 October 2026: "As administrator
   * I want to be able to see that everything is in place for the Learner").
   * Files come through the staff routes; workbooks open in the paper preview.
   */
  preview?: { qualificationId: string; papers: Map<string, string> } | null;
  /** The guide chosen to read (its document id), from `?doc=`; the first otherwise. */
  chosenDoc?: string | null;
  /** Where this page is, so each guide links back to it with `?doc=`. */
  basePath?: string;
}) {
  const overview = await unitOverview(session, studyUnitId);
  if (!overview) return null;
  const material: LearnerMaterial[] = preview
    ? (await listLibrary(session, studyUnitId)).map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        kind: item.kind,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        youtubeId: item.youtubeId,
        open: true,
        waiting: null,
      }))
    : await learnerMaterial(session, studyUnitId, steps);
  const materialHref = (itemId: string) => (preview ? `/api/material/${itemId}` : `/api/learn/${enrolmentId}/material/${itemId}`);
  const pdfViewHref = (itemId: string) => (preview ? `/api/material/${itemId}` : `/learn/${enrolmentId}/material/${itemId}`);

  /*
   * Every guide in the unit, not only the first (23 November 2026): SP-260508's
   * SU2 has eight (slides and practical tools as well as the guide), and seven
   * could not be reached. The chosen one is read below; the others are listed
   * above it. Material another unit shares with this one is among them (D57).
   */
  const guides = steps.filter((step) => step.category === "theory_guide");
  const guide = guides.find((step) => step.targetId === chosenDoc) ?? guides[0] ?? null;
  const work = steps.filter((step) => step.category !== "theory_guide");
  const begunHere = preview || !enrolmentId ? [] : await workbooksBegunHere(session, enrolmentId).catch(() => []);
  const handbooks = await programmeHandbooks(session, overview.qualification.id).catch(() => ({ items: [], open: false }));
  const hasWork = work.length > 0;
  const done = steps.filter((step) => step.state === "done").length;
  const waitingForCohort = !preview && steps.length > 0 && steps.every((step) => step.blockedBy.some((reason) => /placed in a cohort/.test(reason)));
  const nextDue = steps.filter((step) => step.dueAt && step.state !== "done").map((step) => step.dueAt!).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  // Reading the guide is opening it: that is what the first workbook waits for.
  // Never in a preview, which records nothing.
  if (!preview && guide?.open && isOwn && !guide.progress.opened) {
    await recordStepOpened(session, guide.id).catch(() => undefined);
  }

  const documentHref = guide ? (preview ? `/api/programme-documents/${guide.targetId}` : `/api/learn/${enrolmentId}/documents/${guide.targetId}`) : null;
  const downloadHref = documentHref ? (preview ? documentHref : `${documentHref}?download`) : null;
  // Read as its own pages (components/page-reader.tsx): a PDF, or a Word file
  // drawn at its own page size and orientation (Roland, 19 November 2026).
  // A deck reads as its converted PDF; the download stays the deck (D56).
  const asPdf = Boolean(guide?.document?.hasPdf);
  const isPdf = guide?.document?.mimeType === "application/pdf" || asPdf;
  const isWord = !asPdf && Boolean(guide?.document && /wordprocessingml/.test(guide.document.mimeType));
  const readerSrc = documentHref && asPdf ? `${documentHref}?as=pdf` : documentHref;

  return (
    <div className="space-y-6">
      {preview ? (
        <div className="rounded-lg border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 px-4 py-3 text-sm">{t("learnPreview.banner")}</div>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href={preview ? `/qualifications/${preview.qualificationId}/learner` : `/learn/qualification/${overview.qualification.id}`}
            className="text-sm text-[var(--brand-accent)] underline-offset-2 hover:underline"
          >
            {overview.qualification.title}
          </Link>
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            {t("learnUnit.of", { position: overview.unit.position, total: overview.unit.of })}
          </p>
          <h1 className="text-2xl font-bold">{overview.unit.title}</h1>
        </div>
        {steps.length > 0 ? (
          <div className="min-w-56 text-right text-sm text-[var(--muted)]">
            <p>{t("learnUnit.progress", { done, total: steps.length })}</p>
            <div className="mt-1.5 h-2 rounded-full bg-[var(--border)]">
              <div className="h-2 rounded-full bg-[var(--brand-accent)]" style={{ width: `${Math.round((done / steps.length) * 100)}%` }} />
            </div>
            {nextDue ? <p className="mt-1.5">{t("learnUnit.nextDue", { date: (await pageDates()).day(nextDue) })}</p> : null}
          </div>
        ) : null}
      </div>

      {waitingForCohort ? (
        <div className="rounded-lg border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 px-5 py-4">
          <p className="font-medium">{t("learnUnit.waitingTitle")}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{t("learnUnit.waitingBody")}</p>
        </div>
      ) : null}

      {/* The programme's own handbook, filed for every unit at once. */}
      <HandbookLink qualificationId={overview.qualification.id} items={handbooks.items} open={handbooks.open} t={t} />

      <UnitIntro overview={overview} t={t}>
        {guide?.open && downloadHref ? (
          <a href={downloadHref} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[var(--brand-primary)] px-4 text-sm font-medium text-white">
            {t("learnUnit.downloadGuide")}
          </a>
        ) : guide ? (
          <p className="mt-4 rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">{t("learnUnit.guideLater")}</p>
        ) : null}
      </UnitIntro>

      {/* A workbook this unit begins and a later unit hands in (D57). */}
      {begunHere.length > 0 ? (
        <section className="rounded-xl border border-[var(--brand-accent)]/40 bg-[var(--brand-accent)]/5 px-5 py-4">
          <ul className="space-y-1 text-sm">
            {begunHere.map((one) => (
              <li key={one.title}>
                {t("learnUnit.begunHere", { title: one.title, unit: one.unit })}{" "}
                {one.href ? (
                  <Link href={one.href} className="font-medium underline underline-offset-2">
                    {t("learnUnit.openIt")}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Every guide in the unit; the chosen one is read below. */}
      {guides.length > 1 ? (
        <nav aria-label={t("learnUnit.guidesHere")} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
          <h2 className="mb-2 text-sm font-semibold">{t("learnUnit.guidesHere")}</h2>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {guides.map((one) => (
              <li key={one.id}>
                {one.open ? (
                  <Link
                    href={`${basePath}?doc=${one.targetId}#reader`}
                    aria-current={one === guide ? "true" : undefined}
                    className={`underline-offset-2 hover:underline ${one === guide ? "font-semibold" : ""}`}
                  >
                    {one.title}
                  </Link>
                ) : (
                  <span className="text-[var(--muted)]">{one.title}</span>
                )}
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {guide?.open && documentHref && downloadHref ? (
        <section id="reader" className="scroll-mt-24 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <h2 className="px-5 pt-4 text-lg font-semibold">{guides.length > 1 ? guide.title : t("learnUnit.guideTitle")}</h2>
          {isPdf || isWord ? (
            <PageReader src={readerSrc ?? documentHref} downloadHref={downloadHref} kind={isPdf ? "pdf" : "word"} />
          ) : (
            <p className="p-5 text-sm">
              <a href={downloadHref} className="underline underline-offset-2">
                {t("learnUnit.downloadGuide")}
              </a>
            </p>
          )}
        </section>
      ) : null}

      {material.length > 0 ? (
        <section id="material" className="scroll-mt-24">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">{t("learnUnit.material")}</h2>
            <span className="text-sm text-[var(--muted)]">{t("learnUnit.materialHint")}</span>
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {material.map((item) => {
              const href = materialHref(item.id);
              return (
                <article key={item.id} className="flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                  {item.open ? (
                    item.youtubeId ? (
                      <YoutubePlayer id={item.youtubeId} title={item.title} />
                    ) : item.kind === "video" ? (
                      <video controls preload="metadata" src={href} className="aspect-video w-full bg-black" />
                    ) : item.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={href} alt={item.title} className="aspect-video w-full bg-[var(--background)] object-contain" />
                    ) : item.kind === "audio" ? (
                      <div className="flex aspect-video items-center bg-[var(--background)] px-4">
                        <audio controls preload="metadata" src={href} className="w-full" />
                      </div>
                    ) : (
                      <div className="flex aspect-video items-center justify-center bg-[var(--background)] text-sm text-[var(--muted)]">{item.kind}</div>
                    )
                  ) : (
                    <div className="flex aspect-video flex-col items-center justify-center gap-1 bg-[var(--background)] px-4 text-center text-sm text-[var(--muted)]">
                      <span className="font-medium">{t("learnUnit.notYet")}</span>
                      {item.waiting ? <span className="text-xs">{item.waiting}</span> : null}
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-1 p-4">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                      {item.kind} · {item.youtubeId ? "YouTube" : describeSize(item.sizeBytes)}
                    </span>
                    <span className="font-medium">{item.title}</span>
                    {item.description ? <span className="text-sm text-[var(--muted)]">{item.description}</span> : null}
                    {/* A YouTube video plays above; there is no file to download. */}
                    {item.open && !item.youtubeId ? (
                      <div className="mt-2 flex gap-4 text-sm">
                        {/* PDFs and Word documents open in the page reader. */}
                        {item.mimeType === "application/pdf" || /wordprocessingml/.test(item.mimeType ?? "") ? (
                          <Link href={pdfViewHref(item.id)} className="underline underline-offset-2">
                            {t("learnUnit.view")}
                          </Link>
                        ) : item.kind === "image" ? (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                            {t("learnUnit.view")}
                          </a>
                        ) : null}
                        <a href={`${href}?download`} className="underline underline-offset-2">
                          {t("learnUnit.download")}
                        </a>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {hasWork && !preview ? <StepList steps={work} enrolmentId={enrolmentId} isOwn={isOwn} heading={t("learnUnit.work")} /> : null}
      {hasWork && preview ? <PreviewWork steps={work} papers={preview.papers} t={t} /> : null}
    </div>
  );
}

/**
 * The workbooks and assessments as a learner will meet them, each one opening
 * in the paper preview, where nothing can be handed in.
 */
function PreviewWork({ steps, papers, t }: { steps: StepView[]; papers: Map<string, string>; t: Translate }) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{t("learnUnit.work")}</h2>
      <ol className="mt-4 space-y-2">
        {steps.map((step, index) => {
          const paperId = step.kind === "assessment" ? papers.get(step.targetId) : undefined;
          return (
            <li key={step.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-[var(--border)] px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{t(`learn.category.${step.category}`)}</p>
                <p className="text-sm font-medium">
                  <span className="mr-2 text-xs tabular-nums text-[var(--muted)]">{index + 1}</span>
                  {step.title}
                </p>
                {step.guidance ? <p className="mt-1 text-xs text-[var(--muted)]">{step.guidance}</p> : null}
              </div>
              {paperId ? (
                <Link href={`/papers/${paperId}/preview?answers=hide`} className="rounded-md px-3 py-1.5 text-sm font-semibold text-white" style={{ background: "var(--brand-primary)" }}>
                  {t("learnPreview.openPaper")}
                </Link>
              ) : step.kind === "assessment" ? (
                <span className="text-xs text-[var(--danger)]">{t("learnPreview.noPaper")}</span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
