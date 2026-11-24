/**
 * Learning from corrections (job sheet D60 stage 5, 24 November 2026).
 *
 * When a person corrects what a file is on "Check the map", the shape of its
 * name is remembered for that provider: "Formative_Assessor_Guide_Part_A"
 * becomes "formative assessor guide part x", so "..._Part_B" and "..._Part_C"
 * of the next programme are filed the same way without being asked. Only
 * what a file is, which carries from one programme to the next; which study
 * unit a file belongs to does not, and is never learned.
 */
import { eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { filingLessons } from "@/db/schema";
import type { IngestionPlan } from "./folder-plan";
import type { AuthenticatedSession } from "./session";

/**
 * The shape of a file name: without its extension, in lower case, with
 * numbers and part letters made general, so one correction covers the set.
 */
export function namePattern(filename: string): string {
  return filename
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\bpart\s+[a-z]\b/g, "part x")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

/** Remembers a correction. A later correction of the same shape replaces it. */
export async function rememberKind(session: AuthenticatedSession, filename: string, kind: string): Promise<void> {
  const pattern = namePattern(filename);
  if (pattern.length < 4 || kind === "other") return;
  await withTenant(session.organisationId, (tx) =>
    tx
      .insert(filingLessons)
      .values({ organisationId: session.organisationId, pattern, kind: kind as never, learnedFrom: filename })
      .onConflictDoUpdate({ target: [filingLessons.organisationId, filingLessons.pattern], set: { kind: kind as never, learnedFrom: filename, createdAt: sql`now()` } }),
  );
}

/** This provider's lessons, by pattern. */
export async function lessonsOf(session: AuthenticatedSession): Promise<Map<string, { kind: string; learnedFrom: string }>> {
  const rows = await withTenant(session.organisationId, (tx) =>
    tx.select({ pattern: filingLessons.pattern, kind: filingLessons.kind, learnedFrom: filingLessons.learnedFrom }).from(filingLessons).where(eq(filingLessons.organisationId, session.organisationId)),
  );
  return new Map(rows.map((row) => [row.pattern, { kind: row.kind, learnedFrom: row.learnedFrom }]));
}

/** Applies the lessons to a plan just read; returns how many files they settled. */
export function applyLessons(plan: IngestionPlan, lessons: Map<string, { kind: string; learnedFrom: string }>): number {
  let applied = 0;
  for (const document of plan.documents) {
    if (document.target === "library") continue;
    const lesson = lessons.get(namePattern(document.filename));
    if (!lesson || lesson.kind === document.kind) continue;
    document.kind = lesson.kind;
    document.because = `Filed as ${lesson.kind.replace(/_/g, " ")}, as you corrected "${lesson.learnedFrom}" before.`;
    applied += 1;
  }
  return applied;
}
