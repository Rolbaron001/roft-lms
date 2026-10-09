/**
 * A provider's own programme feedback questions and scale (job sheet D20, 9
 * October 2026), against a live database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { feedbackQuestionnaires, organisations, userRoles, users } from "@/db/schema";
import { activeQuestionnaire, FeedbackError, pointsOf, saveQuestionnaire } from "@/lib/feedback";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let learner: AuthenticatedSession;

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "feedback@example.test",
    firstName: "Feedback",
    lastName: "Tester",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

beforeAll(async () => {
  const slug = `feedback-${Date.now()}`;
  const ids = await withPlatformScope("feedback questions test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: "Feedback Test Co", status: "active" })
      .returning({ id: organisations.id });
    const made: Record<string, string> = {};
    for (const [name, role] of [["admin", "tenant_admin"], ["learner", "learner"]] as const) {
      const [user] = await tx
        .insert(users)
        .values({ organisationId: organisation.id, email: `${name}-${slug}@example.test`, firstName: name, lastName: "Tester", status: "active" })
        .returning({ id: users.id });
      await tx.insert(userRoles).values({ organisationId: organisation.id, userId: user.id, role });
      made[name] = user.id;
    }
    return { organisationId: organisation.id, made };
  });
  organisationId = ids.organisationId;
  admin = sessionFor(["tenant_admin"], ids.made.admin);
  learner = sessionFor(["learner"], ids.made.learner);
});

afterAll(async () => {
  await withPlatformScope("feedback questions test teardown", (tx) => tx.delete(organisations).where(eq(organisations.id, organisationId)));
});

describe("a provider's own feedback questions", () => {
  it("starts from the platform's questions on its five points", async () => {
    const first = await activeQuestionnaire(admin);
    expect(first.questions.length).toBeGreaterThan(0);
    expect(pointsOf(first.questions[0])).toBe(5);
  });

  it("saves the provider's questions on its own four-point scale, as a new version", async () => {
    const before = await activeQuestionnaire(admin);
    const scale = ["Strongly disagree", "Disagree", "Agree", "Strongly agree"];
    await saveQuestionnaire(admin, {
      questions: [
        { prompt: "I was satisfied with the programme.", kind: "rating", required: true },
        { prompt: "The content was relevant to my work.", kind: "rating", required: true },
        { prompt: "Anything else?", kind: "text", required: false },
      ],
      scale,
    });
    const after = await activeQuestionnaire(admin);
    expect(after.id).not.toBe(before.id);
    expect(after.questions.map((question) => question.prompt)).toEqual([
      "I was satisfied with the programme.",
      "The content was relevant to my work.",
      "Anything else?",
    ]);
    expect(after.questions[0].scale).toEqual(scale);
    expect(pointsOf(after.questions[0])).toBe(4);
    expect(after.questions[2].scale).toBeUndefined();

    // The old version is kept, so a form already sent keeps what it asked.
    const kept = await withPlatformScope("feedback questions test read", (tx) =>
      tx.select({ active: feedbackQuestionnaires.active }).from(feedbackQuestionnaires).where(eq(feedbackQuestionnaires.id, before.id)),
    );
    expect(kept).toEqual([{ active: false }]);
  });

  it("keeps a question's key while its wording stands, so its answers read together", async () => {
    const first = await activeQuestionnaire(admin);
    await saveQuestionnaire(admin, {
      questions: [
        { prompt: "I was satisfied with the programme.", kind: "rating", required: true },
        { prompt: "The facilitator was well prepared.", kind: "rating", required: true },
      ],
      scale: ["Poor", "Fair", "Good", "Excellent"],
    });
    const second = await activeQuestionnaire(admin);
    expect(second.questions[0].key).toBe(first.questions[0].key);
    expect(second.questions[1].key).not.toBe(first.questions[1].key);
  });

  it("refuses a scale of one point, the same question twice, and anyone but an administrator", async () => {
    await expect(saveQuestionnaire(admin, { questions: [{ prompt: "Good?", kind: "rating", required: true }], scale: ["Yes"] })).rejects.toBeInstanceOf(FeedbackError);
    await expect(
      saveQuestionnaire(admin, {
        questions: [
          { prompt: "Was it good?", kind: "rating", required: true },
          { prompt: "Was it good?", kind: "rating", required: true },
        ],
        scale: [],
      }),
    ).rejects.toBeInstanceOf(FeedbackError);
    await expect(saveQuestionnaire(learner, { questions: [{ prompt: "Was it good?", kind: "rating", required: true }], scale: [] })).rejects.toThrow();
  });
});
