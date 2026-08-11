import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  assessmentDecisions,
  assessmentSubmissions,
  assessments,
  certificates,
  courses,
  curriculumModules,
  enrolments,
  moderationRecords,
  organisations,
  qualifications,
  userRoles,
  users,
} from "@/db/schema";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { validateSouthAfricanId } from "./south-african-id";
import { toCsv } from "./reporting";

/**
 * Statutory reporting: the SAQA National Learners' Records Database, and the
 * Workplace Skills Plan / Annual Training Report returns.
 *
 * The point of doing this in software is not the file itself — anyone can
 * write a CSV. It is the validation that runs before submission. A return
 * rejected by the NLRD for a mistyped identity number or a missing equity code
 * costs a provider a full cycle, and the errors are invisible in a spreadsheet
 * until the regulator finds them.
 *
 * IMPORTANT: the field mapping below follows the structure set out in the
 * accreditation framework document (Person 27, Enrolment 28, Achievement 29,
 * Provider 30). The exact Edu.Dex flat-file layout — column order, fixed
 * widths, code lists — must be confirmed against the current SAQA
 * specification before anything is submitted for real. What is built here
 * produces a complete, validated dataset; the final serialisation is a
 * formatting step, not a data-gathering one.
 */

export type ValidationIssue = {
  severity: "blocking" | "warning";
  entity: "person" | "enrolment" | "achievement" | "provider";
  subject: string;
  field: string;
  message: string;
};

export type PersonRecord = {
  nationalId: string | null;
  alternateId: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  gender: string | null;
  equityCode: string | null;
  disabilityCode: string | null;
  nationality: string | null;
};

export type EnrolmentRecord = {
  nationalId: string | null;
  learnerName: string;
  saqaQualificationId: string | null;
  qualificationTitle: string | null;
  providerAccreditationNumber: string | null;
  enrolmentDate: string;
  status: string;
};

export type AchievementRecord = {
  nationalId: string | null;
  learnerName: string;
  moduleCode: string | null;
  moduleTitle: string | null;
  credits: number | null;
  result: string;
  achievedDate: string;
  assessorRegistration: string | null;
  moderatorRegistration: string | null;
  verificationReference: string;
};

export type ProviderRecord = {
  legalName: string;
  accreditationNumber: string | null;
  physicalAddress: string | null;
  wardCode: string | null;
  qualityAssurancePartner: string | null;
};

export type NlrdDataset = {
  provider: ProviderRecord;
  people: PersonRecord[];
  enrolments: EnrolmentRecord[];
  achievements: AchievementRecord[];
  issues: ValidationIssue[];
  /** True when nothing blocking remains, so the return can be submitted. */
  submittable: boolean;
};

function formatDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/**
 * Builds the NLRD dataset and validates it.
 *
 * Everything is reported rather than thrown: a provider needs the complete
 * list of what to fix, not the first problem encountered.
 */
export async function buildNlrdDataset(
  session: AuthenticatedSession,
): Promise<NlrdDataset> {
  assertSessionCan(session, "report:statutory");

  return withTenant(session.organisationId, async (tx) => {
    const issues: ValidationIssue[] = [];

    // ---------------------------------------------------------- Provider (30)
    const [organisation] = await tx
      .select()
      .from(organisations)
      .where(eq(organisations.id, session.organisationId));

    const address = organisation.physicalAddress;
    const provider: ProviderRecord = {
      legalName: organisation.legalName,
      accreditationNumber: organisation.accreditationNumber,
      physicalAddress: address
        ? [address.line1, address.line2, address.city, address.province, address.postalCode]
            .filter(Boolean)
            .join(", ")
        : null,
      wardCode: organisation.wardCode,
      qualityAssurancePartner: organisation.qualityAssurancePartner,
    };

    if (!provider.accreditationNumber) {
      issues.push({
        severity: "blocking",
        entity: "provider",
        subject: organisation.legalName,
        field: "accreditation number",
        message:
          "The provider accreditation number is missing. Every record in the return is filed against it.",
      });
    }

    if (!provider.wardCode) {
      issues.push({
        severity: "warning",
        entity: "provider",
        subject: organisation.legalName,
        field: "ward code",
        message:
          "No municipal ward code recorded. The Provider Record is validated down to ward level.",
      });
    }

    // ------------------------------------------------------------ People (27)
    const learners = await tx
      .select()
      .from(users)
      .where(eq(users.status, "active"))
      .orderBy(asc(users.lastName), asc(users.firstName));

    const people: PersonRecord[] = learners.map((learner) => {
      const name = `${learner.firstName} ${learner.lastName}`;

      if (!learner.nationalId) {
        issues.push({
          severity: "blocking",
          entity: "person",
          subject: name,
          field: "national ID",
          message: "No identity number recorded.",
        });
      } else {
        const check = validateSouthAfricanId(learner.nationalId);
        if (!check.valid) {
          issues.push({
            severity: "blocking",
            entity: "person",
            subject: name,
            field: "national ID",
            message: check.reason,
          });
        }
      }

      if (!learner.equityCode) {
        issues.push({
          severity: "warning",
          entity: "person",
          subject: name,
          field: "equity code",
          message: "No equity code recorded; the NLRD flags missing equity data.",
        });
      }

      if (!learner.disabilityCode) {
        issues.push({
          severity: "warning",
          entity: "person",
          subject: name,
          field: "disability code",
          message: "No disability status recorded.",
        });
      }

      return {
        nationalId: learner.nationalId,
        alternateId: null,
        firstName: learner.firstName,
        lastName: learner.lastName,
        dateOfBirth: formatDate(learner.dateOfBirth),
        gender: learner.gender,
        equityCode: learner.equityCode,
        disabilityCode: learner.disabilityCode,
        nationality: learner.nationality,
      };
    });

    // -------------------------------------------------------- Enrolments (28)
    // Only enrolments on a course belonging to an accredited qualification are
    // reportable; internal corporate training is not NLRD business.
    const enrolmentRows = await tx
      .select({
        nationalId: users.nationalId,
        firstName: users.firstName,
        lastName: users.lastName,
        saqaId: qualifications.saqaId,
        qualificationTitle: qualifications.title,
        registrationEndDate: qualifications.registrationEndDate,
        createdAt: enrolments.createdAt,
        status: enrolments.status,
      })
      .from(enrolments)
      .innerJoin(users, eq(users.id, enrolments.userId))
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .innerJoin(
        curriculumModules,
        eq(curriculumModules.id, courses.curriculumModuleId),
      )
      .innerJoin(
        qualifications,
        eq(qualifications.id, curriculumModules.qualificationId),
      )
      .orderBy(asc(users.lastName));

    const enrolmentRecords: EnrolmentRecord[] = enrolmentRows.map((row) => {
      const name = `${row.firstName} ${row.lastName}`;

      if (!row.saqaId) {
        issues.push({
          severity: "blocking",
          entity: "enrolment",
          subject: `${name} — ${row.qualificationTitle}`,
          field: "SAQA qualification ID",
          message:
            "The qualification has no SAQA ID, so the enrolment cannot be filed against it.",
        });
      }

      // The framework requires the provider's accreditation to be valid for
      // the qualification's registration window at the time of enrolment.
      if (
        row.registrationEndDate &&
        row.createdAt > row.registrationEndDate
      ) {
        issues.push({
          severity: "blocking",
          entity: "enrolment",
          subject: `${name} — ${row.qualificationTitle}`,
          field: "enrolment date",
          message:
            "The learner was enrolled after the qualification's registration period closed.",
        });
      }

      return {
        nationalId: row.nationalId,
        learnerName: name,
        saqaQualificationId: row.saqaId,
        qualificationTitle: row.qualificationTitle,
        providerAccreditationNumber: provider.accreditationNumber,
        enrolmentDate: formatDate(row.createdAt)!,
        status: row.status,
      };
    });

    // ------------------------------------------------------ Achievements (29)
    // An achievement is a live certificate: a completed, judged and where
    // required moderated outcome. Nothing weaker is reportable.
    const issued = await tx
      .select({
        certificateId: certificates.id,
        reference: certificates.verificationReference,
        issuedAt: certificates.issuedAt,
        userId: certificates.userId,
        enrolmentId: certificates.enrolmentId,
        nationalId: users.nationalId,
        firstName: users.firstName,
        lastName: users.lastName,
        courseId: enrolments.courseId,
      })
      .from(certificates)
      .innerJoin(users, eq(users.id, certificates.userId))
      .innerJoin(enrolments, eq(enrolments.id, certificates.enrolmentId))
      .where(isNull(certificates.revokedAt))
      .orderBy(desc(certificates.issuedAt));

    const achievements: AchievementRecord[] = [];

    for (const row of issued) {
      const name = `${row.firstName} ${row.lastName}`;

      const [module] = await tx
        .select({
          code: curriculumModules.code,
          title: curriculumModules.title,
          credits: curriculumModules.credits,
        })
        .from(courses)
        .innerJoin(
          curriculumModules,
          eq(curriculumModules.id, courses.curriculumModuleId),
        )
        .where(eq(courses.id, row.courseId!));

      // Not part of an accredited qualification: a real achievement for the
      // client, but not one the NLRD wants.
      if (!module) continue;

      const [judgement] = await tx
        .select({
          assessorId: assessmentDecisions.assessorId,
          moderatorId: moderationRecords.moderatorId,
        })
        .from(assessmentDecisions)
        .innerJoin(
          assessmentSubmissions,
          eq(assessmentSubmissions.id, assessmentDecisions.submissionId),
        )
        .innerJoin(
          assessments,
          eq(assessments.id, assessmentSubmissions.assessmentId),
        )
        .leftJoin(
          moderationRecords,
          eq(moderationRecords.decisionId, assessmentDecisions.id),
        )
        .where(
          and(
            eq(assessmentSubmissions.userId, row.userId),
            eq(assessments.courseId, row.courseId!),
          ),
        )
        .orderBy(desc(assessmentDecisions.signedAt))
        .limit(1);

      const assessorRegistration = judgement?.assessorId
        ? await registrationNumberFor(tx, judgement.assessorId, "assessor")
        : null;
      const moderatorRegistration = judgement?.moderatorId
        ? await registrationNumberFor(tx, judgement.moderatorId, "moderator")
        : null;

      if (judgement?.assessorId && !assessorRegistration) {
        issues.push({
          severity: "blocking",
          entity: "achievement",
          subject: `${name} — ${module.code}`,
          field: "assessor registration",
          message:
            "The assessor has no registration number recorded. The NLRD verifies assessor registration against the achievement.",
        });
      }

      if (judgement?.moderatorId && !moderatorRegistration) {
        issues.push({
          severity: "warning",
          entity: "achievement",
          subject: `${name} — ${module.code}`,
          field: "moderator registration",
          message: "The moderator has no registration number recorded.",
        });
      }

      if (module.credits === null) {
        issues.push({
          severity: "warning",
          entity: "achievement",
          subject: `${name} — ${module.code}`,
          field: "credits",
          message: "The curriculum module has no credit value recorded.",
        });
      }

      achievements.push({
        nationalId: row.nationalId,
        learnerName: name,
        moduleCode: module.code,
        moduleTitle: module.title,
        credits: module.credits,
        result: "competent",
        achievedDate: formatDate(row.issuedAt)!,
        assessorRegistration,
        moderatorRegistration,
        verificationReference: row.reference,
      });
    }

    return {
      provider,
      people,
      enrolments: enrolmentRecords,
      achievements,
      issues,
      submittable: !issues.some((issue) => issue.severity === "blocking"),
    };
  });
}

async function registrationNumberFor(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  userId: string,
  role: "assessor" | "moderator",
): Promise<string | null> {
  const [row] = await tx
    .select({ registrationNumber: userRoles.registrationNumber })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.role, role)));

  return row?.registrationNumber ?? null;
}

/** The four NLRD files, as CSV. */
export function nlrdCsv(dataset: NlrdDataset): Record<string, string> {
  return {
    "provider-record-30": toCsv(
      [
        "Legal name",
        "Accreditation number",
        "Physical address",
        "Ward code",
        "Quality assurance partner",
      ],
      [
        [
          dataset.provider.legalName,
          dataset.provider.accreditationNumber,
          dataset.provider.physicalAddress,
          dataset.provider.wardCode,
          dataset.provider.qualityAssurancePartner,
        ],
      ],
    ),

    "person-record-27": toCsv(
      [
        "National ID",
        "First name",
        "Last name",
        "Date of birth",
        "Gender",
        "Equity code",
        "Disability code",
        "Nationality",
      ],
      dataset.people.map((person) => [
        person.nationalId,
        person.firstName,
        person.lastName,
        person.dateOfBirth,
        person.gender,
        person.equityCode,
        person.disabilityCode,
        person.nationality,
      ]),
    ),

    "enrolment-record-28": toCsv(
      [
        "National ID",
        "Learner",
        "SAQA qualification ID",
        "Qualification",
        "Provider accreditation number",
        "Enrolment date",
        "Status",
      ],
      dataset.enrolments.map((row) => [
        row.nationalId,
        row.learnerName,
        row.saqaQualificationId,
        row.qualificationTitle,
        row.providerAccreditationNumber,
        row.enrolmentDate,
        row.status,
      ]),
    ),

    "achievement-record-29": toCsv(
      [
        "National ID",
        "Learner",
        "Module code",
        "Module",
        "Credits",
        "Result",
        "Achieved",
        "Assessor registration",
        "Moderator registration",
        "Verification reference",
      ],
      dataset.achievements.map((row) => [
        row.nationalId,
        row.learnerName,
        row.moduleCode,
        row.moduleTitle,
        row.credits,
        row.result,
        row.achievedDate,
        row.assessorRegistration,
        row.moderatorRegistration,
        row.verificationReference,
      ]),
    ),
  };
}

// ---------------------------------------------------------------------------
// Workplace Skills Plan and Annual Training Report
// ---------------------------------------------------------------------------

export type WspAtrRow = {
  ofoCode: string | null;
  jobTitle: string | null;
  team: string | null;
  headcount: number;
  trainedCount: number;
  completions: number;
  certificates: number;
};

/**
 * Training activity grouped by OFO code, which is how a SETA return is
 * organised. Feeds both halves of the annual submission: what was delivered
 * (ATR) and what is planned (WSP).
 */
export async function buildWspAtr(
  session: AuthenticatedSession,
): Promise<{ rows: WspAtrRow[]; missingOfoCodes: string[] }> {
  assertSessionCan(session, "report:statutory");

  return withTenant(session.organisationId, async (tx) => {
    const people = await tx
      .select({
        id: users.id,
        ofoCode: users.ofoCode,
        jobTitle: users.jobTitle,
        team: users.team,
      })
      .from(users)
      .where(eq(users.status, "active"));

    const enrolmentRows = await tx
      .select({ userId: enrolments.userId, status: enrolments.status })
      .from(enrolments);

    const certificateRows = await tx
      .select({ userId: certificates.userId })
      .from(certificates)
      .where(isNull(certificates.revokedAt));

    const grouped = new Map<string, WspAtrRow>();

    for (const person of people) {
      // Grouped by occupation, falling back to job title so people without a
      // code still appear rather than silently dropping out of the return.
      const key = person.ofoCode ?? `untitled:${person.jobTitle ?? "unknown"}`;

      const row =
        grouped.get(key) ??
        ({
          ofoCode: person.ofoCode,
          jobTitle: person.jobTitle,
          team: person.team,
          headcount: 0,
          trainedCount: 0,
          completions: 0,
          certificates: 0,
        } satisfies WspAtrRow);

      row.headcount += 1;

      const theirEnrolments = enrolmentRows.filter(
        (enrolment) => enrolment.userId === person.id,
      );
      if (theirEnrolments.length > 0) row.trainedCount += 1;
      row.completions += theirEnrolments.filter(
        (enrolment) => enrolment.status === "completed",
      ).length;
      row.certificates += certificateRows.filter(
        (certificate) => certificate.userId === person.id,
      ).length;

      grouped.set(key, row);
    }

    return {
      rows: [...grouped.values()].sort((a, b) =>
        (a.ofoCode ?? "zzz").localeCompare(b.ofoCode ?? "zzz"),
      ),
      missingOfoCodes: people
        .filter((person) => !person.ofoCode)
        .map((person) => person.jobTitle ?? "Unknown role"),
    };
  });
}

export function wspAtrCsv(rows: WspAtrRow[]): string {
  return toCsv(
    [
      "OFO code",
      "Job title",
      "Team",
      "Headcount",
      "People trained",
      "Completions",
      "Certificates issued",
    ],
    rows.map((row) => [
      row.ofoCode,
      row.jobTitle,
      row.team,
      row.headcount,
      row.trainedCount,
      row.completions,
      row.certificates,
    ]),
  );
}
