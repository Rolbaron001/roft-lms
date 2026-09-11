import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  cohortMembers,
  cohortSessions,
  cohorts,
  courses,
  enrolments,
  learnerProfiles,
  organisations,
  qualifications,
  statutoryNotificationLearners,
  statutoryNotifications,
  users,
} from "@/db/schema";
import { addWorkingDays, workingDaysBetween } from "./working-days";
import { holidaysForTenant } from "./tenant-holidays";
import { forSpreadsheet, labelFor } from "./learner-codes";
import { recordAudit } from "./audit";
import { assertSessionCan, type AuthenticatedSession } from "./session";

/**
 * Telling the QCTO that learners have been enrolled, and proving it was done.
 *
 * The clock runs from the **induction date** - Heidi, 9 September - not from
 * the enrolment, the payment or the first lecture. Twenty-one working days for
 * a full or part qualification, five for a skills programme.
 *
 * Missing the deadline is not a paperwork slip. The learners are not
 * registered, so when they finish there is nowhere for their results to go, and
 * the fix is a late submission with an explanation rather than a form.
 *
 * Three things follow from Heidi's answer and shape this file.
 *
 * **The deadline is per learner, not per cohort.** A late joiner "needs their
 * own induction, their own enrolment form, and their own LEISA submitted
 * alongside the cohort's". So a cohort's deadline is the deadline of whoever
 * was inducted with it, and anybody inducted later carries their own.
 *
 * **Five days is not twenty-one.** A skills programme runs on a much shorter
 * clock, and the difference is easy to miss because both are "the notification
 * deadline". The kind comes from the qualification, so nobody has to remember.
 *
 * **Working days skip public holidays.** See lib/public-holidays.ts; until
 * today nothing in the platform did, which made every deadline land early.
 */

export class NotificationError extends Error {
  constructor(
    message: string,
    readonly reason: "not_found" | "invalid" | "already_submitted",
  ) {
    super(message);
    this.name = "NotificationError";
  }
}

/** Working days allowed, by what the learner is enrolled on. */
export const DAYS_TO_NOTIFY = {
  full: 21,
  part: 21,
  skills_programme: 5,
} as const;

export type ProgrammeKind = keyof typeof DAYS_TO_NOTIFY;

/**
 * How long there is to notify, for a given kind.
 *
 * A named function rather than a lookup at each call site, so that the one
 * place the rule lives is the one place it can be got wrong.
 */
export function daysAllowedFor(kind: ProgrammeKind | null): number {
  // An enrolment with no qualification attached is not a statutory enrolment;
  // the longer window is the safe assumption for anything unrecognised.
  return kind ? DAYS_TO_NOTIFY[kind] : 21;
}

export type LearnerDue = {
  userId: string;
  firstName: string;
  lastName: string;
  cohortId: string | null;
  cohortName: string | null;
  programme: string | null;
  kind: ProgrammeKind | null;
  inductionOn: string | null;
  /** Null when there is no induction date to count from. */
  dueOn: string | null;
  /** Negative once the deadline has passed. */
  workingDaysLeft: number | null;
  notifiedOn: string | null;
  state: "notified" | "overdue" | "due_soon" | "in_hand" | "no_induction";
};

/**
 * Everybody who has to be notified, and where each one stands.
 *
 * Returns learners rather than cohorts because that is where the obligation
 * actually sits. A coordinator reading this wants to know who is at risk, and
 * a cohort where one late joiner is overdue and everybody else is fine is not
 * usefully described by a single cohort-level status.
 */
export async function notificationDue(
  session: AuthenticatedSession,
  asAt: string,
): Promise<LearnerDue[]> {
  assertSessionCan(session, "enrolment:read_all");

  const holidays = await holidaysForTenant(session.organisationId, asAt);

  return withTenant(session.organisationId, async (tx) => {
    const members = await tx
      .select({
        userId: cohortMembers.userId,
        firstName: users.firstName,
        lastName: users.lastName,
        cohortId: cohorts.id,
        cohortName: cohorts.name,
        ownInduction: cohortMembers.inductionOn,
        programme: courses.title,
      })
      .from(cohortMembers)
      .innerJoin(cohorts, eq(cohorts.id, cohortMembers.cohortId))
      .innerJoin(courses, eq(courses.id, cohorts.courseId))
      .innerJoin(users, eq(users.id, cohortMembers.userId))
      .where(isNull(cohortMembers.leftAt));

    if (members.length === 0) return [];

    // The cohort's own induction, for everybody who did not have their own.
    const inductions = await tx
      .select({
        cohortId: cohortSessions.cohortId,
        on: cohortSessions.scheduledDate,
      })
      .from(cohortSessions)
      .where(eq(cohortSessions.kind, "induction"));

    // What each learner is enrolled on, which decides five days or twenty-one.
    const enrolled = await tx
      .select({
        userId: enrolments.userId,
        kind: qualifications.kind,
      })
      .from(enrolments)
      .leftJoin(
        qualifications,
        eq(qualifications.id, enrolments.qualificationId),
      );

    // Who has already been told about, and on which submission.
    const notified = await tx
      .select({
        userId: statutoryNotificationLearners.userId,
        submittedAt: statutoryNotifications.submittedAt,
        status: statutoryNotifications.status,
      })
      .from(statutoryNotificationLearners)
      .innerJoin(
        statutoryNotifications,
        eq(statutoryNotifications.id, statutoryNotificationLearners.notificationId),
      );

    return members.map((member) => {
      const inductionOn =
        member.ownInduction ??
        inductions.find((i) => i.cohortId === member.cohortId)?.on ??
        null;

      const kind =
        (enrolled.find((e) => e.userId === member.userId)?.kind as
          | ProgrammeKind
          | null) ?? null;

      const already = notified.find(
        (n) => n.userId === member.userId && n.status !== "rejected",
      );

      const dueOn = inductionOn
        ? addWorkingDays(inductionOn, daysAllowedFor(kind), holidays)
        : null;

      const workingDaysLeft = dueOn
        ? workingDaysBetween(asAt, dueOn, holidays)
        : null;

      let state: LearnerDue["state"];
      if (already?.submittedAt) state = "notified";
      else if (!inductionOn) state = "no_induction";
      else if (dueOn && asAt > dueOn) state = "overdue";
      else if (workingDaysLeft !== null && workingDaysLeft <= 5)
        state = "due_soon";
      else state = "in_hand";

      return {
        userId: member.userId,
        firstName: member.firstName,
        lastName: member.lastName,
        cohortId: member.cohortId,
        cohortName: member.cohortName,
        programme: member.programme,
        kind,
        inductionOn,
        dueOn,
        workingDaysLeft,
        notifiedOn: already?.submittedAt?.toISOString().slice(0, 10) ?? null,
        state,
      };
    });
  });
}

/**
 * A learner's own induction date, where it differs from the cohort's.
 *
 * The late-joiner path. Setting it moves that learner's deadline and takes them
 * off the cohort's submission, because they now need their own.
 */
export async function setOwnInduction(
  session: AuthenticatedSession,
  cohortId: string,
  userId: string,
  inductionOn: string | null,
) {
  assertSessionCan(session, "enrolment:manage");

  if (inductionOn && !/^\d{4}-\d{2}-\d{2}$/.test(inductionOn)) {
    throw new NotificationError("That is not a date.", "invalid");
  }

  return withTenant(session.organisationId, async (tx) => {
    const [updated] = await tx
      .update(cohortMembers)
      .set({ inductionOn })
      .where(
        and(eq(cohortMembers.cohortId, cohortId), eq(cohortMembers.userId, userId)),
      )
      .returning();

    if (!updated) {
      throw new NotificationError("That learner is not in the cohort.", "not_found");
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "statutory.own_induction_set",
      entityType: "cohort_member",
      entityId: updated.id,
      after: { userId, inductionOn },
    });

    return updated;
  });
}

export const notificationInput = z.object({
  title: z.string().trim().min(1).max(200),
  cohortId: z.string().uuid().nullable().optional(),
  inductionOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(["full", "part", "skills_programme"]).optional(),
  learnerIds: z.array(z.string().uuid()).min(1),
});

export type NotificationInput = z.infer<typeof notificationInput>;

/**
 * Opens a submission covering a named set of learners.
 *
 * Drafted rather than sent: the workbook has to be produced, checked and
 * uploaded to the QCTO by a person, and the platform's job is to know what was
 * sent and when rather than to pretend it did the sending.
 */
export async function draftNotification(
  session: AuthenticatedSession,
  input: NotificationInput,
) {
  assertSessionCan(session, "report:statutory");

  const parsed = notificationInput.parse(input);
  const holidays = await holidaysForTenant(
    session.organisationId,
    parsed.inductionOn,
  );
  const dueOn = addWorkingDays(
    parsed.inductionOn,
    daysAllowedFor(parsed.kind ?? null),
    holidays,
  );

  return withTenant(session.organisationId, async (tx) => {
    const [notification] = await tx
      .insert(statutoryNotifications)
      .values({
        organisationId: session.organisationId,
        cohortId: parsed.cohortId ?? null,
        title: parsed.title,
        inductionOn: parsed.inductionOn,
        dueOn,
        status: "draft",
      })
      .returning();

    await tx.insert(statutoryNotificationLearners).values(
      parsed.learnerIds.map((userId) => ({
        organisationId: session.organisationId,
        notificationId: notification.id,
        userId,
      })),
    );

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "statutory.notification_drafted",
      entityType: "statutory_notification",
      entityId: notification.id,
      after: { title: parsed.title, dueOn, learners: parsed.learnerIds.length },
    });

    return notification;
  });
}

/** Records that the submission went, and when. */
export async function markSubmitted(
  session: AuthenticatedSession,
  notificationId: string,
) {
  assertSessionCan(session, "report:statutory");

  return withTenant(session.organisationId, async (tx) => {
    const [updated] = await tx
      .update(statutoryNotifications)
      .set({
        status: "submitted",
        submittedAt: new Date(),
        submittedById: session.userId,
        updatedAt: new Date(),
      })
      .where(eq(statutoryNotifications.id, notificationId))
      .returning();

    if (!updated) throw new NotificationError("No such submission.", "not_found");

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "statutory.notification_submitted",
      entityType: "statutory_notification",
      entityId: notificationId,
      after: { submittedAt: updated.submittedAt },
    });

    return updated;
  });
}

/**
 * Records what came back.
 *
 * A reference and a date, because a submission nobody confirmed receiving is
 * not evidence of anything - and the acknowledgement is what a QCTO monitor
 * asks to see.
 */
export async function recordAcknowledgement(
  session: AuthenticatedSession,
  notificationId: string,
  input: { reference: string; acknowledgedOn: string },
) {
  assertSessionCan(session, "report:statutory");

  if (!input.reference.trim()) {
    throw new NotificationError(
      "An acknowledgement needs the reference the QCTO issued.",
      "invalid",
    );
  }

  return withTenant(session.organisationId, async (tx) => {
    const [updated] = await tx
      .update(statutoryNotifications)
      .set({
        status: "acknowledged",
        acknowledgementReference: input.reference.trim(),
        acknowledgedAt: new Date(`${input.acknowledgedOn}T00:00:00Z`),
        updatedAt: new Date(),
      })
      .where(eq(statutoryNotifications.id, notificationId))
      .returning();

    if (!updated) throw new NotificationError("No such submission.", "not_found");

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "statutory.notification_acknowledged",
      entityType: "statutory_notification",
      entityId: notificationId,
      after: { reference: input.reference },
    });

    return updated;
  });
}

/** Every submission, newest first. */
export async function listNotifications(session: AuthenticatedSession) {
  assertSessionCan(session, "report:statutory");

  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({
        id: statutoryNotifications.id,
        title: statutoryNotifications.title,
        inductionOn: statutoryNotifications.inductionOn,
        dueOn: statutoryNotifications.dueOn,
        status: statutoryNotifications.status,
        submittedAt: statutoryNotifications.submittedAt,
        acknowledgedAt: statutoryNotifications.acknowledgedAt,
        acknowledgementReference:
          statutoryNotifications.acknowledgementReference,
        cohortName: cohorts.name,
      })
      .from(statutoryNotifications)
      .leftJoin(cohorts, eq(cohorts.id, statutoryNotifications.cohortId))
      .orderBy(desc(statutoryNotifications.createdAt));

    const counts = await tx
      .select({
        notificationId: statutoryNotificationLearners.notificationId,
        userId: statutoryNotificationLearners.userId,
      })
      .from(statutoryNotificationLearners);

    return rows.map((row) => ({
      ...row,
      learners: counts.filter((c) => c.notificationId === row.id).length,
    }));
  });
}

// ---------------------------------------------------------------------------
// The LEISA workbook
// ---------------------------------------------------------------------------

/** The forty-three columns, in the QCTO's own order. */
export const LEISA_COLUMNS = [
  "SDPCode", "QualificationId", "NationalId", "LearnerAlternateID",
  "AlternativeIdType", "EquityCode", "NationalityCode", "HomeLanguageCode",
  "GenderCode", "CitizenResidentStatusCode", "SocioeconomicStatusCode",
  "DisabilityStatusCode", "DisabilityRating", "ImmigrantStatus",
  "LearnerLastName", "LearnerFirstName", "LearnerMiddleName", "LearnerTitle",
  "LearnerBirthDate", "LearnerHomeAddress1", "LearnerHomeAddress2",
  "LearnerHomeAddress3", "LearnerPostalAddress1", "LearnerPostalAddress2",
  "LearnerPostalAddress3", "LearnerHomeAddressPostalCode",
  "LearnerPostalAddressPostCode", "LearnerPhoneNumber",
  "LearnerCellPhoneNumber", "LearnerFaxNumber", "LearnerEmailAddress",
  "ProvinceCode", "STATSSAAreaCode", "POPIActAgree", "POPIActDate",
  "ExpectedTrainingCompletionDate", "StatementofResultsStatus",
  "StatementofResultsIssueDate", "AssessmentCentreCode",
  "LearnerReadinessforEISATypeId", "FLC", "FLCStatementofresultnumber",
  "DateStamp",
] as const;

export type LeisaRow = Record<(typeof LEISA_COLUMNS)[number], string>;

export type LeisaWorkbook = {
  rows: LeisaRow[];
  /** What would be rejected, said plainly, before it is sent. */
  problems: { learner: string; field: string; why: string }[];
};

/**
 * Builds the workbook for one submission.
 *
 * Every value is written as the specification wants it, not as it reads best.
 * `forSpreadsheet` puts a leading apostrophe on the codes where a lost zero
 * changes the meaning - Heidi named this on 9 September as what makes their
 * submissions manual today, because Excel turns `01` into `1` the moment a cell
 * is not explicitly text and the loader then rejects the whole file.
 *
 * Problems are reported rather than thrown. A workbook ten learners short is
 * still worth looking at, and the coordinator needs to see every gap at once
 * rather than discovering them one upload at a time.
 */
export async function buildLeisa(
  session: AuthenticatedSession,
  notificationId: string,
): Promise<LeisaWorkbook> {
  assertSessionCan(session, "report:statutory");

  return withTenant(session.organisationId, async (tx) => {
    const [notification] = await tx
      .select()
      .from(statutoryNotifications)
      .where(eq(statutoryNotifications.id, notificationId));

    if (!notification) {
      throw new NotificationError("No such submission.", "not_found");
    }

    const [provider] = await tx
      .select({
        sdpCode: organisations.accreditationNumber,
        name: organisations.displayName,
      })
      .from(organisations)
      .where(eq(organisations.id, session.organisationId));

    const covered = await tx
      .select({ userId: statutoryNotificationLearners.userId })
      .from(statutoryNotificationLearners)
      .where(eq(statutoryNotificationLearners.notificationId, notificationId));

    const ids = covered.map((c) => c.userId);
    if (ids.length === 0) return { rows: [], problems: [] };

    const people = await tx
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        nationalId: users.nationalId,
        dateOfBirth: users.dateOfBirth,
        gender: users.gender,
        equityCode: users.equityCode,
        disabilityCode: users.disabilityCode,
        nationality: users.nationality,
        consentGivenAt: users.consentGivenAt,
      })
      .from(users)
      .where(inArray(users.id, ids));

    const profiles = await tx
      .select()
      .from(learnerProfiles)
      .where(inArray(learnerProfiles.userId, ids));

    const enrolled = await tx
      .select({
        userId: enrolments.userId,
        saqaId: qualifications.saqaId,
        // The date training is expected to finish, which the return asks for.
        completionDate: enrolments.dueDate,
      })
      .from(enrolments)
      .leftJoin(qualifications, eq(qualifications.id, enrolments.qualificationId))
      .where(inArray(enrolments.userId, ids));

    const problems: LeisaWorkbook["problems"] = [];
    const stamp = new Date().toISOString().slice(0, 10);

    const rows = people.map((person) => {
      const profile = profiles.find((p) => p.userId === person.id);
      const enrolment = enrolled.find((e) => e.userId === person.id);
      const who = `${person.firstName} ${person.lastName}`;

      const need = (value: string | null | undefined, field: string, why: string) => {
        if (!value || !String(value).trim()) problems.push({ learner: who, field, why });
        return value ?? "";
      };

      const disability = person.disabilityCode ?? "";

      const row = {
        SDPCode: need(provider?.sdpCode, "SDP code", "The provider's own accreditation number, from the tenant's settings."),
        QualificationId: need(enrolment?.saqaId, "Qualification", "The SAQA identifier of what the learner is enrolled on."),
        NationalId: person.nationalId ?? "",
        LearnerAlternateID: profile?.alternateId ?? "",
        AlternativeIdType: profile?.alternateIdType
          ? labelFor("alternateIdType", profile.alternateIdType)
          : "",
        EquityCode: need(person.equityCode, "Equity code", "Required on every learner record."),
        NationalityCode: need(person.nationality, "Nationality", "Required on every learner record."),
        HomeLanguageCode: need(profile?.homeLanguageCode, "Home language", "From the learner's enrolment form."),
        GenderCode: need(person.gender, "Gender", "Required, and must match the identity number."),
        CitizenResidentStatusCode: need(profile?.citizenResidentStatusCode, "Citizenship", "From the learner's enrolment form."),
        SocioeconomicStatusCode: forSpreadsheet(
          "socioeconomicStatusCode",
          need(profile?.socioeconomicStatusCode, "Employment status", "From the learner's enrolment form."),
        ),
        DisabilityStatusCode: forSpreadsheet("disabilityStatusCode", disability),
        DisabilityRating: forSpreadsheet(
          "disabilityRating",
          disability && disability !== "N"
            ? need(profile?.disabilityRating, "Disability rating", "A disability is recorded, so the QCTO requires how much difficulty it causes.")
            : "",
        ),
        ImmigrantStatus: forSpreadsheet(
          "immigrantStatus",
          need(profile?.immigrantStatus, "Immigrant status", "From the learner's enrolment form."),
        ),
        LearnerLastName: person.lastName,
        LearnerFirstName: person.firstName,
        LearnerMiddleName: profile?.middleName ?? "",
        LearnerTitle: profile?.title ?? "",
        LearnerBirthDate: person.dateOfBirth
          ? person.dateOfBirth.toISOString().slice(0, 10)
          : need(null, "Date of birth", "Required, and it is inside the identity number."),
        LearnerHomeAddress1: need(profile?.homeAddress1, "Home address", "From the learner's enrolment form."),
        LearnerHomeAddress2: profile?.homeAddress2 ?? "",
        LearnerHomeAddress3: profile?.homeAddress3 ?? "",
        LearnerPostalAddress1: profile?.postalAddress1 ?? "",
        LearnerPostalAddress2: profile?.postalAddress2 ?? "",
        LearnerPostalAddress3: profile?.postalAddress3 ?? "",
        LearnerHomeAddressPostalCode: need(profile?.homeAddressPostalCode, "Home postal code", "From the learner's enrolment form."),
        LearnerPostalAddressPostCode: profile?.postalAddressPostalCode ?? "",
        LearnerPhoneNumber: profile?.phoneNumber ?? "",
        LearnerCellPhoneNumber: need(profile?.cellPhoneNumber, "Cell phone", "From the learner's enrolment form."),
        LearnerFaxNumber: profile?.faxNumber ?? "",
        LearnerEmailAddress: person.email,
        ProvinceCode: need(profile?.provinceCode, "Province", "The province the learner works in."),
        STATSSAAreaCode: need(profile?.statssaAreaCode, "STATSSA area code", "From the STATSSA area code list the QCTO publishes."),
        /**
         * POPIA. "Y" and the date, because the return asks for both and
         * consent without a date is not evidence of anything.
         */
        POPIActAgree: person.consentGivenAt ? "Y" : need(null, "POPIA agreement", "The learner has not agreed on the enrolment form."),
        POPIActDate: person.consentGivenAt
          ? person.consentGivenAt.toISOString().slice(0, 10)
          : "",
        ExpectedTrainingCompletionDate: enrolment?.completionDate
          ? enrolment.completionDate.toISOString().slice(0, 10)
          : "",
        // Filled at the end of training, not at enrolment. Empty is correct here.
        StatementofResultsStatus: "",
        StatementofResultsIssueDate: "",
        AssessmentCentreCode: "",
        LearnerReadinessforEISATypeId: "",
        FLC: profile?.flc ?? "",
        FLCStatementofresultnumber: profile?.flcStatementNumber ?? "",
        DateStamp: stamp,
      } as LeisaRow;

      return row;
    });

    return { rows, problems };
  });
}

/**
 * The workbook as a CSV the QCTO's loader will take.
 *
 * A leading apostrophe survives into the file, which is what keeps `01` from
 * becoming `1` when the coordinator opens it in Excel to check it before
 * uploading - the step where the zero was being lost.
 */
export function leisaCsv(workbook: LeisaWorkbook): string {
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const lines = [LEISA_COLUMNS.join(",")];
  for (const row of workbook.rows) {
    lines.push(LEISA_COLUMNS.map((column) => escape(row[column] ?? "")).join(","));
  }
  return lines.join("\r\n");
}
