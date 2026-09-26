import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  assessmentDecisions,
  assessmentSubmissions,
  assessments,
  certificates,
  courseSections,
  courses,
  enrolments,
  externalLearningRecords,
  lessons,
  moderationRecords,
  organisations,
  progressRecords,
  qualifications,
  statementsOfResults,
  studyUnits,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Learning records in and out, as xAPI statements.
 *
 * Roland, 26 September (job sheet A10): a provider's learning records must be
 * able to move to and from another system. xAPI is the format a learning
 * record store speaks, and the one another learning system is most likely to
 * take in or hand over, so it is the format used both ways.
 *
 * Going out, every record the platform holds about a learner's progress is
 * written as a statement: registered on a course, completed a lesson,
 * attempted an assessment, judged competent (passed) or not yet (failed),
 * completed a course, and issued a statement of results or a certificate.
 *
 * Coming in, statements are kept as they arrived and shown on the learner's
 * record (see `externalLearningRecords`). They are not turned into enrolments
 * or results here, because nothing about them was taught, assessed or
 * moderated on this platform.
 *
 * Identifiers checked against the published documents on 26 September, not
 * recalled: the statement shape against the xAPI 1.0.3 data specification;
 * "registered" and "attempted" against ADL's published vocabulary; "completed",
 * "passed" and "failed", and the course activity type, against the cmi5
 * specification. ADL's current profile publishes no activity type for a
 * lesson, an assessment or a qualification, so those carry none; the type is
 * optional in xAPI and a guessed one would be worse than none.
 *
 * Neither direction talks to another system directly. Pushing statements to a
 * provider's own record store would mean the platform holding that store's
 * credentials, and the AI extension is deliberately the only credential it
 * stores. That is Roland's decision to take if a provider asks.
 */

export class XapiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XapiError";
  }
}

const VERB = {
  registered: "http://adlnet.gov/expapi/verbs/registered",
  attempted: "http://adlnet.gov/expapi/verbs/attempted",
  completed: "http://adlnet.gov/expapi/verbs/completed",
  passed: "http://adlnet.gov/expapi/verbs/passed",
  failed: "http://adlnet.gov/expapi/verbs/failed",
} as const;

const COURSE_TYPE = "https://w3id.org/xapi/cmi5/activitytype/course";

type Verb = keyof typeof VERB;

export type Statement = {
  id: string;
  actor: { objectType: "Agent"; name: string; mbox: string };
  verb: { id: string; display: { "en-US": string } };
  object: {
    objectType: "Activity";
    id: string;
    definition: { name: { "en-US": string }; type?: string };
  };
  result?: {
    success?: boolean;
    completion?: boolean;
    score?: { raw?: number; min?: number; max?: number; scaled?: number };
  };
  context?: {
    platform: string;
    contextActivities?: { parent: { objectType: "Activity"; id: string }[] };
    extensions?: Record<string, string>;
  };
  timestamp: string;
};

/**
 * A statement id that stays the same every time the same record is exported.
 *
 * A name-based UUID (version 5) from the record's kind and id. The receiving
 * store then recognises a statement it already holds, so exporting twice and
 * loading both files does not double a learner's history, here or anywhere.
 */
const NAMESPACE = Buffer.from("6f9b3c1e8d2a4b7c9e0f1a2b3c4d5e6f", "hex");
export function statementId(name: string): string {
  const hash = createHash("sha1").update(NAMESPACE).update(name).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Every learning record of this provider, as xAPI statements, oldest first.
 *
 * `base` is the provider's own address, which makes each activity id a
 * resolvable-looking IRI that names this provider rather than the operator.
 */
export async function exportStatements(
  session: AuthenticatedSession,
  base: string,
): Promise<Statement[]> {
  assertSessionCan(session, "records:manage");
  const origin = base.replace(/\/+$/, "");
  const activity = (kind: string, id: string) => `${origin}/xapi/activities/${kind}/${id}`;
  const extension = (name: string) => `${origin}/xapi/extensions/${name}`;

  return withTenant(session.organisationId, async (tx) => {
    const [provider] = await tx
      .select({ name: organisations.displayName })
      .from(organisations)
      .where(eq(organisations.id, session.organisationId));
    const platform = provider?.name ?? "Learning platform";

    const people = new Map(
      (
        await tx
          .select({ id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName })
          .from(users)
      ).map((row) => [row.id, row]),
    );

    const statements: Statement[] = [];
    const push = (
      key: string,
      userId: string,
      verb: Verb,
      object: Statement["object"],
      at: Date | null,
      extra: Pick<Statement, "result"> & { parent?: string; extensions?: Record<string, string> } = {},
    ) => {
      const person = people.get(userId);
      if (!person || !at) return;
      statements.push({
        id: statementId(key),
        actor: {
          objectType: "Agent",
          name: `${person.firstName} ${person.lastName}`.trim(),
          mbox: `mailto:${person.email}`,
        },
        verb: { id: VERB[verb], display: { "en-US": verb } },
        object,
        ...(extra.result ? { result: extra.result } : {}),
        context: {
          platform,
          ...(extra.parent
            ? { contextActivities: { parent: [{ objectType: "Activity" as const, id: extra.parent }] } }
            : {}),
          ...(extra.extensions ? { extensions: extra.extensions } : {}),
        },
        timestamp: at.toISOString(),
      });
    };

    const courseObject = (id: string, title: string): Statement["object"] => ({
      objectType: "Activity",
      id: activity("course", id),
      definition: { name: { "en-US": title }, type: COURSE_TYPE },
    });

    // Enrolments: registered, and completed where they were.
    const enrolled = await tx
      .select({
        id: enrolments.id,
        userId: enrolments.userId,
        courseId: enrolments.courseId,
        title: courses.title,
        createdAt: enrolments.createdAt,
        completedAt: enrolments.completedAt,
        status: enrolments.status,
      })
      .from(enrolments)
      .innerJoin(courses, eq(courses.id, enrolments.courseId));
    for (const row of enrolled) {
      push(`enrolment:${row.id}:registered`, row.userId, "registered", courseObject(row.courseId!, row.title), row.createdAt);
      if (row.status === "completed") {
        push(`enrolment:${row.id}:completed`, row.userId, "completed", courseObject(row.courseId!, row.title), row.completedAt, {
          result: { completion: true },
        });
      }
    }

    // Lessons completed.
    const done = await tx
      .select({
        id: progressRecords.id,
        userId: enrolments.userId,
        lessonId: lessons.id,
        lessonTitle: lessons.title,
        courseId: courseSections.courseId,
        completedAt: progressRecords.completedAt,
      })
      .from(progressRecords)
      .innerJoin(enrolments, eq(enrolments.id, progressRecords.enrolmentId))
      .innerJoin(lessons, eq(lessons.id, progressRecords.lessonId))
      .innerJoin(courseSections, eq(courseSections.id, lessons.sectionId))
      .where(eq(progressRecords.state, "completed"));
    for (const row of done) {
      push(
        `progress:${row.id}:completed`,
        row.userId,
        "completed",
        { objectType: "Activity", id: activity("lesson", row.lessonId), definition: { name: { "en-US": row.lessonTitle } } },
        row.completedAt,
        { result: { completion: true }, parent: activity("course", row.courseId) },
      );
    }

    // Assessments attempted, and the judgement on each.
    const attempts = await tx
      .select({
        id: assessmentSubmissions.id,
        userId: assessmentSubmissions.userId,
        assessmentId: assessments.id,
        title: assessments.title,
        courseId: assessments.courseId,
        attempt: assessmentSubmissions.attemptNumber,
        score: assessmentSubmissions.autoScore,
        max: assessmentSubmissions.maxScore,
        submittedAt: assessmentSubmissions.submittedAt,
      })
      .from(assessmentSubmissions)
      .innerJoin(assessments, eq(assessments.id, assessmentSubmissions.assessmentId))
      .where(and(isNotNull(assessmentSubmissions.submittedAt), ne(assessmentSubmissions.status, "draft")));

    const assessmentObject = (id: string, title: string): Statement["object"] => ({
      objectType: "Activity",
      id: activity("assessment", id),
      definition: { name: { "en-US": title } },
    });

    for (const row of attempts) {
      const raw = row.score !== null ? Number(row.score) : undefined;
      const max = row.max !== null ? Number(row.max) : undefined;
      push(
        `submission:${row.id}:attempted`,
        row.userId,
        "attempted",
        assessmentObject(row.assessmentId, row.title),
        row.submittedAt,
        {
          result:
            raw !== undefined && max !== undefined && max > 0
              ? { score: { raw, min: 0, max, scaled: Math.round((raw / max) * 10000) / 10000 } }
              : undefined,
          parent: row.courseId ? activity("course", row.courseId) : undefined,
          extensions: { [extension("attempt")]: String(row.attempt) },
        },
      );
    }

    const judged = attempts.length
      ? await tx
          .select({
            id: assessmentDecisions.id,
            submissionId: assessmentDecisions.submissionId,
            outcome: assessmentDecisions.outcome,
            signedAt: assessmentDecisions.signedAt,
            moderationOutcome: moderationRecords.outcome,
            revisedOutcome: moderationRecords.revisedOutcome,
          })
          .from(assessmentDecisions)
          .leftJoin(moderationRecords, eq(moderationRecords.decisionId, assessmentDecisions.id))
          .where(inArray(assessmentDecisions.submissionId, attempts.map((a) => a.id)))
      : [];
    const bySubmission = new Map(attempts.map((a) => [a.id, a]));
    for (const row of judged) {
      const attempt = bySubmission.get(row.submissionId)!;
      const standing =
        row.moderationOutcome === "overridden" && row.revisedOutcome ? row.revisedOutcome : row.outcome;
      const competent = standing === "competent";
      push(
        `decision:${row.id}:${standing}`,
        attempt.userId,
        competent ? "passed" : "failed",
        assessmentObject(attempt.assessmentId, attempt.title),
        row.signedAt,
        {
          result: { success: competent },
          parent: attempt.courseId ? activity("course", attempt.courseId) : undefined,
          extensions: {
            [extension("outcome")]: competent ? "Competent" : "Not yet competent",
            [extension("moderation")]: row.moderationOutcome ?? "not moderated",
          },
        },
      );
    }

    // Statements of results and certificates that stand.
    const sors = await tx
      .select({
        id: statementsOfResults.id,
        userId: statementsOfResults.userId,
        reference: statementsOfResults.verificationReference,
        issuedAt: statementsOfResults.issuedAt,
        qualificationId: qualifications.id,
        qualification: qualifications.title,
        unitId: studyUnits.id,
        unit: sql<string | null>`${studyUnits.code} || ' ' || ${studyUnits.title}`,
      })
      .from(statementsOfResults)
      .innerJoin(qualifications, eq(qualifications.id, statementsOfResults.qualificationId))
      .leftJoin(studyUnits, eq(studyUnits.id, statementsOfResults.studyUnitId))
      .where(isNull(statementsOfResults.revokedAt));
    for (const row of sors) {
      push(
        `statement:${row.id}:completed`,
        row.userId,
        "completed",
        row.unitId
          ? { objectType: "Activity", id: activity("study-unit", row.unitId), definition: { name: { "en-US": row.unit ?? "" } } }
          : { objectType: "Activity", id: activity("qualification", row.qualificationId), definition: { name: { "en-US": row.qualification } } },
        row.issuedAt,
        {
          result: { completion: true, success: true },
          parent: row.unitId ? activity("qualification", row.qualificationId) : undefined,
          extensions: {
            [extension("statement-of-results")]: row.reference,
          },
        },
      );
    }

    const issued = await tx
      .select({
        id: certificates.id,
        userId: certificates.userId,
        title: certificates.title,
        reference: certificates.verificationReference,
        issuedAt: certificates.issuedAt,
        courseId: enrolments.courseId,
      })
      .from(certificates)
      .innerJoin(enrolments, eq(enrolments.id, certificates.enrolmentId))
      .where(isNull(certificates.revokedAt));
    for (const row of issued) {
      push(
        `certificate:${row.id}:completed`,
        row.userId,
        "completed",
        courseObject(row.courseId!, row.title),
        row.issuedAt,
        {
          result: { completion: true, success: true },
          extensions: { [extension("certificate")]: row.reference },
        },
      );
    }

    statements.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "xapi.exported",
      entityType: "organisation",
      entityId: session.organisationId,
      after: { statements: statements.length },
    });

    return statements;
  });
}

// ---------------------------------------------------------------------------
// Coming in
// ---------------------------------------------------------------------------

/** Larger than any provider's history is likely to be, small enough to read in one go. */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
export const MAX_IMPORT_STATEMENTS = 50_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Incoming = {
  statementId: string;
  actor: string;
  actorName: string | null;
  email: string | null;
  verbId: string;
  verb: string;
  objectId: string;
  objectName: string | null;
  success: boolean | null;
  completion: boolean | null;
  scoreScaled: number | null;
  occurredAt: Date | null;
  statement: unknown;
};

/** A value some way down an object that came from outside, or undefined. */
function at(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function firstOf(map: unknown): string | null {
  if (!map || typeof map !== "object") return null;
  const values = Object.values(map as Record<string, unknown>).filter((v) => typeof v === "string");
  return (values[0] as string | undefined) ?? null;
}

/**
 * Reads the statements out of a file, and says what it could not read.
 *
 * Accepts a JSON array of statements, or an object with a `statements` array,
 * which is how a learning record store answers a request for them.
 */
export function readStatements(text: string): { statements: Incoming[]; rejected: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new XapiError("That file is not JSON. xAPI statements are exchanged as JSON: a list of statements, or an object with a \"statements\" list.");
  }

  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { statements?: unknown }).statements)
      ? (parsed as { statements: unknown[] }).statements
      : null;
  if (!list) {
    throw new XapiError("No statements found. The file should hold a list of statements, or an object with a \"statements\" list.");
  }
  if (list.length > MAX_IMPORT_STATEMENTS) {
    throw new XapiError(`That file holds ${list.length} statements; one import takes up to ${MAX_IMPORT_STATEMENTS}. Split it and import the parts.`);
  }

  const statements: Incoming[] = [];
  const rejected: string[] = [];

  list.forEach((s, index) => {
    const where = `Statement ${index + 1}`;
    if (!s || typeof s !== "object") return void rejected.push(`${where} is not an object.`);

    const mbox = str(at(s, "actor", "mbox"));
    const accountName = str(at(s, "actor", "account", "name"));
    const account = accountName ? `${str(at(s, "actor", "account", "homePage")) ?? ""}#${accountName}` : null;
    const actor = mbox ?? account;
    const verbId = str(at(s, "verb", "id"));
    const objectId = str(at(s, "object", "id"));
    if (!actor) return void rejected.push(`${where} names no learner by email or account.`);
    if (!verbId) return void rejected.push(`${where} has no verb.`);
    if (!objectId) return void rejected.push(`${where} has no object.`);

    const email = mbox ? mbox.replace(/^mailto:/i, "").trim().toLowerCase() : null;
    const timestamp = str(at(s, "timestamp"));
    const occurred = timestamp ? new Date(timestamp) : null;
    const scaled = at(s, "result", "score", "scaled");
    const success = at(s, "result", "success");
    const completion = at(s, "result", "completion");
    const id = str(at(s, "id"));

    statements.push({
      // A statement with no id is given one from its content, so importing
      // the same file twice still recognises it.
      statementId: id && UUID.test(id) ? id.toLowerCase() : statementId(`imported:${JSON.stringify(s)}`),
      actor,
      actorName: str(at(s, "actor", "name")),
      email,
      verbId,
      verb: firstOf(at(s, "verb", "display")) ?? verbId.split("/").pop() ?? verbId,
      objectId,
      objectName: firstOf(at(s, "object", "definition", "name")),
      success: typeof success === "boolean" ? success : null,
      completion: typeof completion === "boolean" ? completion : null,
      scoreScaled: typeof scaled === "number" && scaled >= -1 && scaled <= 1 ? scaled : null,
      occurredAt: occurred && !Number.isNaN(occurred.getTime()) ? occurred : null,
      statement: s,
    });
  });

  return { statements, rejected };
}

export type ImportSummary = {
  read: number;
  added: number;
  alreadyHeld: number;
  learnersMatched: number;
  /** Actors no learner here matched, to be invited or corrected. */
  unmatchedActors: string[];
  rejected: string[];
};

/**
 * Keeps statements from another system against the learners they belong to.
 *
 * Matched by email, without regard to case. A statement whose learner is not
 * here is still kept, unattached, and reported: the person may be invited
 * later, and dropping their history now would lose it.
 */
export async function importStatements(
  session: AuthenticatedSession,
  file: { filename: string; bytes: Uint8Array },
): Promise<ImportSummary> {
  assertSessionCan(session, "records:manage");

  if (file.bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new XapiError("That file is larger than 25 MB. Split it and import the parts.");
  }

  const { statements, rejected } = readStatements(new TextDecoder().decode(file.bytes));

  return withTenant(session.organisationId, async (tx) => {
    const people = await tx.select({ id: users.id, email: users.email }).from(users);
    const byEmail = new Map(people.map((p) => [p.email.toLowerCase(), p.id]));

    let added = 0;
    const matched = new Set<string>();
    const unmatched = new Set<string>();

    for (let at = 0; at < statements.length; at += 500) {
      const batch = statements.slice(at, at + 500).map((s) => {
        const userId = s.email ? (byEmail.get(s.email) ?? null) : null;
        if (userId) matched.add(userId);
        else unmatched.add(s.actor);
        return {
          organisationId: session.organisationId,
          userId,
          statementId: s.statementId,
          actor: s.actor,
          actorName: s.actorName,
          verbId: s.verbId,
          verb: s.verb,
          objectId: s.objectId,
          objectName: s.objectName,
          success: s.success,
          completion: s.completion,
          scoreScaled: s.scoreScaled === null ? null : String(s.scoreScaled),
          occurredAt: s.occurredAt,
          source: file.filename,
          statement: s.statement,
          importedById: session.userId,
        };
      });
      if (batch.length === 0) continue;
      const inserted = await tx
        .insert(externalLearningRecords)
        .values(batch)
        .onConflictDoNothing()
        .returning({ id: externalLearningRecords.id });
      added += inserted.length;
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      actorRole: session.roles[0],
      action: "xapi.imported",
      entityType: "organisation",
      entityId: session.organisationId,
      after: { file: file.filename, read: statements.length, added, rejected: rejected.length },
    });

    return {
      read: statements.length,
      added,
      alreadyHeld: statements.length - added,
      learnersMatched: matched.size,
      unmatchedActors: [...unmatched].sort().slice(0, 50),
      rejected: rejected.slice(0, 50),
    };
  });
}

/**
 * Learning a learner did elsewhere, newest first, for their record.
 *
 * Includes statements imported before the learner was here, matched now by
 * email: a provider imports a class's history, invites the people, and their
 * learning is on their record without a second import.
 */
export async function externalRecordsFor(session: AuthenticatedSession, userId: string) {
  if (userId !== session.userId) assertSessionCan(session, "enrolment:read_all");
  return withTenant(session.organisationId, async (tx) => {
    const [person] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId));
    if (!person) return [];
    return tx
      .select({
        id: externalLearningRecords.id,
        verb: externalLearningRecords.verb,
        objectName: externalLearningRecords.objectName,
        objectId: externalLearningRecords.objectId,
        success: externalLearningRecords.success,
        occurredAt: externalLearningRecords.occurredAt,
        source: externalLearningRecords.source,
      })
      .from(externalLearningRecords)
      .where(
        or(
          eq(externalLearningRecords.userId, userId),
          and(
            isNull(externalLearningRecords.userId),
            sql`lower(${externalLearningRecords.actor}) = ${`mailto:${person.email.toLowerCase()}`}`,
          ),
        ),
      )
      .orderBy(desc(externalLearningRecords.occurredAt))
      .limit(200);
  });
}

/** How many statements this provider holds from elsewhere, and how many are unattached. */
export async function externalRecordCounts(session: AuthenticatedSession) {
  assertSessionCan(session, "records:manage");
  return withTenant(session.organisationId, async (tx) => {
    const [row] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        unattached: sql<number>`count(*) filter (where ${externalLearningRecords.userId} is null)::int`,
      })
      .from(externalLearningRecords);
    return row ?? { total: 0, unattached: 0 };
  });
}
