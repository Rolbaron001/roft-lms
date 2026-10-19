import { sql } from "drizzle-orm";
import { assessments } from "@/db/schema";

/**
 * Where an assessment sits in its course's steps, for listing assessments in
 * the order a learner meets them. By title alone, a summative ("SA1") came
 * before the workbooks ("WB1") it follows, and one list had no order at all
 * (Cecelia, 19 October 2026). One not on a step goes last.
 */
export const STEP_ORDER = sql`coalesce((select min(s.sort_order) from course_steps s where s.assessment_id = ${assessments.id}), 2147483647)`;

/** Where an assessment's study unit sits in its qualification, for lists across units. */
export const UNIT_ORDER = sql`coalesce((select su.sort_order from courses c join study_units su on su.id = c.study_unit_id where c.id = ${assessments.courseId}), 2147483647)`;
