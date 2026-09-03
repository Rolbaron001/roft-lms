import { z } from "zod";
import { extensionState, readJson, runExtension } from "./extensions";
import type { ParsedItem, ParsedPaper, ParsedSection } from "./capture-parse";
import type { AuthenticatedSession } from "./session";

/**
 * A second attempt at a paper the rule parser could not read.
 *
 * The parser in `capture-parse` handles the papers the client actually writes,
 * because they are written to a house style and the style is what it keys off.
 * It is fast, deterministic, and the first thing to try - and where it works
 * there is no reason to involve a model at all.
 *
 * What it cannot do is read a paper written to somebody else's convention: an
 * assessment inherited from another provider, or one typed without the
 * headings the parser looks for. Today that comes back with no questions and a
 * list of complaints, and the author retypes the whole thing.
 *
 * So this runs only when the parser found nothing, and only where an extension
 * is available. It never overrides a question the parser read: a rule that
 * matched is better evidence than a model's reading of the same line, and
 * mixing the two would make it impossible to say afterwards which produced
 * what.
 *
 * Everything it produces is marked as model-derived and lands in the same
 * proposal a person checks before anything is committed. Nothing here is ever
 * marked as marked by the platform - every question it proposes goes to an
 * assessor, whatever it thinks the answer is. A model deciding that a question
 * has one unambiguous right answer, and being wrong, produces confidently
 * wrong marking discovered at an appeal.
 */

/** Below this the parser has effectively failed rather than partly worked. */
export const ASSIST_THRESHOLD = 1;

const SYSTEM = `You are reading an assessment paper for a South African occupational
qualification. Reply with JSON only - no prose, no code fence.

{"sections":[{"title":"<section heading>","instruction":"<any instruction to the candidate, or null>","items":[{"number":"<as printed, e.g. 1.2>","type":"multiple_choice"|"true_false"|"long_answer"|"short_answer","stem":"<the question as asked>","options":["<for multiple choice, in order>"],"points":<marks, or null>}]}],"notes":["<anything you could not determine>"]}

Report the questions as printed. Do not invent a question, a mark allocation or
an option that is not in the document, and do not correct one that looks wrong -
put anything that looks wrong into "notes" instead. Somebody is assessed against
this.

Do not say which option is correct. That comes from the memorandum, not from
you.`;

const responseSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().max(300).default("Section"),
        instruction: z.string().max(2000).nullable().default(null),
        items: z
          .array(
            z.object({
              number: z.string().max(20),
              type: z
                .enum([
                  "multiple_choice",
                  "true_false",
                  "long_answer",
                  "short_answer",
                ])
                .default("short_answer"),
              stem: z.string().min(1).max(5000),
              options: z.array(z.string().max(1000)).default([]),
              points: z.number().nullable().default(null),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  notes: z.array(z.string().max(500)).default([]),
});

/** How many questions the parser managed to read. */
export function questionCount(paper: ParsedPaper): number {
  return paper.sections.reduce(
    (total, section) => total + section.items.length,
    0,
  );
}

/**
 * Whether asking a model is worth doing at all.
 *
 * Only when the parser read fewer questions than a paper could possibly have.
 * A paper it read twenty questions out of is a paper it understood; sending
 * that to a model would replace a deterministic reading with a probabilistic
 * one for nothing.
 */
export function shouldAssist(paper: ParsedPaper): boolean {
  return questionCount(paper) <= ASSIST_THRESHOLD;
}

export type AssistOutcome = {
  paper: ParsedPaper;
  /** Whether a model was used, and what came of it. */
  assisted: boolean;
  note: string | null;
};

/**
 * Reads a paper the parser could not, where an extension allows it.
 *
 * Returns the paper unchanged whenever it cannot help, rather than throwing:
 * the caller has a perfectly good proposal with complaints in it, and a failed
 * second attempt should not take the first one away.
 */
export async function assistCapture(
  session: AuthenticatedSession,
  paper: ParsedPaper,
  paperText: string,
): Promise<AssistOutcome> {
  if (!shouldAssist(paper)) {
    return { paper, assisted: false, note: null };
  }

  const state = await extensionState(session);
  if (!state.on || !(state.availability?.available ?? false)) {
    return {
      paper: withProblem(
        paper,
        state.on
          ? "The usual reading found no questions in this paper, and the AI extension that would try a second reading cannot run on this machine."
          : "The usual reading found no questions in this paper. An AI extension would try a second reading of it; without one, the questions have to be added by hand.",
      ),
      assisted: false,
      note: null,
    };
  }

  const result = await runExtension(session, {
    task: "read_assessment_paper",
    system: SYSTEM,
    // Bounded, because a paper longer than this is a document somebody has
    // pasted a policy into, and the tail of it is not questions.
    prompt: paperText.slice(0, 120_000),
    timeoutMs: 600_000,
  });

  if (!result.ok) {
    return {
      paper: withProblem(
        paper,
        `The AI extension was asked to read this paper and could not: ${result.error ?? "no answer."}`,
      ),
      assisted: false,
      note: null,
    };
  }

  const parsed = responseSchema.safeParse(readJson(result.text ?? ""));
  if (!parsed.success || parsed.data.sections.length === 0) {
    return {
      paper: withProblem(
        paper,
        "The AI extension read this paper but did not produce anything usable. The questions have to be added by hand.",
      ),
      assisted: false,
      note: null,
    };
  }

  const sections: ParsedSection[] = parsed.data.sections.map((section) => ({
    title: section.title,
    instruction: section.instruction,
    markTotal: null,
    items: section.items.map(
      (item): ParsedItem => ({
        number: item.number,
        type: item.type,
        stem: item.stem,
        options: item.options,
        // The memorandum says which option is right. A model's opinion about
        // that is not evidence, and asking for it would invite one.
        correctIndex: null,
        points: item.points,
        criterionCodes: [],
        markingGuide: null,
        // Every question, without exception, goes to an assessor. A model
        // deciding a question has one unambiguous right answer and being wrong
        // produces confidently wrong marking, found at an appeal.
        markedBy: "assessor",
      }),
    ),
  }));

  const count = sections.reduce(
    (total, section) => total + section.items.length,
    0,
  );

  return {
    assisted: true,
    note: `Read by the AI extension: the usual reading found no questions in this paper. ${count} ${count === 1 ? "question was" : "questions were"} proposed and every one is set to be marked by an assessor. Check them against the paper before committing.`,
    paper: {
      ...paper,
      sections,
      problems: [
        ...paper.problems,
        ...parsed.data.notes.map((note) => `From the AI extension: ${note}`),
      ],
    },
  };
}

function withProblem(paper: ParsedPaper, problem: string): ParsedPaper {
  return { ...paper, problems: [...paper.problems, problem] };
}
