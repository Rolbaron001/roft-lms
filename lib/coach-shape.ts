/**
 * The shape of a coach's readiness feedback (job sheet D52 (9)). Imports
 * nothing, so the browser form can use it without pulling in the database.
 */
export const READINESS_DIMENSIONS = ["punctuality", "communication", "teamwork", "safety", "applies_skills", "initiative"] as const;
export type ReadinessDimension = (typeof READINESS_DIMENSIONS)[number];
export const RECOMMENDATIONS = ["ready", "nearly_ready", "not_yet"] as const;
