/**
 * The rules of SCORM 2004 that the player in the browser and the platform on
 * the server must both apply, in one place so they cannot drift. Job sheet D8.
 *
 * Checked against the ADL's SCORM 2004 3rd Edition Run-Time Environment
 * (Version 1.0, 16 November 2006) on 1 October 2026, not recalled:
 * 4.2.4 (completion status and its evaluation against a threshold), 4.2.22
 * (success status and its evaluation against a scaled passing score), and the
 * timeinterval format of 4.1.1.
 *
 * Imports nothing, so a client component can use it.
 */

export const COMPLETION_STATUSES = ["completed", "incomplete", "not attempted", "unknown"] as const;
export const SUCCESS_STATUSES = ["passed", "failed", "unknown"] as const;

/**
 * Completion, as the platform must report it (RTE 4.2.4.1).
 *
 * A threshold from the manifest decides whenever the package has reported
 * its progress: complete at or above it, incomplete below. With a threshold
 * and no progress reported, it is unknown. With no threshold, whatever the
 * package said, or unknown if it said nothing.
 */
export function evaluateCompletion(
  stored: string | null,
  progressMeasure: number | null,
  threshold: number | null,
): (typeof COMPLETION_STATUSES)[number] {
  if (threshold !== null) {
    if (progressMeasure === null) return "unknown";
    return progressMeasure >= threshold ? "completed" : "incomplete";
  }
  return (COMPLETION_STATUSES as readonly string[]).includes(stored ?? "")
    ? (stored as (typeof COMPLETION_STATUSES)[number])
    : "unknown";
}

/**
 * Success, as the platform must report it (RTE 4.2.22.1).
 *
 * A scaled passing score from the manifest decides whenever the package has
 * reported a scaled score: passed at or above it, failed below. With a pass
 * mark and no scaled score, it is unknown. With none, whatever the package
 * said, or unknown.
 */
export function evaluateSuccess(
  stored: string | null,
  scoreScaled: number | null,
  passingScore: number | null,
): (typeof SUCCESS_STATUSES)[number] {
  if (passingScore !== null) {
    if (scoreScaled === null) return "unknown";
    return scoreScaled >= passingScore ? "passed" : "failed";
  }
  return (SUCCESS_STATUSES as readonly string[]).includes(stored ?? "")
    ? (stored as (typeof SUCCESS_STATUSES)[number])
    : "unknown";
}

/**
 * The one status the rest of the platform reads, from SCORM 2004's two.
 *
 * Passing or failing says the most, so it comes first. A failed attempt is
 * never "completed" here, even if the learner reached the end: the lesson is
 * not complete until it is passed, the same as SCORM 1.2 with a mastery score.
 */
export function summaryStatus(completion: string, success: string): string {
  if (success === "passed") return "passed";
  if (success === "failed") return "failed";
  if (completion === "completed") return "completed";
  if (completion === "not attempted") return "not attempted";
  return "incomplete";
}

/**
 * A timeinterval: P[yY][mM][dD][T[hH][nM][s[.s]S]], at most two decimals of
 * a second (RTE 4.1.1.7). At least one part after P, and a T only with a time.
 */
export const TIMEINTERVAL =
  /^P(?=\d|T\d)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d{1,2})?)S)?)?$/;

/**
 * Whole seconds in a timeinterval, or 0 for one that does not parse. Years and
 * months have no fixed length; a lesson is not measured in them, so they are
 * counted as 365 and 30 days rather than refused.
 */
export function secondsInInterval(value: string): number {
  const match = TIMEINTERVAL.exec(value.trim());
  if (!match) return 0;
  const [, y, mo, d, h, mi, s] = match.map((part) => Number(part ?? 0));
  return Math.round(((y * 365 + mo * 30 + d) * 24 + h) * 3600 + mi * 60 + s);
}

/** Seconds as a timeinterval, for cmi.total_time: "PT1H5M3S", or "PT0S". */
export function interval(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s || (!h && !m) ? `${s}S` : ""}`;
}
