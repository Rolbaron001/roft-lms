import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { aiImportJobs } from "@/db/schema";
import {
  addAssessmentCriterion,
  addCurriculumModule,
  AuthoringError,
} from "./authoring";
import { addTopic, addTopicElement } from "./curriculum-editor";
import { ImportError, getImportJob, type ImportProposal } from "./ai-import";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Committing one module of an AI proposal.
 *
 * One module at a time, and through the same authoring functions the hand
 * editor uses, so every guard that protects a hand-built curriculum protects
 * this one. Nothing here writes to a table directly.
 *
 * A single "import everything" button on a fifteen-module proposal is a button
 * nobody can check before pressing, and what it produces is exactly what this
 * platform exists to prevent: a curriculum nobody has read against the document
 * it came from. That was already the rule for reading a document; a model
 * reading the same document does not change it, and if anything makes it more
 * necessary, because a model will produce something plausible from a document
 * that says nothing of the kind.
 */

export type CommitSummary = {
  moduleCode: string;
  topics: number;
  elements: number;
  criteria: number;
  /** What the ordinary authoring guards turned away, in their own words. */
  refused: string[];
};

function explain(error: unknown, where: string): string {
  if (error instanceof AuthoringError) return `${where}: ${error.message}`;
  if (error && typeof error === "object" && "issues" in error) {
    return `${where}: ${(error as { issues: { message: string }[] }).issues
      .map((issue) => issue.message)
      .join(" ")}`;
  }
  return `${where}: could not be added.`;
}

const COMPONENTS = new Set(["knowledge", "practical", "workplace"]);

export async function commitProposedModule(
  session: AuthenticatedSession,
  input: { jobId: string; qualificationId: string; moduleCode: string },
): Promise<CommitSummary> {
  assertSessionCan(session, "qualification:manage");

  const job = await getImportJob(session, input.jobId);
  const proposal = job.proposal as ImportProposal | null;

  if (!proposal || job.status !== "proposed") {
    throw new ImportError(
      "That import has nothing waiting to be committed.",
      "no_proposal",
    );
  }

  if ((job.committedModules ?? []).includes(input.moduleCode)) {
    throw new ImportError(
      `${input.moduleCode} has already been taken from this proposal.`,
      "no_proposal",
    );
  }

  const entry = (proposal.modules ?? []).find(
    (module) => module.code === input.moduleCode,
  );

  if (!entry) {
    throw new ImportError(
      `${input.moduleCode} is not one of the modules in this proposal.`,
      "not_found",
    );
  }

  // A model can return anything in a string field. The component decides which
  // third of the qualification a module counts towards, so a wrong one is a
  // readiness calculation that is quietly wrong rather than an error anybody
  // sees.
  const component = String(entry.component ?? "").toLowerCase();
  if (!COMPONENTS.has(component)) {
    throw new ImportError(
      `${input.moduleCode} has no usable component - it says "${entry.component ?? "nothing"}", and it has to be knowledge, practical or workplace. Fix it in the source document and read the folder again.`,
      "unreadable",
    );
  }

  const refused: string[] = [];
  let topics = 0;
  let elements = 0;
  let criteria = 0;

  // Criterion codes are unique within the module, not within the topic, so the
  // numbering runs across the whole module. Restarting it per topic collided
  // the moment a module had two topics - caught by the authoring guard, which
  // is the reason for committing through it rather than writing rows directly.
  let criterionNumber = 0;

  const created = await addCurriculumModule(session, {
    qualificationId: input.qualificationId,
    component: component as "knowledge" | "practical" | "workplace",
    code: entry.code ?? input.moduleCode,
    title: entry.title ?? input.moduleCode,
    credits: entry.credits ?? undefined,
  });

  for (const topic of entry.topics ?? []) {
    let topicId: string;

    try {
      const made = await addTopic(session, {
        curriculumModuleId: created.id,
        // The topic's own code where the document gave one, otherwise a
        // positional one. A blank code would be rejected by the editor's own
        // guard, which is right, but it would reject the whole topic rather
        // than the missing field - and the topic is the useful part.
        code: topic.code?.trim() || `T${topics + 1}`,
        title: topic.title ?? "Untitled topic",
      });
      topicId = made.id;
      topics += 1;
    } catch (error) {
      refused.push(explain(error, topic.code ?? topic.title ?? "a topic"));
      continue;
    }

    // Which kind of element a topic carries follows from the component, which
    // is how the framework defines them: knowledge topics under a knowledge
    // module, practical activities under a practical one, work activities
    // under workplace. Asking the model to label each one would invite it to
    // guess, and the answer is already determined.
    const elementKind =
      component === "knowledge"
        ? ("knowledge_topic" as const)
        : component === "practical"
          ? ("practical_activity" as const)
          : ("work_activity" as const);

    let elementNumber = 0;
    for (const element of topic.elements ?? []) {
      elementNumber += 1;
      try {
        await addTopicElement(session, {
          topicId,
          kind: elementKind,
          code: `${topic.code?.trim() || `T${topics}`}.${elementNumber}`,
          description: element,
        });
        elements += 1;
      } catch (error) {
        refused.push(explain(error, "an element"));
      }
    }

    for (const criterion of topic.criteria ?? []) {
      criterionNumber += 1;
      try {
        await addAssessmentCriterion(session, {
          curriculumModuleId: created.id,
          topicId,
          code: `${entry.code ?? input.moduleCode}-IAC${criterionNumber}`,
          description: criterion,
        });
        criteria += 1;
      } catch (error) {
        refused.push(explain(error, "a criterion"));
      }
    }
  }

  // The job stays open until every module in it has been taken. Closing it on
  // the first commit strands the rest, and a proposal is checked a module at a
  // time - often across more than one sitting.
  const taken = [...(job.committedModules ?? []), entry.code ?? input.moduleCode];
  const total = (proposal.modules ?? []).length;

  await withTenant(session.organisationId, (tx) =>
    tx
      .update(aiImportJobs)
      .set({
        qualificationId: input.qualificationId,
        committedModules: taken,
        committedById: session.userId,
        committedAt: new Date(),
        status: taken.length >= total ? "committed" : "proposed",
      })
      .where(eq(aiImportJobs.id, input.jobId)),
  );

  return {
    moduleCode: entry.code ?? input.moduleCode,
    topics,
    elements,
    criteria,
    refused,
  };
}
