/**
 * Removes tenants left behind by test runs.
 *
 *   npx tsx scripts/purge-test-tenants.mts            list what would go
 *   npx tsx scripts/purge-test-tenants.mts --confirm  actually remove it
 *
 * Nine test files used to create a tenant and never clear it up, one or two per
 * run, for as long as those files existed. That leak was fixed on 11 September
 * and verified by counting; this script is for the strays that had already
 * accumulated by then.
 *
 * It deletes across tenants, which is the one shape of command worth being
 * careful with, so it is careful in four ways.
 *
 * **It lists before it deletes.** Nothing happens without `--confirm`, and the
 * dry run prints exactly what would go.
 *
 * **Real tenants are named and can never match.** `PROTECTED` below is checked
 * first and independently of the patterns. A tenant on that list is skipped
 * even if its slug somehow looks like a fixture.
 *
 * **A slug must look like a fixture twice over.** It has to carry a known
 * fixture prefix *and* end in a unix millisecond timestamp, which is how the
 * test files name them. A real provider called "scheduling" fails the second
 * test and survives.
 *
 * **Anything unrecognised is left alone and reported.** The script never
 * deletes what it cannot explain, and says how many it skipped.
 *
 * Deleting the organisation is enough: every tenant-scoped table cascades from
 * it, which is what makes the strays harmless in the first place.
 */
import { config } from "dotenv";
import { writeFileSync } from "node:fs";

config({ path: ".env.local" });

const { default: postgres } = await import("postgres");

/**
 * Tenants that are real, and are never candidates whatever their slug.
 *
 * Held here rather than inferred. A rule that worked out which tenants are real
 * would be a rule that could be wrong about one.
 */
const PROTECTED = new Set([
  "acme",
  "curiosa",
  "harbourtraining",
  "roft",
  // The platform's own organisation, wherever it is configured to live.
  process.env.PLATFORM_ORG_SLUG ?? "roft",
]);

/**
 * Slug prefixes the test files use. Each must be followed by a timestamp.
 *
 * Taken from the fixtures themselves rather than guessed: `sched-` and
 * `sched-other-` from scheduling, `default-badge-` from badges, `quiet-` from
 * notifications, `mediaother-` from media, `solo-` from provisioning, and the
 * ones added on 11 September while building.
 */
const FIXTURE_PREFIXES = [
  "sched-other-",
  "sched-",
  "default-badge-",
  "quiet-",
  "mediaother-",
  "solo-",
  "form-",
  "leisa-",
  "holiday-",
  "offline-on-",
  "offline-off-",
  "authoring-",
  "mail-",
];

/** A fixture slug ends in the millisecond stamp its test gave it. */
const STAMPED = /-\d{10,16}$/;

function isFixture(slug: string): boolean {
  if (PROTECTED.has(slug)) return false;
  if (!STAMPED.test(slug)) return false;
  return FIXTURE_PREFIXES.some((prefix) => slug.startsWith(prefix));
}

const confirmed = process.argv.includes("--confirm");

const sql = postgres(process.env.DATABASE_ADMIN_URL!, {
  max: 1,
  onnotice: () => {},
});

try {
  const all = await sql<
    { id: string; slug: string; displayName: string; users: number }[]
  >`
    select o.id,
           o.slug,
           o.display_name as "displayName",
           (select count(*)::int from users u where u.organisation_id = o.id) as users
    from organisations o
    order by o.slug`;

  const doomed = all.filter((row) => isFixture(row.slug));
  const kept = all.filter((row) => !isFixture(row.slug));

  console.log(`${all.length} organisations, of which ${doomed.length} look like test fixtures.\n`);

  console.log("Keeping:");
  for (const row of kept) {
    const why = PROTECTED.has(row.slug) ? "protected" : "not a fixture shape";
    console.log(
      `  ${row.slug.padEnd(34)} ${String(row.users).padStart(4)} users  ${row.displayName}  (${why})`,
    );
  }

  // Grouped, because 146 lines of near-identical slugs tell a reader nothing.
  const byPrefix = new Map<string, number>();
  for (const row of doomed) {
    const prefix =
      FIXTURE_PREFIXES.find((p) => row.slug.startsWith(p)) ?? "unknown";
    byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
  }

  console.log("\nRemoving:");
  for (const [prefix, count] of [...byPrefix].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${prefix}*`);
  }

  const users = doomed.reduce((total, row) => total + row.users, 0);
  console.log(`\n  ${doomed.length} organisations and ${users} test users.`);

  if (doomed.length === 0) {
    console.log("\nNothing to do.");
    await sql.end();
    process.exit(0);
  }

  if (!confirmed) {
    console.log("\nDry run. Nothing has been deleted.");
    console.log("Run again with --confirm to remove them.");
    await sql.end();
    process.exit(0);
  }

  /**
   * What was removed, written down before it is removed.
   *
   * Cheap insurance on an irreversible act: if a slug in this file turns out to
   * have mattered, at least it is possible to say what was lost.
   */
  const record = `purged-tenants-${new Date().toISOString().slice(0, 10)}.txt`;
  writeFileSync(
    record,
    doomed
      .map((row) => `${row.slug}\t${row.displayName}\t${row.users} users`)
      .join("\n"),
  );
  console.log(`\nWrote the list to ${record}.`);

  // One statement, so it is all or nothing rather than half a purge.
  const removed = await sql`
    delete from organisations
    where id = any(${doomed.map((row) => row.id)})
    returning slug`;

  console.log(`Removed ${removed.length} organisations.`);

  const left = await sql<{ n: number }[]>`select count(*)::int as n from organisations`;
  console.log(`${left[0].n} organisations remain.`);
} finally {
  await sql.end();
}
