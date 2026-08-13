/**
 * Certificates, against a live database.
 *
 * A certificate is the platform's only outward-facing claim: that a named
 * person demonstrated named competencies. Every test here guards a way that
 * claim could quietly become false - issued before moderation finished, issued
 * after a moderator overturned the decision, issued twice, or still verifying
 * as valid after being withdrawn.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope, withTenant } from "@/db/client";
import {
  auditLog,
  certificates,
  competencies,
  competencyFrameworks,
  organisations,
  userRoles,
  users,
} from "@/db/schema";
import {
  addLesson,
  addSection,
  createCourse,
  publishCourse,
  tagCourseCompetency,
} from "@/lib/authoring";
import { enrolUser, getEnrolmentForDelivery, markLessonComplete } from "@/lib/enrolment";
import {
  addAssessmentItem,
  createAssessment,
  publishAssessment,
  recordAssessorDecision,
  recordModeration,
  submitQuiz,
} from "@/lib/assessment";
import {
  certificateEligibility,
  CertificateError,
  generateVerificationReference,
  issueCertificate,
  listMyCertificates,
  normaliseReference,
  revokeCertificate,
  verifyByReference,
} from "@/lib/certificates";
import { PermissionDeniedError, permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let competencyId: string;
let admin: AuthenticatedSession;
let assessor: AuthenticatedSession;
let moderator: AuthenticatedSession;
let learner: AuthenticatedSession;

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "test@example.test",
    firstName: "Test",
    lastName: "User",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
  };
}

async function createPerson(email: string, roles: Role[]) {
  return withPlatformScope("certificate test fixture", async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        organisationId,
        email,
        firstName: email.split("@")[0],
        lastName: "Tester",
        status: "active",
      })
      .returning({ id: users.id });

    for (const role of roles) {
      await tx
        .insert(userRoles)
        .values({ organisationId, userId: user.id, role });
    }

    return user.id;
  });
}

function suffix() {
  return Math.random().toString(36).slice(2, 8);
}

/** A published one-lesson course, optionally with a summative quiz. */
async function buildCourse(options: { withSummativeQuiz: boolean }) {
  const course = await createCourse(admin, { title: `Cert course ${suffix()}` });
  const section = await addSection(admin, {
    courseId: course.id,
    title: "Section",
  });
  await addLesson(admin, { sectionId: section.id, title: "Lesson" });
  await tagCourseCompetency(admin, course.id, competencyId);
  const published = await publishCourse(admin, course.id);
  if (!published.ok) throw new Error(published.reasons.join(" "));

  let assessmentId: string | null = null;
  let optionId: string | null = null;

  if (options.withSummativeQuiz) {
    const assessment = await createAssessment(admin, {
      courseId: course.id,
      title: "Final assessment",
      purpose: "summative",
    });
    const item = await addAssessmentItem(admin, {
      assessmentId: assessment.id,
      stem: "Question",
      options: ["Right", "Wrong"],
      correctIndexes: [0],
    });
    await publishAssessment(admin, assessment.id);
    assessmentId = assessment.id;
    optionId = item.options![0].id;
  }

  return { courseId: course.id, assessmentId, optionId };
}

/** Enrols the learner and completes every lesson. */
async function completeLessons(courseId: string) {
  const enrolment = await enrolUser(admin, {
    userId: learner.userId,
    courseId,
  });

  const delivery = await getEnrolmentForDelivery(learner, enrolment.id);
  for (const lesson of delivery.sections.flatMap((s) => s.lessons)) {
    await markLessonComplete(learner, enrolment.id, lesson.id);
  }

  return enrolment.id;
}

beforeAll(async () => {
  const slug = `cert-${Date.now()}`;

  const created = await withPlatformScope(
    "certificate test fixture setup",
    async (tx) => {
      const [organisation] = await tx
        .insert(organisations)
        .values({
          slug,
          legalName: `${slug} Ltd`,
          displayName: "Certificate Test Co",
          status: "active",
        })
        .returning({ id: organisations.id });

      const [framework] = await tx
        .insert(competencyFrameworks)
        .values({ organisationId: organisation.id, name: "Framework" })
        .returning({ id: competencyFrameworks.id });

      const [competency] = await tx
        .insert(competencies)
        .values({
          organisationId: organisation.id,
          frameworkId: framework.id,
          code: "CRT-01",
          name: "Demonstrated capability",
        })
        .returning({ id: competencies.id });

      return { organisationId: organisation.id, competencyId: competency.id };
    },
  );

  organisationId = created.organisationId;
  competencyId = created.competencyId;

  admin = sessionFor(
    ["tenant_admin"],
    await createPerson("admin@cert.test", ["tenant_admin"]),
  );
  assessor = sessionFor(
    ["assessor"],
    await createPerson("assessor@cert.test", ["assessor"]),
  );
  moderator = sessionFor(
    ["moderator"],
    await createPerson("moderator@cert.test", ["moderator"]),
  );
  learner = sessionFor(
    ["learner"],
    await createPerson("learner@cert.test", ["learner"]),
  );
});

afterAll(async () => {
  await withPlatformScope("certificate test teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("verification references", () => {
  it("produces a reference of the documented shape", () => {
    expect(generateVerificationReference()).toMatch(
      /^ROFT-[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/,
    );
  });

  /** A guessable reference would let anyone enumerate every certificate. */
  it("does not repeat", () => {
    const references = new Set(
      Array.from({ length: 500 }, generateVerificationReference),
    );
    expect(references.size).toBe(500);
  });

  it("excludes characters that are misread when handwritten", () => {
    const sample = Array.from({ length: 200 }, generateVerificationReference)
      .join("")
      .replace(/-|ROFT/g, "");
    expect(sample).not.toMatch(/[ILOU01]/);
  });

  it("accepts a reference however it was typed", () => {
    const reference = generateVerificationReference();
    const mangled = reference.toLowerCase().replace(/-/g, " ");
    expect(normaliseReference(mangled)).toBe(reference);
  });
});

describe("eligibility", () => {
  it("refuses a course that is not finished", async () => {
    const { courseId } = await buildCourse({ withSummativeQuiz: false });
    const enrolment = await enrolUser(admin, {
      userId: learner.userId,
      courseId,
    });

    const eligibility = await certificateEligibility(admin, enrolment.id);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join(" ")).toContain("not completed every lesson");
  });

  it("allows a finished course with no summative assessment", async () => {
    const { courseId } = await buildCourse({ withSummativeQuiz: false });
    const enrolmentId = await completeLessons(courseId);

    const eligibility = await certificateEligibility(admin, enrolmentId);
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.competencies.map((c) => c.code)).toEqual(["CRT-01"]);
  });

  it("refuses while a summative assessment has not been attempted", async () => {
    const { courseId } = await buildCourse({ withSummativeQuiz: true });
    const enrolmentId = await completeLessons(courseId);

    const eligibility = await certificateEligibility(admin, enrolmentId);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join(" ")).toContain("not been attempted");
  });

  it("refuses while an assessor has not yet decided", async () => {
    const { courseId, assessmentId, optionId } = await buildCourse({
      withSummativeQuiz: true,
    });
    const enrolmentId = await completeLessons(courseId);
    await submitQuiz(learner, {
      assessmentId: assessmentId!,
      enrolmentId,
      responses: { [assessmentId!]: [] },
    });

    const eligibility = await certificateEligibility(admin, enrolmentId);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join(" ")).toContain("waiting for an assessor");
    void optionId;
  });

  /**
   * The gap that would matter most: a decision routed for moderation is not
   * final. Issuing here would put a certificate behind a judgement nobody has
   * checked yet.
   */
  it("refuses while moderation is outstanding", async () => {
    const { courseId, assessmentId, optionId } = await buildCourse({
      withSummativeQuiz: true,
    });
    const enrolmentId = await completeLessons(courseId);
    const submitted = await submitQuiz(learner, {
      assessmentId: assessmentId!,
      enrolmentId,
      responses: { [assessmentId!]: [optionId!] },
    });
    await recordAssessorDecision(assessor, {
      submissionId: submitted.submissionId,
      outcome: "competent",
    });

    const eligibility = await certificateEligibility(admin, enrolmentId);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join(" ")).toContain("waiting for moderation");
  });

  it("refuses a learner judged not yet competent", async () => {
    const { courseId, assessmentId, optionId } = await buildCourse({
      withSummativeQuiz: true,
    });
    const enrolmentId = await completeLessons(courseId);
    const submitted = await submitQuiz(learner, {
      assessmentId: assessmentId!,
      enrolmentId,
      responses: { [assessmentId!]: [optionId!] },
    });
    const { decision } = await recordAssessorDecision(assessor, {
      submissionId: submitted.submissionId,
      outcome: "not_yet_competent",
    });
    await recordModeration(moderator, {
      decisionId: decision.id,
      outcome: "endorsed",
    });

    const eligibility = await certificateEligibility(admin, enrolmentId);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join(" ")).toContain("not yet competent");
  });

  /** A moderator's override must decide the certificate, not the assessor. */
  it("refuses when a moderator overturned a competent decision", async () => {
    const { courseId, assessmentId, optionId } = await buildCourse({
      withSummativeQuiz: true,
    });
    const enrolmentId = await completeLessons(courseId);
    const submitted = await submitQuiz(learner, {
      assessmentId: assessmentId!,
      enrolmentId,
      responses: { [assessmentId!]: [optionId!] },
    });
    const { decision } = await recordAssessorDecision(assessor, {
      submissionId: submitted.submissionId,
      outcome: "competent",
    });
    await recordModeration(moderator, {
      decisionId: decision.id,
      outcome: "overridden",
      revisedOutcome: "not_yet_competent",
      comments: "Evidence insufficient.",
    });

    const eligibility = await certificateEligibility(admin, enrolmentId);
    expect(eligibility.eligible).toBe(false);
  });

  it("refuses while a decision is referred back", async () => {
    const { courseId, assessmentId, optionId } = await buildCourse({
      withSummativeQuiz: true,
    });
    const enrolmentId = await completeLessons(courseId);
    const submitted = await submitQuiz(learner, {
      assessmentId: assessmentId!,
      enrolmentId,
      responses: { [assessmentId!]: [optionId!] },
    });
    const { decision } = await recordAssessorDecision(assessor, {
      submissionId: submitted.submissionId,
      outcome: "competent",
    });
    await recordModeration(moderator, {
      decisionId: decision.id,
      outcome: "referred_back",
      comments: "Look again.",
    });

    const eligibility = await certificateEligibility(admin, enrolmentId);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons.join(" ")).toContain("referred back");
  });
});

describe("issuing", () => {
  it("refuses to issue when the rules are not met, and says why", async () => {
    const { courseId } = await buildCourse({ withSummativeQuiz: true });
    const enrolmentId = await completeLessons(courseId);

    const result = await issueCertificate(admin, enrolmentId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("issues once every rule is met", async () => {
    const { courseId } = await buildCourse({ withSummativeQuiz: false });
    const enrolmentId = await completeLessons(courseId);

    const result = await issueCertificate(admin, enrolmentId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.certificate.verificationReference).toMatch(/^ROFT-/);
    expect(result.certificate.competenciesAttested).toEqual([
      { code: "CRT-01", name: "Demonstrated capability" },
    ]);
  });

  it("does not issue a second certificate for the same enrolment", async () => {
    const { courseId } = await buildCourse({ withSummativeQuiz: false });
    const enrolmentId = await completeLessons(courseId);

    const first = await issueCertificate(admin, enrolmentId);
    const second = await issueCertificate(admin, enrolmentId);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.alreadyIssued).toBe(true);
    expect(second.certificate.id).toBe(first.certificate.id);

    const rows = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(certificates)
        .where(eq(certificates.enrolmentId, enrolmentId)),
    );
    expect(rows).toHaveLength(1);
  });

  it("stops a learner issuing their own certificate", async () => {
    const { courseId } = await buildCourse({ withSummativeQuiz: false });
    const enrolmentId = await completeLessons(courseId);

    await expect(
      issueCertificate(learner, enrolmentId),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("records the issue in the audit log", async () => {
    const { courseId } = await buildCourse({ withSummativeQuiz: false });
    const enrolmentId = await completeLessons(courseId);
    const result = await issueCertificate(admin, enrolmentId);
    if (!result.ok) throw new Error("expected issue");

    const entries = await withTenant(organisationId, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, result.certificate.id)),
    );

    expect(
      entries.some((entry) => entry.action.startsWith("certificate.issued")),
    ).toBe(true);
  });
});

describe("issuing automatically", () => {
  /**
   * A learner finishing the last lesson holds no authority to issue anything.
   * The platform issues because the rules were met, which is the point.
   */
  it("issues when the final lesson is completed", async () => {
    const { courseId } = await buildCourse({ withSummativeQuiz: false });
    const enrolmentId = await completeLessons(courseId);

    const rows = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(certificates)
        .where(eq(certificates.enrolmentId, enrolmentId)),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].verificationReference).toMatch(/^ROFT-/);
  });

  it("issues when moderation completes the chain", async () => {
    const { courseId, assessmentId, optionId } = await buildCourse({
      withSummativeQuiz: true,
    });
    const enrolmentId = await completeLessons(courseId);

    // Not yet: the summative assessment is outstanding.
    let rows = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(certificates)
        .where(eq(certificates.enrolmentId, enrolmentId)),
    );
    expect(rows).toHaveLength(0);

    const submitted = await submitQuiz(learner, {
      assessmentId: assessmentId!,
      enrolmentId,
      responses: { [assessmentId!]: [optionId!] },
    });
    const { decision } = await recordAssessorDecision(assessor, {
      submissionId: submitted.submissionId,
      outcome: "competent",
    });

    // Still not: the decision is with a moderator.
    rows = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(certificates)
        .where(eq(certificates.enrolmentId, enrolmentId)),
    );
    expect(rows).toHaveLength(0);

    await recordModeration(moderator, {
      decisionId: decision.id,
      outcome: "endorsed",
    });

    rows = await withTenant(organisationId, (tx) =>
      tx
        .select()
        .from(certificates)
        .where(eq(certificates.enrolmentId, enrolmentId)),
    );
    expect(rows).toHaveLength(1);
  });
});

describe("public verification", () => {
  async function issued() {
    const { courseId } = await buildCourse({ withSummativeQuiz: false });
    const enrolmentId = await completeLessons(courseId);
    const result = await issueCertificate(admin, enrolmentId);
    if (!result.ok) throw new Error("expected issue");
    return result.certificate;
  }

  it("confirms a genuine certificate without anyone signing in", async () => {
    const certificate = await issued();
    const verification = await verifyByReference(
      certificate.verificationReference,
    );

    expect(verification.found).toBe(true);
    expect(verification.valid).toBe(true);
    expect(verification.holderName).toContain("learner@cert.test".split("@")[0]);
    expect(verification.issuedBy).toBe("Certificate Test Co");
    expect(verification.competencies?.[0].code).toBe("CRT-01");
  });

  it("accepts a reference typed without hyphens or in lower case", async () => {
    const certificate = await issued();
    const mangled = certificate.verificationReference
      .toLowerCase()
      .replace(/-/g, "");

    expect((await verifyByReference(mangled)).found).toBe(true);
  });

  /** Must reveal nothing about references that do not exist. */
  it("reports nothing for an unknown reference", async () => {
    expect(await verifyByReference("ROFT-AAAAA-AAAAA-AAAAA-AAAAA")).toEqual({
      found: false,
      valid: false,
    });
  });

  it("reports nothing for a malformed reference", async () => {
    expect(await verifyByReference("not-a-reference")).toEqual({
      found: false,
      valid: false,
    });
    expect(await verifyByReference("")).toEqual({ found: false, valid: false });
  });
});

describe("withdrawing a certificate", () => {
  async function issued() {
    const { courseId } = await buildCourse({ withSummativeQuiz: false });
    const enrolmentId = await completeLessons(courseId);
    const result = await issueCertificate(admin, enrolmentId);
    if (!result.ok) throw new Error("expected issue");
    return result.certificate;
  }

  it("stops the certificate verifying as valid, without hiding it", async () => {
    const certificate = await issued();
    await revokeCertificate(admin, certificate.id, "Issued against the wrong course.");

    const verification = await verifyByReference(
      certificate.verificationReference,
    );

    // Found but not valid: someone holding the paper deserves to be told it
    // was withdrawn, rather than that it never existed.
    expect(verification.found).toBe(true);
    expect(verification.valid).toBe(false);
    expect(verification.revokedReason).toContain("wrong course");
  });

  it("requires a reason, because the reason is shown to whoever verifies it", async () => {
    const certificate = await issued();
    await expect(
      revokeCertificate(admin, certificate.id, "no"),
    ).rejects.toBeInstanceOf(CertificateError);
  });

  it("refuses to withdraw the same certificate twice", async () => {
    const certificate = await issued();
    await revokeCertificate(admin, certificate.id, "First withdrawal.");
    await expect(
      revokeCertificate(admin, certificate.id, "Second withdrawal."),
    ).rejects.toBeInstanceOf(CertificateError);
  });

  it("stops a learner withdrawing a certificate", async () => {
    const certificate = await issued();
    await expect(
      revokeCertificate(learner, certificate.id, "I would rather not."),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("allows a replacement to be issued after withdrawal", async () => {
    const { courseId } = await buildCourse({ withSummativeQuiz: false });
    const enrolmentId = await completeLessons(courseId);
    const first = await issueCertificate(admin, enrolmentId);
    if (!first.ok) throw new Error("expected issue");

    await revokeCertificate(admin, first.certificate.id, "Name misspelled.");

    const replacement = await issueCertificate(admin, enrolmentId);
    expect(replacement.ok).toBe(true);
    if (!replacement.ok) return;
    expect(replacement.certificate.id).not.toBe(first.certificate.id);
  });
});

describe("a learner's own certificates", () => {
  it("lists them", async () => {
    const { courseId } = await buildCourse({ withSummativeQuiz: false });
    await completeLessons(courseId);

    const mine = await listMyCertificates(learner);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0].reference).toMatch(/^ROFT-/);
  });

  it("does not list anyone else's", async () => {
    const other = sessionFor(
      ["learner"],
      await createPerson(`other-${suffix()}@cert.test`, ["learner"]),
    );

    expect(await listMyCertificates(other)).toEqual([]);
  });
});
