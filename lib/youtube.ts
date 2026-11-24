/**
 * YouTube videos as learning material (job sheet D46, 24 November 2026).
 *
 * The meeting of 29 October agreed that study unit videos stay on the
 * provider's own restricted YouTube channel rather than on the server, so the
 * bandwidth stays free for live classes (Linda). The platform stores the
 * video's identifier only and plays it in place.
 *
 * Imports nothing, so the forms in the browser can use it as well.
 *
 * What YouTube allows, checked against YouTube Help on 24 November 2026:
 * an Unlisted video plays embedded when "Allow embedding" is on; a Private
 * video does not, since only invited, signed-in accounts may watch it; an
 * Unlisted video uploaded before 2017 may have been made Private by YouTube.
 */

/** YouTube's video identifiers: eleven letters, digits, "-" and "_". */
const ID = /^[A-Za-z0-9_-]{11}$/;

const HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
]);

/**
 * The video a YouTube link points at, or null when it is not a link to one
 * video. Accepts the forms YouTube itself hands out: watch?v=, youtu.be/,
 * /embed/, /shorts/, /live/ and /v/.
 */
export function youtubeIdOf(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link.trim().replace(/^(?!https?:\/\/)/i, "https://"));
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  let id: string | null = null;
  if (host === "youtu.be") id = parts[0] ?? null;
  else if (parts[0] === "watch") id = url.searchParams.get("v");
  else if (["embed", "shorts", "live", "v"].includes(parts[0] ?? "")) id = parts[1] ?? null;
  return id && ID.test(id) ? id : null;
}

/**
 * The player's address. youtube-nocookie.com is YouTube's privacy-enhanced
 * mode: no tracking cookies until the learner presses play, which suits
 * POPIA better than the ordinary player. `rel=0` keeps suggested videos to
 * the same channel.
 */
export function youtubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
}

/** The ordinary address, for staff to open the video on YouTube itself. */
export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}
