/**
 * Sessions, registers and attendance, against a live database.
 *
 * The arithmetic here is checked against the client's own consolidated
 * workbook rather than against a number I chose. In their HRM Administrator
 * cohort a learner shows 0.4571428571 overall and 0.8421052632 to date; those
 * are 16 present out of 35 lectures, and 16 out of the 19 held so far. If this
 * file reproduces those two figures from the same shape of data, the two
 * percentages mean what the client means by them.
 *
 * Two exclusions carry as much weight as the totals. A cancelled lecture never
 * happened, so counting it would mark a learner down for the provider's own
 * decision. A walk-in is voluntary, so absence from it is not a fact about the
 * learner at all. Both are tested, because both are the kind of rule that gets
 * quietly dropped in a rewrite and produces a plausible wrong number.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { withPlatformScope } from "@/db/client";
import {
  cohortMembers,
  cohorts as cohortsTable,
  organisations,
  userRoles,
  users,
} from "@/db/schema";
import {
  cohortAttendance,
  cohortSchedule,
  scheduleSession,
  SchedulingError,
  sessionRegister,
  setSessionStatus,
  suggestCohortName,
  takeRegister,
} from "@/lib/scheduling";
import { PermissionDeniedError, permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let courseId: string;
let admin: AuthenticatedSession;
let learnerSession: AuthenticatedSession;

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

function suffix() {
  return Math.random().toString(36).slice(2, 8);
}

/** A cohort with `size` learners in it, and no schedule yet. */
async function cohortWith(size: number) {
  return withPlatformScope("scheduling fixture", async (tx) => {
    const [cohort] = await tx
      .insert(cohortsTable)
      .values({
        organisationId,
        courseId,
        name: `Cohort ${suffix()}`,
        startDate: "2026-01-28",
        status: "running",
      })
      .returning({ id: cohortsTable.id });

    const ids: string[] = [];
    for (let index = 0; index < size; index += 1) {
      const [person] = await tx
        .insert(users)
        .values({
          organisationId,
          email: `sched-${suffix()}@example.test`,
          firstName: `Learner${index}`,
          lastName: "Tester",
          status: "active",
        })
        .returning({ id: users.id });
      await tx
        .insert(userRoles)
        .values({ organisationId, userId: person.id, role: "learner" });
      await tx
        .insert(cohortMembers)
        .values({ organisationId, cohortId: cohort.id, userId: person.id });
      ids.push(person.id);
    }

    return { cohortId: cohort.id, learners: ids };
  });
}

beforeAll(async () => {
  const slug = `sched-${Date.now()}`;

  const created = await withPlatformScope("scheduling setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Scheduling Test Co",
        status: "active",
      })
      .returning({ id: organisations.id });

    const [adminUser] = await tx
      .insert(users)
      .values({
        organisationId: organisation.id,
        email: `admin-${slug}@example.test`,
        firstName: "Ada",
        lastName: "Admin",
        status: "active",
      })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({
      organisationId: organisation.id,
      userId: adminUser.id,
      role: "tenant_admin",
    });

    const [learnerUser] = await tx
      .insert(users)
      .values({
        organisationId: organisation.id,
        email: `learner-${slug}@example.test`,
        firstName: "Leo",
        lastName: "Learner",
        status: "active",
      })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({
      organisationId: organisation.id,
      userId: learnerUser.id,
      role: "learner",
    });

    return {
      organisationId: organisation.id,
      adminId: adminUser.id,
      learnerId: learnerUser.id,
    };
  });

  organisationId = created.organisationId;
  admin = sessionFor(["tenant_admin"], created.adminId);
  learnerSession = sessionFor(["learner"], created.learnerId);

  // A course to hang cohorts from. Cohorts require one; nothing here reads it.
  const { createCourse } = await import("@/lib/authoring");
  const course = await createCourse(admin, { title: `Scheduling ${suffix()}` });
  courseId = course.id;
});

describe("scheduling sessions", () => {
  it("puts a dated lecture on a cohort's schedule", async () => {
    const { cohortId } = await cohortWith(2);

    await scheduleSession(admin, {
      cohortId,
      kind: "induction",
      title: "Induction",
      scheduledDate: "2026-01-28",
      startTime: "18:30",
      endTime: "19:30",
      deliveryMode: "virtual",
      meetingUrl: "https://meet.example.test/induction",
    });
    await scheduleSession(admin, {
      cohortId,
      sequence: 1,
      scheduledDate: "2026-02-03",
      startTime: "18:30",
      endTime: "20:30",
    });

    const schedule = await cohortSchedule(admin, cohortId);

    expect(schedule).toHaveLength(2);
    // In the order it happens, which is how the client reads a roll-out.
    expect(schedule[0].kind).toBe("induction");
    expect(schedule[0].meetingUrl).toBe("https://meet.example.test/induction");
    expect(schedule[1].sequence).toBe(1);
    expect(schedule[1].register.expected).toBe(2);
    expect(schedule[1].register.marked).toBe(0);
  });

  /**
   * A session that ends before it starts is a typing mistake, and one that
   * would otherwise sit on a schedule looking ordinary.
   */
  it("refuses a session that ends before it begins", async () => {
    const { cohortId } = await cohortWith(1);

    await expect(
      scheduleSession(admin, {
        cohortId,
        scheduledDate: "2026-02-03",
        startTime: "20:30",
        endTime: "18:30",
      }),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  /**
   * A gap in a schedule is exactly what a monitoring visit asks about, so the
   * reason is required at the moment the gap is created rather than
   * reconstructed months later.
   */
  it("requires a reason before a session can be cancelled", async () => {
    const { cohortId } = await cohortWith(1);
    const created = await scheduleSession(admin, {
      cohortId,
      scheduledDate: "2026-02-03",
    });

    await expect(
      setSessionStatus(admin, created.id, "cancelled"),
    ).rejects.toMatchObject({ code: "invalid_state" });

    await setSessionStatus(admin, created.id, "cancelled", "Facilitator ill.");
    const schedule = await cohortSchedule(admin, cohortId);
    expect(schedule[0].status).toBe("cancelled");
    expect(schedule[0].statusNote).toBe("Facilitator ill.");
  });

  it("keeps a learner from scheduling anything", async () => {
    const { cohortId } = await cohortWith(1);
    await expect(
      scheduleSession(learnerSession, { cohortId, scheduledDate: "2026-02-03" }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("taking the register", () => {
  it("records who was there, and can be corrected afterwards", async () => {
    const { cohortId, learners } = await cohortWith(3);
    const lecture = await scheduleSession(admin, {
      cohortId,
      sequence: 1,
      scheduledDate: "2026-02-03",
    });

    await takeRegister(admin, lecture.id, [
      { userId: learners[0], status: "present" },
      { userId: learners[1], status: "absent" },
      { userId: learners[2], status: "excused", note: "Medical certificate." },
    ]);

    let register = await sessionRegister(admin, lecture.id);
    expect(register.lines).toHaveLength(3);
    expect(
      register.lines.find((l) => l.userId === learners[1])?.status,
    ).toBe("absent");

    // Somebody arrives late, or a note turns up the following week. The mark
    // is corrected in place rather than added alongside the first one.
    await takeRegister(admin, lecture.id, [
      { userId: learners[1], status: "present" },
    ]);

    register = await sessionRegister(admin, lecture.id);
    expect(register.lines).toHaveLength(3);
    expect(
      register.lines.find((l) => l.userId === learners[1])?.status,
    ).toBe("present");
  });

  /**
   * A register naming somebody who is not on the programme is the kind of
   * thing that survives into a statutory return and then has to be explained.
   */
  it("refuses to mark somebody who is not in the cohort", async () => {
    const a = await cohortWith(1);
    const b = await cohortWith(1);
    const lecture = await scheduleSession(admin, {
      cohortId: a.cohortId,
      scheduledDate: "2026-02-03",
    });

    await expect(
      takeRegister(admin, lecture.id, [
        { userId: b.learners[0], status: "present" },
      ]),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("refuses a register for a lecture that did not happen", async () => {
    const { cohortId, learners } = await cohortWith(1);
    const lecture = await scheduleSession(admin, {
      cohortId,
      scheduledDate: "2026-02-03",
    });
    await setSessionStatus(admin, lecture.id, "cancelled", "Load shedding.");

    await expect(
      takeRegister(admin, lecture.id, [
        { userId: learners[0], status: "absent" },
      ]),
    ).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("keeps a learner from taking a register", async () => {
    const { cohortId, learners } = await cohortWith(1);
    const lecture = await scheduleSession(admin, {
      cohortId,
      scheduledDate: "2026-02-03",
    });
    await expect(
      takeRegister(learnerSession, lecture.id, [
        { userId: learners[0], status: "present" },
      ]),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe("attendance", () => {
  /**
   * The client's own numbers. Thirty-five lectures, nineteen held, sixteen
   * attended: 45.7% overall and 84.2% to date. If these two agree, the
   * platform means what the client means.
   */
  it("reproduces the two percentages the client keeps side by side", async () => {
    const { cohortId, learners } = await cohortWith(1);
    const learnerId = learners[0];

    // 35 lectures, one a week from 5 January 2026.
    const ids: string[] = [];
    for (let index = 0; index < 35; index += 1) {
      const day = new Date(Date.UTC(2026, 0, 5 + index * 7));
      const created = await scheduleSession(admin, {
        cohortId,
        sequence: index + 1,
        scheduledDate: day.toISOString().slice(0, 10),
      });
      ids.push(created.id);
    }

    // Nineteen have been held. Present at sixteen of them.
    const asAt = new Date(Date.UTC(2026, 0, 5 + 18 * 7));
    for (let index = 0; index < 19; index += 1) {
      await takeRegister(admin, ids[index], [
        { userId: learnerId, status: index < 16 ? "present" : "absent" },
      ]);
    }

    const attendance = await cohortAttendance(admin, cohortId, asAt);

    expect(attendance.countable).toBe(35);
    expect(attendance.held).toBe(19);

    const line = attendance.learners.find((l) => l.userId === learnerId)!;
    expect(line.present).toBe(16);
    expect(line.absent).toBe(3);
    expect(line.overallPercent).toBeCloseTo(45.7, 1);
    expect(line.toDatePercent).toBeCloseTo(84.2, 1);
  });

  /**
   * Nobody failed to attend a lecture that did not happen. Counting a
   * cancellation would mark a learner down for the provider's decision.
   */
  it("leaves a cancelled lecture out of both percentages", async () => {
    const { cohortId, learners } = await cohortWith(1);
    const asAt = new Date(Date.UTC(2026, 1, 20));

    const held = await scheduleSession(admin, {
      cohortId,
      sequence: 1,
      scheduledDate: "2026-02-03",
    });
    const scrapped = await scheduleSession(admin, {
      cohortId,
      sequence: 2,
      scheduledDate: "2026-02-10",
    });

    await takeRegister(admin, held.id, [
      { userId: learners[0], status: "present" },
    ]);
    await setSessionStatus(admin, scrapped.id, "cancelled", "Venue flooded.");

    const attendance = await cohortAttendance(admin, cohortId, asAt);

    expect(attendance.countable).toBe(1);
    expect(attendance.held).toBe(1);
    expect(attendance.learners[0].overallPercent).toBe(100);
  });

  /**
   * The workplace walk-in is voluntary by design, so absence from it says
   * nothing and must not depress a rate that a funder or a regulator reads.
   */
  it("leaves the voluntary walk-in out of both percentages", async () => {
    const { cohortId, learners } = await cohortWith(1);
    const asAt = new Date(Date.UTC(2026, 1, 20));

    const lecture = await scheduleSession(admin, {
      cohortId,
      sequence: 1,
      scheduledDate: "2026-02-03",
    });
    await scheduleSession(admin, {
      cohortId,
      kind: "walk_in",
      scheduledDate: "2026-02-10",
    });

    await takeRegister(admin, lecture.id, [
      { userId: learners[0], status: "present" },
    ]);

    const attendance = await cohortAttendance(admin, cohortId, asAt);
    expect(attendance.countable).toBe(1);
    expect(attendance.learners[0].overallPercent).toBe(100);
  });

  /**
   * Early in a programme the overall figure is meaninglessly low while the
   * to-date figure is the honest one. Both are reported precisely so nobody
   * has to pick which single number to trust.
   */
  it("separates progress so far from progress against the whole programme", async () => {
    const { cohortId, learners } = await cohortWith(1);
    const asAt = new Date(Date.UTC(2026, 1, 5));

    const first = await scheduleSession(admin, {
      cohortId,
      sequence: 1,
      scheduledDate: "2026-02-03",
    });
    for (let index = 2; index <= 10; index += 1) {
      await scheduleSession(admin, {
        cohortId,
        sequence: index,
        scheduledDate: `2026-03-${String(index).padStart(2, "0")}`,
      });
    }

    await takeRegister(admin, first.id, [
      { userId: learners[0], status: "present" },
    ]);

    const attendance = await cohortAttendance(admin, cohortId, asAt);
    expect(attendance.countable).toBe(10);
    expect(attendance.held).toBe(1);
    expect(attendance.learners[0].toDatePercent).toBe(100);
    expect(attendance.learners[0].overallPercent).toBe(10);
  });
});

describe("suggestCohortName", () => {
  /** "HRM Administrator Cohort 28012026", which is the client's own format. */
  it("builds the client's cohort name from the programme and induction date", () => {
    expect(suggestCohortName("HRM Administrator", "2026-01-28")).toBe(
      "HRM Administrator Cohort 28012026",
    );
  });

  it("pads a single-digit day and month", () => {
    expect(suggestCohortName("Field Ranger", "2026-03-07")).toBe(
      "Field Ranger Cohort 07032026",
    );
  });

  it("says so rather than producing a name from a date it cannot read", () => {
    expect(() => suggestCohortName("Anything", "not a date")).toThrow(
      SchedulingError,
    );
  });
});

/**
 * The scheduling tables are new, and multi-tenancy is the platform's core
 * commercial promise. tests/tenant-isolation.test.ts already proves that every
 * table carrying an organisation column is covered by row-level security, and
 * these three are. What is proved here is the consequence a person would
 * notice: a second tenant cannot read, mark, or even find another tenant's
 * register through the library the application actually calls.
 */
describe("across tenants", () => {
  it("cannot see, take or reschedule another tenant's register", async () => {
    const mine = await cohortWith(1);
    const lecture = await scheduleSession(admin, {
      cohortId: mine.cohortId,
      scheduledDate: "2026-02-03",
    });
    await takeRegister(admin, lecture.id, [
      { userId: mine.learners[0], status: "present" },
    ]);

    // A second tenant, with its own administrator.
    const otherSlug = `sched-other-${Date.now()}`;
    const other = await withPlatformScope("scheduling isolation", async (tx) => {
      const [organisation] = await tx
        .insert(organisations)
        .values({
          slug: otherSlug,
          legalName: `${otherSlug} Ltd`,
          displayName: "Other Tenant",
          status: "active",
        })
        .returning({ id: organisations.id });
      const [person] = await tx
        .insert(users)
        .values({
          organisationId: organisation.id,
          email: `admin-${otherSlug}@example.test`,
          firstName: "Otto",
          lastName: "Other",
          status: "active",
        })
        .returning({ id: users.id });
      await tx.insert(userRoles).values({
        organisationId: organisation.id,
        userId: person.id,
        role: "tenant_admin",
      });
      return { organisationId: organisation.id, userId: person.id };
    });

    const outsider: AuthenticatedSession = {
      sessionId: "00000000-0000-0000-0000-000000000000",
      userId: other.userId,
      organisationId: other.organisationId,
      email: "other@example.test",
      firstName: "Otto",
      lastName: "Other",
      roles: ["tenant_admin"],
      permissions: permissionsFor({ roles: ["tenant_admin"] }),
      mustChangePassword: false,
    };

    // Not found rather than forbidden: to the other tenant it does not exist,
    // which is the honest answer and the one that leaks nothing.
    await expect(
      sessionRegister(outsider, lecture.id),
    ).rejects.toMatchObject({ code: "not_found" });

    await expect(
      takeRegister(outsider, lecture.id, [
        { userId: mine.learners[0], status: "absent" },
      ]),
    ).rejects.toMatchObject({ code: "not_found" });

    await expect(
      setSessionStatus(outsider, lecture.id, "cancelled", "Not theirs to cancel."),
    ).rejects.toMatchObject({ code: "not_found" });

    // And the schedule and attendance read empty rather than borrowing.
    expect(await cohortSchedule(outsider, mine.cohortId)).toEqual([]);
    const attendance = await cohortAttendance(outsider, mine.cohortId);
    expect(attendance.countable).toBe(0);
    expect(attendance.learners).toEqual([]);

    // The original tenant is unaffected by any of it.
    const register = await sessionRegister(admin, lecture.id);
    expect(register.lines[0].status).toBe("present");
  });
});
