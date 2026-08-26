/**
 * The shape of a curriculum, with nothing behind it.
 *
 * This file exists so that a form can know which kinds of line a module holds
 * without importing the code that reads the database. `lib/curriculum-editor`
 * reaches into Postgres; a client component that imports one constant from it
 * pulls the whole driver into the browser bundle, and the build fails with
 * "can't resolve 'net'" rather than anything about React.
 *
 * So: types and constants only here. No imports, ever.
 */

export type ElementKind =
  | "knowledge_topic"
  | "practical_activity"
  | "applied_knowledge"
  | "work_activity"
  | "contextual_knowledge"
  | "supporting_evidence";

/** Which kinds belong in which component, so the form offers the right ones. */
export const ELEMENT_KINDS_BY_COMPONENT: Record<string, ElementKind[]> = {
  knowledge: ["knowledge_topic"],
  practical: ["practical_activity", "applied_knowledge"],
  workplace: ["work_activity", "contextual_knowledge", "supporting_evidence"],
  general: ["knowledge_topic"],
};
