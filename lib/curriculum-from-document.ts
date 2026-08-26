import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { curriculumModules, programmeDocuments } from "@/db/schema";
import {
  addAssessmentCriterion,
  addCurriculumModule,
  AuthoringError,
} from "./authoring";
import { addTopic, addTopicElement } from "./curriculum-editor";
import { parseCurriculumText, type ParsedModule } from "./curriculum-parse";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Starting the curriculum from the document instead of from a blank form.
 *
 * The reading itself is in `curriculum-parse`. This is the part that puts a
 * proposal in front of a person and, only if they say so, writes it — one
 * module at a time, through the same functions the hand editor uses, so that
 * every guard applies. Nothing here writes directly to a table.
 *
 * One module at a time is the point. A single "import everything" button on a
 * fifteen-module document is a button nobody can check before pressing, and
 * what it produces is exactly what this platform is trying to avoid: a
 * curriculum that nobody has read against the document it came from.
 */

export class CurriculumImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CurriculumImportError";
  }
}

export type ProposedModule = ParsedModule & {
  /** Already in the platform under this code, so accepting it would clash. */
  present: boolean;
  topicCount: number;
  elementCount: number;
  criterionCount: number;
};

export type Proposal = {
  document: { id: string; title: string; filename: string } | null;
  modules: ProposedModule[];
  notes: string[];
  /** Why there is nothing to propose, when there is nothing to propose. */
  blocked?: string;
};

/**
 * What the curriculum document for this qualification appears to say.
 */
export async function proposalForQualification(
  session: AuthenticatedSession,
  qualificationId: string,
): Promise<Proposal> {
  assertSessionCan(session, "qualification:manage");

  return withTenant(session.organisationId, async (tx) => {
    const [document] = await tx
      .select({
        id: programmeDocuments.id,
        title: programmeDocuments.title,
        filename: programmeDocuments.filename,
        extractedText: programmeDocuments.extractedText,
      })
      .from(programmeDocuments)
      .where(
        and(
          eq(programmeDocuments.qualificationId, qualificationId),
          eq(programmeDocuments.kind, "curriculum_document"),
        ),
      )
      .orderBy(desc(programmeDocuments.createdAt))
      .limit(1);

    if (!document) {
      return {
        document: null,
        modules: [],
        notes: [],
        blocked:
          "No curriculum document has been uploaded for this qualification yet. Upload it first and the platform will read what it can from it.",
      };
    }

    const identity = {
      id: document.id,
      title: document.title,
      filename: document.filename,
    };

    if (!document.extractedText) {
      return {
        document: identity,
        modules: [],
        notes: [],
        blocked:
          "The curriculum document is stored but no text could be read from it. If it is a scan, the platform cannot read it — upload a digital copy and this page will fill in.",
      };
    }

    const parsed = parseCurriculumText(document.extractedText);

    const existing = await tx
      .select({ code: curriculumModules.code })
      .from(curriculumModules)
      .where(eq(curriculumModules.qualificationId, qualificationId));

    const already = new Set(existing.map((row) => row.code));

    return {
      document: identity,
      modules: parsed.modules.map((entry) => describe(entry, already)),
      notes: parsed.notes,
    };
  });
}

function describe(entry: ParsedModule, already: Set<string>): ProposedModule {
  return {
    ...entry,
    present: already.has(entry.code),
    topicCount: entry.topics.length,
    elementCount: entry.topics.reduce(
      (total, topic) => total + topic.elements.length,
      0,
    ),
    criterionCount: entry.topics.reduce(
      (total, topic) => total + topic.criteria.length,
      0,
    ),
  };
}

export type AcceptedSummary = {
  moduleCode: string;
  topics: number;
  elements: number;
  criteria: number;
  /** Lines the platform refused, and why, in the words the guard used. */
  refused: string[];
};

/**
 * Writes one proposed module into the curriculum.
 *
 * The document is read again here rather than the proposal being posted back
 * from the browser. A form can be edited on its way to the server; the
 * document cannot, and it is the document that everybody is checking against.
 *
 * A line the platform refuses is collected and reported rather than aborting
 * the module. A curriculum document is not always internally consistent — one
 * of the two real documents repeats a criterion code — and losing the other
 * forty-seven lines over one clash would send somebody back to typing it all
 * out by hand.
 */
export async function acceptProposedModule(
  session: AuthenticatedSession,
  qualificationId: string,
  moduleCode: string,
): Promise<AcceptedSummary> {
  assertSessionCan(session, "qualification:manage");

  const proposal = await proposalForQualification(session, qualificationId);

  if (proposal.blocked) throw new CurriculumImportError(proposal.blocked);

  const entry = proposal.modules.find((entry) => entry.code === moduleCode);

  if (!entry) {
    throw new CurriculumImportError(
      `${moduleCode} is not one of the modules read from the document.`,
    );
  }

  if (entry.present) {
    throw new CurriculumImportError(
      `${moduleCode} is already in this qualification. Remove it first if you want to take it from the document again.`,
    );
  }

  const refused: string[] = [];
  let topics = 0;
  let elements = 0;
  let criteria = 0;

  const created = await addCurriculumModule(session, {
    qualificationId,
    component: entry.component,
    code: entry.code,
    title: entry.title,
    credits: entry.credits ?? undefined,
  });

  for (const topic of entry.topics) {
    let topicId: string;

    try {
      const madeTopic = await addTopic(session, {
        curriculumModuleId: created.id,
        code: topic.code,
        title: topic.title,
        weightPercent: topic.weightPercent,
      });
      topicId = madeTopic.id;
      topics += 1;
    } catch (error) {
      refused.push(explain(error, topic.code));
      continue;
    }

    for (const element of topic.elements) {
      try {
        await addTopicElement(session, {
          topicId,
          kind: element.kind,
          code: element.code,
          description: element.description,
        });
        elements += 1;
      } catch (error) {
        refused.push(explain(error, element.code));
      }
    }

    for (const criterion of topic.criteria) {
      try {
        await addAssessmentCriterion(session, {
          curriculumModuleId: created.id,
          topicId,
          code: criterion.code,
          description: criterion.description,
        });
        criteria += 1;
      } catch (error) {
        refused.push(explain(error, criterion.code));
      }
    }
  }

  return { moduleCode: entry.code, topics, elements, criteria, refused };
}

function explain(error: unknown, code: string): string {
  if (error instanceof AuthoringError || error instanceof Error) {
    // The guards name the code themselves. Prefixing it again reads as a
    // stutter, and the guard's own wording is the more useful of the two.
    return error.message.includes(code)
      ? error.message
      : `${code}: ${error.message}`;
  }
  return `${code}: could not be added.`;
}
