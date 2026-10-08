/**
 * The kinds of document a cohort's file stores (job sheet D20). Imports
 * nothing, so the upload form in the browser can use the list.
 */
export const COHORT_FILE_KINDS = [
  "facilitation_plan",
  "induction_pack",
  "attendance_export",
  "assessor_report",
  "programme_feedback",
  "monitoring_report",
  "correspondence",
  "other",
] as const;
export type CohortFileKind = (typeof COHORT_FILE_KINDS)[number];
