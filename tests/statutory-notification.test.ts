/**
 * Telling the QCTO that learners have been enrolled.
 *
 * The clock runs from induction - twenty-one working days for a qualification,
 * five for a skills programme - and missing it means the learners are not
 * registered, so their results have nowhere to go when they finish.
 *
 * The tests that matter most here are the ones about the shape of the file
 * rather than the arithmetic. Heidi named the leading zero on 9 September as
 * the thing that makes their submissions manual: Excel turns `01` into `1` and
 * the loader rejects the whole workbook. That has to survive all the way into
 * the CSV, not just into the database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import {
  cohortMembers,
  cohorts,
  cohortSessions,
  courses,
  enrolments,
  learnerProfiles,
  organisations,
  qualifications,
  userRoles,
  users,
} from "@/db/schema";
import {
  buildLeisa,
  daysAllowedFor,
  draftNotification,
  LEISA_COLUMNS,
  leisaCsv,
  listNotifications,
  markSubmitted,
  notificationDue,
  recordAcknowledgement,
  setOwnInduction,
} from "@/lib/statutory-notification";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let cohortId: string;
let onTime: string;
let lateJoiner: string;

const INDUCTION = "2026-03-02"; // a Monday

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "admin@example.test",
    firstName: "Test",
    lastName: "Admin",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

beforeAll(async () => {
  const slug = `leisa-${Date.now()}`;

  const made = await withPlatformScope("leisa fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "LEISA Test Provider",
        status: "active",
        accreditationNumber: "SDP-TEST-001",
      })
      .returning({ id: organisations.id });

    const orgId = organisation.id;

    const [qualification] = await tx
      .insert(qualifications)
      .values({
        organisationId: orgId,
        saqaId: "118273",
        title: "Occupational Certificate: Test",
        kind: "full",
        nqfLevel: 4,
        totalCredits: 120,
      })
      .returning({ id: qualifications.id });

    const [course] = await tx
      .insert(courses)
      .values({
        organisationId: orgId,
        title: "Test Programme",
        status: "published",
      })
      .returning({ id: courses.id });

    const [cohort] = await tx
      .insert(cohorts)
      .values({
        organisationId: orgId,
        courseId: course.id,
        name: "Intake 1",
        status: "running",
        startDate: INDUCTION,
      })
      .returning({ id: cohorts.id });

    // The cohort's induction: what everybody's clock runs from by default.
    await tx.insert(cohortSessions).values({
      organisationId: orgId,
      cohortId: cohort.id,
      kind: "induction",
      scheduledDate: INDUCTION,
      title: "Induction",
    });

    const [staff] = await tx
      .insert(users)
      .values({
        organisationId: orgId,
        email: "admin@leisa.test",
        firstName: "Ada",
        lastName: "Admin",
        status: "active",
      })
      .returning({ id: users.id });
    await tx
      .insert(userRoles)
      .values({ organisationId: orgId, userId: staff.id, role: "tenant_admin" });

    const learners: string[] = [];
    for (const [email, first, last] of [
      ["ontime@leisa.test", "Thandi", "Ontime"],
      ["late@leisa.test", "Sipho", "Latecomer"],
    ] as const) {
      const [learner] = await tx
        .insert(users)
        .values({
          organisationId: orgId,
          email,
          firstName: first,
          lastName: last,
          status: "active",
          nationalId: "9202204720083",
          dateOfBirth: new Date("1992-02-20"),
          gender: "F",
          equityCode: "BA",
          nationality: "SA",
          disabilityCode: "03",
          consentGivenAt: new Date("2026-03-01"),
          consentVersion: "enrolment-form",
        })
        .returning({ id: users.id });
      await tx
        .insert(userRoles)
        .values({ organisationId: orgId, userId: learner.id, role: "learner" });
      await tx.insert(cohortMembers).values({
        organisationId: orgId,
        cohortId: cohort.id,
        userId: learner.id,
      });
      await tx.insert(enrolments).values({
        organisationId: orgId,
        userId: learner.id,
        courseId: course.id,
        qualificationId: qualification.id,
      });
      // A complete enrolment form, so the workbook has something to write.
      await tx.insert(learnerProfiles).values({
        organisationId: orgId,
        userId: learner.id,
        homeLanguageCode: "Zul",
        citizenResidentStatusCode: "SA",
        socioeconomicStatusCode: "01",
        disabilityRating: "02",
        immigrantStatus: "03",
        homeAddress1: "12 Kort Street",
        homeAddressPostalCode: "2196",
        cellPhoneNumber: "0821234567",
        provinceCode: "7",
        statssaAreaCode: "798001",
        confirmedAt: new Date(),
      });
      learners.push(learner.id);
    }

    return { orgId, staff: staff.id, cohort: cohort.id, learners };
  });

  organisationId = made.orgId;
  cohortId = made.cohort;
  onTime = made.learners[0];
  lateJoiner = made.learners[1];
  admin = sessionFor(["tenant_admin"], made.staff);
});

afterAll(async () => {
  await withPlatformScope("leisa teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("how long there is", () => {
  it("gives twenty-one working days for a qualification and five for a skills programme", () => {
    expect(daysAllowedFor("full")).toBe(21);
    expect(daysAllowedFor("part")).toBe(21);
    expect(daysAllowedFor("skills_programme")).toBe(5);
  });

  it("assumes the longer window for anything it does not recognise", () => {
    // An enrolment with no qualification is not a statutory enrolment; being
    // wrong in the generous direction here is the safe way to be wrong.
    expect(daysAllowedFor(null)).toBe(21);
  });
});

describe("who has to be notified", () => {
  it("dates the deadline from the cohort's induction", async () => {
    const due = await notificationDue(admin, "2026-03-03");
    const mine = due.find((d) => d.userId === onTime);

    expect(mine?.inductionOn).toBe(INDUCTION);
    /**
     * Twenty-one working days from Monday 2 March 2026 is Tuesday 31 March.
     * No public holiday falls inside that window - Human Rights Day is the
     * 21st, a Saturday, and Good Friday is 3 April, just past the end - so the
     * deadline is the plain count. An earlier version of this test claimed
     * Good Friday pushed it out by a day, which was simply wrong about where
     * the window ended.
     */
    expect(mine?.dueOn).toBe("2026-03-31");
    expect(mine?.state).toBe("in_hand");
  });

  it("reports somebody past their date as overdue", async () => {
    const due = await notificationDue(admin, "2026-05-01");
    expect(due.find((d) => d.userId === onTime)?.state).toBe("overdue");
  });

  it("warns when the deadline is close", async () => {
    const due = await notificationDue(admin, "2026-03-27");
    expect(due.find((d) => d.userId === onTime)?.state).toBe("due_soon");
  });

  /**
   * Heidi, 9 September: a late joiner "needs their own induction, their own
   * enrolment form, and their own LEISA submitted alongside the cohort's". So
   * the deadline is per learner, and setting an induction moves only theirs.
   */
  it("gives a late joiner their own deadline", async () => {
    await setOwnInduction(admin, cohortId, lateJoiner, "2026-04-13");

    const due = await notificationDue(admin, "2026-04-14");
    const late = due.find((d) => d.userId === lateJoiner);
    const early = due.find((d) => d.userId === onTime);

    expect(late?.inductionOn).toBe("2026-04-13");
    expect(late?.state).toBe("in_hand");
    // The cohort's own deadline has long passed; the two are independent.
    expect(early?.state).toBe("overdue");
    expect(late?.dueOn).not.toBe(early?.dueOn);
  });

  it("says so when there is no induction date to count from", async () => {
    await withPlatformScope("no induction", (tx) =>
      tx.delete(cohortSessions).where(eq(cohortSessions.cohortId, cohortId)),
    );

    const due = await notificationDue(admin, "2026-03-03");
    expect(due.find((d) => d.userId === onTime)?.state).toBe("no_induction");

    // Put it back for the tests that follow.
    await withPlatformScope("restore induction", (tx) =>
      tx.insert(cohortSessions).values({
        organisationId,
        cohortId,
        kind: "induction",
        scheduledDate: INDUCTION,
        title: "Induction",
      }),
    );
  });
});

describe("the submission", () => {
  let notificationId: string;

  it("is drafted against the learners it covers", async () => {
    const notification = await draftNotification(admin, {
      title: "Intake 1 enrolment",
      cohortId,
      inductionOn: INDUCTION,
      kind: "full",
      learnerIds: [onTime],
    });

    notificationId = notification.id;
    expect(notification.status).toBe("draft");
    expect(notification.dueOn).toBe("2026-03-31");
  });

  it("records that it went, and stops counting that learner as outstanding", async () => {
    await markSubmitted(admin, notificationId);

    const due = await notificationDue(admin, "2026-05-01");
    expect(due.find((d) => d.userId === onTime)?.state).toBe("notified");
    // The late joiner is on their own submission and is untouched by this one.
    expect(due.find((d) => d.userId === lateJoiner)?.state).not.toBe("notified");
  });

  it("records what came back", async () => {
    const updated = await recordAcknowledgement(admin, notificationId, {
      reference: "QCTO-ACK-2026-0412",
      acknowledgedOn: "2026-04-02",
    });

    expect(updated.status).toBe("acknowledged");
    expect(updated.acknowledgementReference).toBe("QCTO-ACK-2026-0412");
  });

  it("refuses an acknowledgement with no reference", async () => {
    await expect(
      recordAcknowledgement(admin, notificationId, {
        reference: "  ",
        acknowledgedOn: "2026-04-02",
      }),
    ).rejects.toMatchObject({ reason: "invalid" });
  });

  it("lists what has been sent, with how many it covered", async () => {
    const all = await listNotifications(admin);
    const mine = all.find((n) => n.id === notificationId);

    expect(mine?.learners).toBe(1);
    expect(mine?.cohortName).toBe("Intake 1");
  });
});

describe("the workbook", () => {
  let notificationId: string;

  beforeAll(async () => {
    const notification = await draftNotification(admin, {
      title: "Workbook test",
      cohortId,
      inductionOn: INDUCTION,
      kind: "full",
      learnerIds: [onTime, lateJoiner],
    });
    notificationId = notification.id;
  });

  it("has the QCTO's forty-three columns in their own order", () => {
    expect(LEISA_COLUMNS).toHaveLength(43);
    expect(LEISA_COLUMNS[0]).toBe("SDPCode");
    expect(LEISA_COLUMNS[42]).toBe("DateStamp");
  });

  it("writes a row for every learner it covers", async () => {
    const workbook = await buildLeisa(admin, notificationId);
    expect(workbook.rows).toHaveLength(2);
    expect(workbook.rows.map((r) => r.LearnerLastName).sort()).toEqual([
      "Latecomer",
      "Ontime",
    ]);
  });

  /**
   * The one Heidi named. A cell holding `1` where the loader wants `01` fails
   * the whole file, and Excel eats the zero the moment the cell is not text.
   */
  it("keeps the leading zero all the way into the CSV", async () => {
    const workbook = await buildLeisa(admin, notificationId);
    const csv = leisaCsv(workbook);

    const row = workbook.rows[0];
    expect(row.SocioeconomicStatusCode).toBe("'01");
    expect(row.DisabilityStatusCode).toBe("'03");
    expect(row.DisabilityRating).toBe("'02");
    expect(row.ImmigrantStatus).toBe("'03");

    // And it survives into the file itself, which is what actually gets sent.
    expect(csv).toContain("'01");
    expect(csv).toContain("'02");
  });

  it("leaves a value alone that never had a zero to lose", async () => {
    const workbook = await buildLeisa(admin, notificationId);
    expect(workbook.rows[0].ProvinceCode).toBe("7");
    expect(workbook.rows[0].GenderCode).toBe("F");
  });

  it("carries the provider's own SDP code and the qualification", async () => {
    const workbook = await buildLeisa(admin, notificationId);
    expect(workbook.rows[0].SDPCode).toBe("SDP-TEST-001");
    expect(workbook.rows[0].QualificationId).toBe("118273");
  });

  it("writes POPIA as an answer and a date", async () => {
    const workbook = await buildLeisa(admin, notificationId);
    expect(workbook.rows[0].POPIActAgree).toBe("Y");
    expect(workbook.rows[0].POPIActDate).toBe("2026-03-01");
  });

  it("has a header row with every column, in order", async () => {
    const csv = leisaCsv(await buildLeisa(admin, notificationId));
    expect(csv.split("\r\n")[0]).toBe(LEISA_COLUMNS.join(","));
  });

  /**
   * Reported rather than thrown. A workbook ten learners short is still worth
   * looking at, and a coordinator needs every gap at once instead of finding
   * them one upload at a time.
   */
  it("reports what would be rejected instead of refusing to build", async () => {
    await withPlatformScope("break a profile", (tx) =>
      tx
        .update(learnerProfiles)
        .set({ statssaAreaCode: null, cellPhoneNumber: null })
        .where(inArray(learnerProfiles.userId, [lateJoiner])),
    );

    const workbook = await buildLeisa(admin, notificationId);

    expect(workbook.rows).toHaveLength(2);
    const fields = workbook.problems
      .filter((p) => p.learner.includes("Latecomer"))
      .map((p) => p.field);
    expect(fields).toContain("STATSSA area code");
    expect(fields).toContain("Cell phone");
    // Said in a person's words, with a reason worth reading.
    expect(
      workbook.problems.every((p) => p.why.length > 10),
    ).toBe(true);
  });
});

describe("who may do this", () => {
  it("keeps a learner out of the submission list", async () => {
    const learner = sessionFor(["learner"], onTime);
    await expect(notificationDue(learner, "2026-03-03")).rejects.toThrow();
    await expect(listNotifications(learner)).rejects.toThrow();
  });
});

/**
 * The join between the two pieces of work.
 *
 * `lib/public-holidays.ts` proves the arithmetic and `notificationDue` proves
 * the deadline, but neither proves that the deadline is told about the
 * holidays. Until this morning nothing in the platform was, and every test
 * passed anyway - so this is the one that would have caught it.
 */
describe("a deadline that runs through December", () => {
  it("lands later than a naive count, because of the holidays inside it", async () => {
    const { addWorkingDays } = await import("@/lib/working-days");

    // Induction on 1 December 2026. Sixteen December, Christmas, the Day of
    // Goodwill and New Year's Day all fall inside the twenty-one working days.
    await setOwnInduction(admin, cohortId, lateJoiner, "2026-12-01");

    const due = await notificationDue(admin, "2026-12-02");
    const late = due.find((d) => d.userId === lateJoiner);

    const naive = addWorkingDays("2026-12-01", 21);

    expect(late?.dueOn).toBeTruthy();
    expect(late!.dueOn! > naive).toBe(true);
    /**
     * Naively the deadline is 30 December. Four holidays fall in the window,
     * but only three of them cost a working day: 16 December is a Wednesday,
     * Christmas a Friday and New Year's Day a Friday, while the Day of
     * Goodwill lands on the Saturday and costs nothing. Three working days
     * later than 30 December, skipping the New Year weekend, is 4 January.
     *
     * Counted from the calendar rather than assumed - a first version of this
     * test said four days and was wrong, because it forgot that a holiday at a
     * weekend was never a working day to begin with.
     */
    expect(naive).toBe("2026-12-30");
    expect(late?.dueOn).toBe("2027-01-04");
  });
});
