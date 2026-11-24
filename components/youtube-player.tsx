import { youtubeEmbedUrl } from "@/lib/youtube";

/**
 * A YouTube video played in place (D46, 24 November 2026), in YouTube's
 * privacy-enhanced player. The referrer policy is YouTube's own requirement:
 * its player refuses to start without knowing which site it is on.
 */
export function YoutubePlayer({ id, title }: { id: string; title: string }) {
  return (
    <iframe
      src={youtubeEmbedUrl(id)}
      title={title}
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      allowFullScreen
      className="aspect-video w-full border-0 bg-black"
    />
  );
}
