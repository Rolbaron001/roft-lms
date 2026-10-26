/**
 * A class's transcript, put together from each person's own recording (job
 * sheet D41, phase B). Each voice was transcribed separately, so the lines
 * arrive grouped by speaker; ordered by when they were said, they read as the
 * conversation did.
 *
 * This module imports nothing.
 */

export type Line = { userId: string; startedAt: string; endedAt: string; text: string };

/** In the order the words were said; a tie keeps the order given. */
export function orderTranscript<T extends Line>(lines: T[]): T[] {
  return lines
    .map((line, index) => ({ line, index, at: Date.parse(line.startedAt) }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map((one) => one.line);
}

/**
 * The transcript as plain text, one speaker's turn to a line. Consecutive
 * lines from the same person are joined, which is how somebody reading it
 * would want it and saves the summariser reading the name forty times.
 */
export function transcriptText(lines: { name: string; text: string }[]): string {
  const turns: { name: string; words: string[] }[] = [];
  for (const line of lines) {
    const last = turns.at(-1);
    if (last && last.name === line.name) last.words.push(line.text);
    else turns.push({ name: line.name, words: [line.text] });
  }
  return turns.map((turn) => `${turn.name}: ${turn.words.join(" ")}`).join("\n");
}
