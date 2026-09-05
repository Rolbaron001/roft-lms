import { SHAPE_PATHS, type BadgeShape } from "@/lib/badge-shapes";

/**
 * A badge, drawn.
 *
 * SVG rather than an uploaded image, and that is the design decision the whole
 * feature rests on. An image store would mean a provider needs somebody who can
 * make a PNG before they can have a badge at all, and this client has no
 * designer - so the badges would simply never get made. A shape, two colours
 * and a glyph is a minute's work, renders identically at any size, prints
 * cleanly, costs no storage, and cannot arrive as a 4 MB photograph.
 *
 * Deliberately not a server component doing database work: it takes what it
 * draws, so the same component renders a real badge, a list row and the live
 * preview in the designer without three code paths that can disagree.
 */
export function BadgeMedal({
  glyph,
  shape = "circle",
  background,
  ink,
  size = 64,
  title,
}: {
  glyph: string;
  shape?: BadgeShape;
  /** Falls back to the tenant's brand, so an undesigned badge still belongs. */
  background?: string | null;
  ink?: string | null;
  size?: number;
  title?: string;
}) {
  const fill = background || "var(--brand-primary)";
  const text = ink || "var(--brand-accent)";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className="shrink-0"
    >
      <path d={SHAPE_PATHS[shape]} fill={fill} />
      {/* A ring inside the edge, which is what makes a flat shape read as a
          medal rather than a coloured blob. */}
      <path
        d={SHAPE_PATHS[shape]}
        fill="none"
        stroke={text}
        strokeWidth="2"
        opacity="0.45"
        transform="translate(50 50) scale(0.86) translate(-50 -50)"
      />
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        // Sized against the viewBox rather than the rendered size, so one
        // number works at 24px in a list and 96px in the designer.
        fontSize="38"
        fill={text}
      >
        {glyph}
      </text>
    </svg>
  );
}
