import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { withTenant, type TenantDatabase } from "@/db/client";
import {
  certificates,
  competencies,
  courses,
  enrolments,
  users,
} from "@/db/schema";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { can } from "./rbac";

/**
 * Reporting.
 *
 * The design document is explicit that this platform reports on capability
 * coverage, not completion counts. A list of finished courses tells you people
 * were busy; it does not tell you whether the workforce can do the work. So
 * the central report here is which competencies the workforce actually holds,
 * where nobody holds them, and where exactly one person does.
 *
 * Capability is counted from certificates rather than course completions. A
 * completion means somebody reached the end of the material. A certificate
 * means a judgement was made and, where required, independently moderated.
 * Only the second is evidence.
 */

export type ReportFilters = {
  team?: string;
  site?: string;
  courseId?: string;
};

export type ReportScope =
  | { kind: "tenant" }
  | { kind: "team"; managerId: string }
  | { kind: "self"; userId: string };

/**
 * What this person is allowed to report on.
 *
 * Worked out once, here, rather than being re-derived by each report. A line
 * manager sees their own reports and nobody else's, which is the distinction
 * that stops a reporting screen becoming a way around role restrictions.
 */
export function scopeFor(session: AuthenticatedSession): ReportScope {
  if (can(session, "report:tenant")) return { kind: "tenant" };
  if (can(session, "report:team")) {
    return { kind: "team", managerId: session.userId };
  }
  return { kind: "self", userId: session.userId };
}

/** SQL restricting a query on `users` to the people in scope. */
function peopleInScope(scope: ReportScope, filters: ReportFilters) {
  const clauses = [eq(users.status, "active")];

  if (scope.kind === "team") {
    clauses.push(eq(users.lineManagerId, scope.managerId));
  } else if (scope.kind === "self") {
    clauses.push(eq(users.id, scope.userId));
  }

  if (filters.team) clauses.push(eq(users.team, filters.team));
  if (filters.site) clauses.push(eq(users.site, filters.site));

  return and(...clauses);
}

export type Headline = {
  people: number;
  enrolments: number;
  completed: number;
  overdue: number;
  inProgress: number;
  certificates: number;
  completionRate: number;
};

export async function headlineNumbers(
  session: AuthenticatedSession,
  filters: ReportFilters = {},
): Promise<Headline> {
  assertSessionCan(session, "report:own");
  const scope = scopeFor(session);

  return withTenant(session.organisationId, async (tx) => {
    const people = await tx
      .select({ id: users.id })
      .from(users)
      .where(peopleInScope(scope, filters));

    const ids = people.map((person) => person.id);

    if (ids.length === 0) {
      return {
        people: 0,
        enrolments: 0,
        completed: 0,
        overdue: 0,
        inProgress: 0,
        certificates: 0,
        completionRate: 0,
      };
    }

    const enrolmentClauses = [inArray(enrolments.userId, ids)];
    if (filters.courseId) {
      enrolmentClauses.push(eq(enrolments.courseId, filters.courseId));
    }

    const rows = await tx
      .select({ status: enrolments.status, total: count() })
      .from(enrolments)
      .where(and(...enrolmentClauses))
      .groupBy(enrolments.status);

    const byStatus = new Map(rows.map((row) => [row.status, row.total]));
    const total = rows.reduce((sum, row) => sum + row.total, 0);
    const completed = byStatus.get("completed") ?? 0;

    const [{ issued }] = await tx
      .select({ issued: count() })
      .from(certificates)
      .where(
        and(inArray(certificates.userId, ids), isNull(certificates.revokedAt)),
      );

    return {
      people: ids.length,
      enrolments: total,
      completed,
      overdue: byStatus.get("overdue") ?? 0,
      inProgress: byStatus.get("in_progress") ?? 0,
      certificates: issued,
      completionRate: total === 0 ? 0 : Math.round((completed / total) * 100),
    };
  });
}

export type CourseCompletionRow = {
  courseId: string;
  title: string;
  enrolled: number;
  completed: number;
  overdue: number;
  completionRate: number;
};

export async function courseCompletion(
  session: AuthenticatedSession,
  filters: ReportFilters = {},
): Promise<CourseCompletionRow[]> {
  assertSessionCan(session, "report:own");
  const scope = scopeFor(session);

  return withTenant(session.organisationId, async (tx) => {
    const ids = (
      await tx
        .select({ id: users.id })
        .from(users)
        .where(peopleInScope(scope, filters))
    ).map((row) => row.id);

    if (ids.length === 0) return [];

    const rows = await tx
      .select({
        courseId: courses.id,
        title: courses.title,
        enrolled: count(),
        completed: sql<number>`count(*) filter (where enrolments.status = 'completed')::int`,
        overdue: sql<number>`count(*) filter (where enrolments.status = 'overdue')::int`,
      })
      .from(enrolments)
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .where(inArray(enrolments.userId, ids))
      .groupBy(courses.id, courses.title)
      .orderBy(asc(courses.title));

    return rows.map((row) => ({
      ...row,
      completionRate:
        row.enrolled === 0 ? 0 : Math.round((row.completed / row.enrolled) * 100),
    }));
  });
}

export type CapabilityRow = {
  code: string;
  name: string;
  holders: number;
  population: number;
  coverage: number;
  /** Nobody in scope holds this competency at all. */
  noCoverage: boolean;
  /** Exactly one person holds it: losing them removes the capability. */
  singlePointOfFailure: boolean;
};

/**
 * Which competencies the workforce actually holds.
 *
 * This is the report the platform exists for. Two flags carry most of its
 * value, and both describe workforce vulnerability rather than performance:
 *
 *   - no coverage: nobody in scope holds the competency;
 *   - single point of failure: exactly one person does, so a resignation or a
 *     period of sick leave removes the capability entirely.
 *
 * Counted from live certificates. A withdrawn certificate stops counting, and
 * a course completion without a moderated judgement never counted.
 */
export async function capabilityCoverage(
  session: AuthenticatedSession,
  filters: ReportFilters = {},
): Promise<CapabilityRow[]> {
  assertSessionCan(session, "report:own");
  const scope = scopeFor(session);

  return withTenant(session.organisationId, async (tx) => {
    const ids = (
      await tx
        .select({ id: users.id })
        .from(users)
        .where(peopleInScope(scope, filters))
    ).map((row) => row.id);

    if (ids.length === 0) return [];

    // Every competency defined for the tenant, so one that nobody holds still
    // appears — a gap is invisible if the report only lists what people have.
    const defined = await tx
      .select({ code: competencies.code, name: competencies.name })
      .from(competencies)
      .orderBy(asc(competencies.code));

    // Holders are counted in application code rather than by unnesting the
    // JSON in SQL. The volumes are small, and it keeps every value a bound
    // parameter instead of building a query string out of identifiers.
    const live = await tx
      .select({
        userId: certificates.userId,
        attested: certificates.competenciesAttested,
      })
      .from(certificates)
      .where(
        and(inArray(certificates.userId, ids), isNull(certificates.revokedAt)),
      );

    const holdersByCode = new Map<string, Set<string>>();
    for (const certificate of live) {
      for (const competency of certificate.attested ?? []) {
        const holders = holdersByCode.get(competency.code) ?? new Set<string>();
        holders.add(certificate.userId);
        holdersByCode.set(competency.code, holders);
      }
    }

    return defined.map((competency) => {
      const holders = holdersByCode.get(competency.code)?.size ?? 0;
      return {
        code: competency.code,
        name: competency.name,
        holders,
        population: ids.length,
        coverage: Math.round((holders / ids.length) * 100),
        noCoverage: holders === 0,
        singlePointOfFailure: holders === 1,
      };
    });
  });
}

export type OverdueRow = {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  team: string | null;
  courseTitle: string;
  dueDate: Date | null;
  daysOverdue: number;
};

export async function overdueTraining(
  session: AuthenticatedSession,
  filters: ReportFilters = {},
): Promise<OverdueRow[]> {
  assertSessionCan(session, "report:own");
  const scope = scopeFor(session);

  return withTenant(session.organisationId, async (tx) => {
    const ids = (
      await tx
        .select({ id: users.id })
        .from(users)
        .where(peopleInScope(scope, filters))
    ).map((row) => row.id);

    if (ids.length === 0) return [];

    const rows = await tx
      .select({
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        team: users.team,
        courseTitle: courses.title,
        dueDate: enrolments.dueDate,
      })
      .from(enrolments)
      .innerJoin(users, eq(users.id, enrolments.userId))
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .where(
        and(
          inArray(enrolments.userId, ids),
          eq(enrolments.status, "overdue"),
        ),
      )
      .orderBy(asc(enrolments.dueDate));

    return rows.map((row) => ({
      ...row,
      daysOverdue: row.dueDate
        ? Math.max(
            0,
            Math.floor((Date.now() - row.dueDate.getTime()) / 86_400_000),
          )
        : 0,
    }));
  });
}

/** Distinct teams and sites, for the filter controls. */
export async function filterOptions(session: AuthenticatedSession) {
  assertSessionCan(session, "report:own");
  const scope = scopeFor(session);

  return withTenant(session.organisationId, async (tx) => {
    const rows = await tx
      .select({ team: users.team, site: users.site })
      .from(users)
      .where(peopleInScope(scope, {}));

    return {
      teams: [...new Set(rows.map((r) => r.team).filter(Boolean))].sort() as string[],
      sites: [...new Set(rows.map((r) => r.site).filter(Boolean))].sort() as string[],
    };
  });
}

/**
 * Renders rows as CSV for the spreadsheet export in Section 4.8.
 *
 * A field beginning with =, +, - or @ is prefixed with a quote. Spreadsheet
 * software treats those as formulas, so a value taken from user input could
 * otherwise execute when the file is opened.
 */
export function toCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const escape = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return "";
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
    return text;
  };

  return [headers, ...rows]
    .map((row) => row.map(escape).join(","))
    .join("\r\n");
}

/** Direct reports and their training status, for a line manager. */
export async function teamStatus(session: AuthenticatedSession) {
  assertSessionCan(session, "report:own");
  const scope = scopeFor(session);

  return withTenant(session.organisationId, async (tx) => {
    const people = await tx
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        jobTitle: users.jobTitle,
      })
      .from(users)
      .where(peopleInScope(scope, {}))
      .orderBy(asc(users.lastName), asc(users.firstName));

    if (people.length === 0) return [];

    const ids = people.map((person) => person.id);

    const counts = await tx
      .select({
        userId: enrolments.userId,
        status: enrolments.status,
        total: count(),
      })
      .from(enrolments)
      .where(inArray(enrolments.userId, ids))
      .groupBy(enrolments.userId, enrolments.status);

    const certificateCounts = await tx
      .select({ userId: certificates.userId, total: count() })
      .from(certificates)
      .where(
        and(inArray(certificates.userId, ids), isNull(certificates.revokedAt)),
      )
      .groupBy(certificates.userId);

    const certificatesByUser = new Map(
      certificateCounts.map((row) => [row.userId, row.total]),
    );

    return people.map((person) => {
      const theirs = counts.filter((row) => row.userId === person.id);
      const total = theirs.reduce((sum, row) => sum + row.total, 0);
      const completed =
        theirs.find((row) => row.status === "completed")?.total ?? 0;
      const overdue = theirs.find((row) => row.status === "overdue")?.total ?? 0;

      return {
        ...person,
        enrolments: total,
        completed,
        overdue,
        certificates: certificatesByUser.get(person.id) ?? 0,
      };
    });
  });
}

export type { TenantDatabase };
