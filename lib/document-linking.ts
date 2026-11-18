/**
 * Linking a provider's documents by what they say, when their names do not.
 *
 * Roland, 18 November 2026: "Although we have and encourage naming
 * conventions, clearly they are not uniformly used ... The app must learn from
 * this and make provision for a multitude of possibilities when building ...
 * instead of just concluding and displaying the problems it should first try
 * to solve them itself. All the files and content is already in the folder,
 * they just need to be linked properly." And: "We have to build this
 * especially keeping the prospect of Tenant users in mind."
 *
 * So a paper and its assessor guide are matched, after the file names, by
 * their content: the guide answers the paper's questions under the same
 * headings, whatever either file is called. And a question with no answer
 * under its number is matched to the guide's answer by its title. Each link
 * made this way carries its reason and how sure it is, for the one check a
 * person makes before anything goes live. Pure: text in, links out.
 */

/** Words that say what a document is rather than what it is about. */
const ROLE_WORDS = new Set([
  "assessor", "assessors", "guide", "guides", "memo", "memorandum", "memoranda", "marking", "answer", "answers", "key", "keys",
  "model", "exemplar", "rubric", "rubrics", "guidelines", "learner", "learners", "paper", "copy", "final", "draft", "version",
  "docx", "pdf", "the", "and", "of", "for", "to", "in", "a", "an", "on", "with", "by", "&",
]);

/** The words that carry meaning, lower case, without punctuation or role words. */
export function meaningfulWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/, "")
    .replace(/[_\-–—/\\()[\]{}:;,.!?'"“”‘’*•■]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !ROLE_WORDS.has(word) && !/^v?\d+$/.test(word));
}

/** How much two sets of words share: 0 to 1. */
export function overlap(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/**
 * The headings a paper or guide numbers its questions under, as words:
 * "1.1 Critical Analysis of RPL Intent:", "Question 3: …", "Task A: …",
 * "Activity 2: …". Brackets naming the kind of answer ("(Exemplar Key)") are
 * dropped, so the paper's heading and the guide's read the same.
 */
export function headingsOf(text: string): string[][] {
  const headings: string[][] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\t/g, " ").trim();
    const match =
      /^(?:\d{1,2}(?:\.\d{1,2})+)\s+(.{3,160})$/.exec(line) ??
      /^(?:Question|Task|Activity|Section|Part)\s+[A-Z]?\d*[A-Z]?(?:\.\d+)*\s*[:.\-–]\s*(.{3,160})$/i.exec(line);
    if (!match) continue;
    const words = meaningfulWords(match[1].replace(/\([^)]*\)/g, " "));
    if (words.length >= 2) headings.push(words.slice(0, 10));
  }
  return headings;
}

export type Candidate = { id: string; filename: string; text: string | null };

export type GuideLink = {
  id: string;
  /** 0 to 1. */
  confidence: number;
  because: string;
};

/**
 * The guide for a paper, from all the guides that could be it, by what they
 * say: the share of the paper's headings the guide answers under the same
 * words, and the words the two names share. Chosen only when clearly the best:
 * at least half the evidence and well ahead of the next, so two equally
 * likely guides are left for a person rather than guessed between.
 */
export function bestGuide(paper: { filename: string; text: string | null }, candidates: Candidate[]): GuideLink | null {
  const paperHeadings = paper.text ? headingsOf(paper.text) : [];
  const paperName = meaningfulWords(paper.filename);

  const scored = candidates.map((candidate) => {
    const guideHeadings = candidate.text ? headingsOf(candidate.text) : [];
    const answered = paperHeadings.filter((heading) => guideHeadings.some((other) => overlap(heading, other) >= 0.6)).length;
    const byContent = paperHeadings.length >= 2 ? answered / paperHeadings.length : 0;
    const byName = overlap(paperName, meaningfulWords(candidate.filename));
    // Content outweighs the name: names are what failed in the first place.
    const score = paperHeadings.length >= 2 ? 0.75 * byContent + 0.25 * byName : byName;
    return { candidate, score, answered, byName };
  });
  scored.sort((a, b) => b.score - a.score);
  const [first, second] = scored;
  if (!first || first.score < 0.5) return null;
  if (second && first.score - second.score < 0.15) return null;

  const because =
    first.answered > 0
      ? `It answers ${first.answered} of the paper's ${paperHeadings.length} question headings under the same words.`
      : "Its name matches the paper's.";
  return { id: first.candidate.id, confidence: Math.round(first.score * 100) / 100, because };
}

/**
 * The guide's answer for a question that has none under its number, by its
 * title: the answer whose heading shares most of the question's words, when
 * clearly the best. For guides that number their answers differently from the
 * paper but head them with the same titles.
 */
export function answerByTitle<T extends { title: string }>(questionStem: string, answers: T[]): T | null {
  const words = meaningfulWords(questionStem).slice(0, 12);
  if (words.length < 2) return null;
  const scored = answers
    .map((answer) => ({ answer, score: overlap(words, meaningfulWords(answer.title.replace(/\([^)]*\)/g, " "))) }))
    .sort((a, b) => b.score - a.score);
  const [first, second] = scored;
  if (!first || first.score < 0.6) return null;
  if (second && first.score - second.score < 0.2) return null;
  return first.answer;
}

/**
 * What an unrecognised document is, from its first pages, where its name gave
 * nothing away. Only the kinds the build depends on; anything else stays as it
 * was. A guide says it is one and gives answers; a paper sets questions for a
 * learner to answer.
 */
export function kindFromContent(text: string): "workbook_memorandum" | "summative_memorandum" | "workbook" | "summative_assessment" | null {
  const opening = text.slice(0, 4000);
  const isGuide =
    /\b(memorandum|marking guide|assessor'?s? guide|model answers?|exemplar key|answer key|marking guidelines?)\b/i.test(opening) &&
    !/\binstructions to (?:the )?learners?\b/i.test(opening.slice(0, 1500));
  const isSummative = /\b(summative|final integrated|FISA|EISA)\b/i.test(opening);
  const isWorkbook = /\b(workbook|formative)\b/i.test(opening);
  if (isGuide) return isSummative && !isWorkbook ? "summative_memorandum" : isWorkbook ? "workbook_memorandum" : null;
  const asksQuestions = (opening.match(/^(?:\d{1,2}(?:\.\d{1,2})*[.)]?|Question\s+\d+|Task\s+\w+)\s+\S/gim) ?? []).length >= 2;
  if (!asksQuestions) return null;
  return isSummative ? "summative_assessment" : isWorkbook ? "workbook" : null;
}
