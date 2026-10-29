import { and, eq, gte, isNull, lte, ne, or } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { cohortSessions, organisations } from "@/db/schema";
import { peakClassesAt, type ClassSlot } from "./classroom-rules";
import { dateInZone, zonedTimeToUtc } from "./timezone";

/**
 * Room in the LMS classroom (Roland, 29 October 2026).
 *
 * The classroom runs on one media server shared by every provider on the
 * deployment, so it can hold only so many classes at once. Two limits apply:
 *
 *   - the deployment's, CLASSROOM_CAPACITY, set by the operator from a load
 *     test of the media server;
 *   - each provider's own allowance, set by the operator on the Platform page,
 *     so one provider's busy evening cannot leave another without room.
 *
 * A class is checked when it is booked, so the provider hears at once and can
 * hold it another way, rather than finding out on the evening.
 *
 * Counting crosses providers, so it runs in platform scope; it returns counts
 * and the provider's own sessions, never another provider's.
 */

/** The most classes the deployment's media server carries at once, or null for no limit set. */
export function deploymentClassroomLimit(): number | null {
  const value = Number(process.env.CLASSROOM_CAPACITY?.trim());
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * A class with no end time is taken to last two hours, the length of a
 * typical lecture. An unknown end overstates the booking rather than letting
 * the classroom be overbooked.
 */
const UNKNOWN_LENGTH_MINUTES = 120;

export type ClassTimes = { scheduledDate: string; startTime: string | null; endTime: string | null };

/** A class as instants on the provider's clock, or null when it has no start time to check. */
export function slotOf(times: ClassTimes, timezone: string): ClassSlot | null {
  if (!times.startTime) return null;
  const start = zonedTimeToUtc(times.scheduledDate, times.startTime, timezone).getTime();
  const end = times.endTime && times.endTime > times.startTime
    ? zonedTimeToUtc(times.scheduledDate, times.endTime, timezone).getTime()
    : start + UNKNOWN_LENGTH_MINUTES * 60_000;
  return { start, end };
}

export type ClassroomRoom =
  | { fits: true }
  | { fits: false; reason: "not_offered" }
  | { fits: false; reason: "allowance" | "deployment"; limit: number };

type Booking = { id: string; organisationId: string; slot: ClassSlot; bookedAt: number };

function shiftDate(date: string, days: number): string {
  const at = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) + days * 86_400_000;
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * Every class booked in the classroom between two dates, on every provider.
 * A day either side of the range, because providers on other clocks can book
 * the same instant under a different date.
 */
async function bookingsBetween(from: string, to: string): Promise<Booking[]> {
  const rows = await withPlatformScope("counting classes booked in the shared LMS classroom", (tx) =>
    tx
      .select({
        id: cohortSessions.id,
        organisationId: cohortSessions.organisationId,
        scheduledDate: cohortSessions.scheduledDate,
        startTime: cohortSessions.startTime,
        endTime: cohortSessions.endTime,
        bookedAt: cohortSessions.createdAt,
        timezone: organisations.timezone,
      })
      .from(cohortSessions)
      .innerJoin(organisations, eq(organisations.id, cohortSessions.organisationId))
      .where(
        and(
          eq(cohortSessions.status, "scheduled"),
          ne(cohortSessions.deliveryMode, "in_person"),
          isNull(cohortSessions.meetingUrl),
          gte(cohortSessions.scheduledDate, shiftDate(from, -1)),
          lte(cohortSessions.scheduledDate, shiftDate(to, 1)),
          // lib/classroom-rules.ts's heldInClassroom, as a query.
          or(
            eq(cohortSessions.liveClassMethod, "lms_classroom"),
            and(isNull(cohortSessions.liveClassMethod), eq(organisations.liveClassMethod, "lms_classroom")),
          ),
        ),
      ),
  );
  return rows.flatMap((row) => {
    const slot = slotOf(row, row.timezone);
    return slot ? [{ id: row.id, organisationId: row.organisationId, slot, bookedAt: row.bookedAt.getTime() }] : [];
  });
}

async function providerOf(organisationId: string) {
  const [row] = await withPlatformScope("reading a provider's classroom allowance", (tx) =>
    tx
      .select({ allowance: organisations.classroomAllowance, timezone: organisations.timezone })
      .from(organisations)
      .where(eq(organisations.id, organisationId)),
  );
  return row ?? { allowance: null, timezone: "Africa/Johannesburg" };
}

/** Whether a class fits, given the other bookings. */
function roomFor(organisationId: string, allowance: number | null, slot: ClassSlot | null, others: Booking[]): ClassroomRoom {
  if (allowance === 0) return { fits: false, reason: "not_offered" };
  if (!slot) return { fits: true };
  const own = others.filter((one) => one.organisationId === organisationId).map((one) => one.slot);
  if (allowance !== null && peakClassesAt(slot, own) > allowance) return { fits: false, reason: "allowance", limit: allowance };
  const limit = deploymentClassroomLimit();
  if (limit !== null && peakClassesAt(slot, others.map((one) => one.slot)) > limit) return { fits: false, reason: "deployment", limit };
  return { fits: true };
}

/**
 * Whether a class at these times fits in the classroom for this provider.
 * `excluding` leaves out the session being moved, so it does not count
 * against itself.
 */
export async function roomInClassroom(organisationId: string, times: ClassTimes, excluding?: string): Promise<ClassroomRoom> {
  const provider = await providerOf(organisationId);
  const slot = slotOf(times, provider.timezone);
  if (provider.allowance === 0 || !slot) return roomFor(organisationId, provider.allowance, slot, []);
  const others = (await bookingsBetween(times.scheduledDate, times.scheduledDate)).filter((one) => one.id !== excluding);
  return roomFor(organisationId, provider.allowance, slot, others);
}

/**
 * This provider's classes from today on that do not fit: booked before an
 * allowance was lowered, or moved into the classroom by changing the usual
 * way. Each is weighed against the bookings made before it, so where three
 * classes compete for two places the one booked last is the one named.
 */
export async function classesWithoutRoom(organisationId: string, now: Date = new Date()): Promise<{ sessionId: string; reason: "not_offered" | "allowance" | "deployment" }[]> {
  const provider = await providerOf(organisationId);
  const today = dateInZone(now, provider.timezone);
  const all = await bookingsBetween(today, shiftDate(today, 400));
  const mine = all.filter((one) => one.organisationId === organisationId && one.slot.end > now.getTime());
  return mine.flatMap((booking) => {
    const earlier = all.filter((one) => one.bookedAt < booking.bookedAt || (one.bookedAt === booking.bookedAt && one.id < booking.id));
    const room = roomFor(organisationId, provider.allowance, booking.slot, earlier);
    return room.fits ? [] : [{ sessionId: booking.id, reason: room.reason }];
  });
}
