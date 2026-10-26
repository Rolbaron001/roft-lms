/**
 * The transcriber on the media server (job sheet D41, phase B): our own small
 * service, in media/transcriber/, that turns each person's recorded voice into
 * text with Whisper. Voices never leave the provider's servers.
 *
 *   TRANSCRIBER_URL     where this server reaches it, e.g. http://media:8790
 *   TRANSCRIBER_SECRET  shared with it; it refuses anybody without it, and
 *                       signs its replies with it
 *   TRANSCRIBER_CALLBACK_URL  optional: where it answers, if not the site's
 *                       own address followed by /api/classroom/transcript
 *
 * It is asked once per class, when the class has ended and every recording in
 * it has closed, and it answers at /api/classroom/transcript when done.
 */

export function transcriberConfigured(): boolean {
  return Boolean(process.env.TRANSCRIBER_URL && process.env.TRANSCRIBER_SECRET);
}

function endpoint(path: string): string {
  return `${(process.env.TRANSCRIBER_URL ?? "").replace(/\/+$/, "")}${path}`;
}

function headers(): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TRANSCRIBER_SECRET ?? ""}` };
}

export type TranscriptionFile = { path: string; speaker: string; startedAt: string };

/** Asks for a class to be transcribed. The answer comes back later, to `callback`. */
export async function requestTranscription(job: string, files: TranscriptionFile[], callback: string): Promise<void> {
  const response = await fetch(endpoint("/jobs"), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ job, files, callback }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`The transcriber refused the class: ${response.status} ${await response.text().catch(() => "")}`.trim());
}

/** Deletes a class's voice files from the media server. */
export async function deleteVoices(job: string, paths: string[]): Promise<void> {
  const response = await fetch(endpoint(`/jobs/${encodeURIComponent(job)}/audio`), {
    method: "DELETE",
    headers: headers(),
    body: JSON.stringify({ paths }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`The voice files could not be deleted: ${response.status}`);
}
