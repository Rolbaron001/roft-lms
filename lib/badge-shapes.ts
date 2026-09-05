/**
 * The badge shapes, as plain path data.
 *
 * Its own module because a form needs it and `lib/badges.ts` reaches into the
 * database - importing that from a client component drags the Postgres driver
 * into the browser bundle and fails the build. Same reason
 * `lib/curriculum-shape.ts` exists.
 *
 * This file imports nothing.
 */

export const BADGE_SHAPES = ["circle", "shield", "hexagon", "rosette"] as const;
export type BadgeShape = (typeof BADGE_SHAPES)[number];

export const SHAPE_LABEL: Record<BadgeShape, string> = {
  circle: "Circle",
  shield: "Shield",
  hexagon: "Hexagon",
  rosette: "Rosette",
};

/** Drawn on a 100×100 viewBox, centred on (50, 50). */
export const SHAPE_PATHS: Record<BadgeShape, string> = {
  circle: "M50 4a46 46 0 1 0 0 92a46 46 0 1 0 0-92z",
  shield: "M50 4 L92 18 V52 C92 76 72 90 50 96 C28 90 8 76 8 52 V18 Z",
  hexagon: "M50 4 L91 27 V73 L50 96 L9 73 V27 Z",
  // Twelve points around the circle, alternating radius.
  rosette: rosette(12, 46, 37),
};

function rosette(points: number, outer: number, inner: number): string {
  const steps: string[] = [];
  for (let index = 0; index < points * 2; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = (Math.PI * index) / points - Math.PI / 2;
    const x = 50 + radius * Math.cos(angle);
    const y = 50 + radius * Math.sin(angle);
    steps.push(`${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `${steps.join(" ")} Z`;
}

/** What earns a badge, in words, for a form and a list. */
export const BADGE_KIND_LABEL: Record<string, string> = {
  default: "Anything, when nothing more specific is set",
  qualification: "A whole qualification",
  learning_path: "A programme",
  course: "A course",
  curriculum_module: "One curriculum module",
};
