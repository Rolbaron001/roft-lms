/**
 * Removes qualifications and everything that hangs off them.
 *
 * For clearing test data out of an environment before a fresh run. It is
 * deliberately not reachable from the application: nothing in the LMS should
 * be able to remove a qualification that learners have been enrolled against,
 * and this exists precisely to do the thing the product refuses to.
 *
 *   npx tsx scripts/scrub-qualifications.ts                 report only
 *   npx tsx scripts/scrub-qualifications.ts --all --commit  remove all of them
 *   npx tsx scripts/scrub-qualifications.ts --id <uuid> --commit
 *   npx tsx scripts/scrub-qualifications.ts --org curiosa --commit
 *
 * Nothing is removed without --commit. The report is the same either way, so
 * the run that shows you what will go is the run that goes.
 *
 * Why this is not just "delete from qualifications":
 *
 *   Three things point at a qualification with ON DELETE SET NULL rather than
 *   CASCADE — enrolments, learning paths (programmes) and workplace
 *   agreements. Deleting the row alone leaves those behind with a null where
 *   the qualification used to be: a learner still enrolled, on nothing. The
 *   same is true one level down, where courses hold their curriculum module
 *   and study unit as SET NULL. So the descent below is explicit, ordered
 *   child-first, and does not rely on the database to work out the intent.
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const adminUrl = process.env.DATABASE_ADMIN_URL;

if (!adminUrl) {
  console.error("DATABASE_ADMIN_URL is not set. See .env.example.");
  process.exit(1);
}

const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const all = argv.includes("--all");
const idOf = (flag: string) => {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
};
const onlyId = idOf("--id");
const onlyOrg = idOf("--org");

if (!all && !onlyId && !onlyOrg) {
  console.error(
    "Choose a scope: --all, --id <uuid>, or --org <slug>.\n" +
      "Add --commit to actually remove anything.",
  );
  process.exit(2);
}

async function main() {
  const sql = postgres(adminUrl!, { max: 1, onnotice: () => {} });

  try {
    const targets = await sql<
      { id: string; title: string; code: string | null; slug: string }[]
    >`
      select q.id, q.title, q.curriculum_code as code, o.slug
      from qualifications q
      join organisations o on o.id = q.organisation_id
      where ${
        onlyId
          ? sql`q.id = ${onlyId}`
          : onlyOrg
            ? sql`o.slug = ${onlyOrg}`
            : sql`true`
      }
      order by o.slug, q.title
    `;

    if (targets.length === 0) {
      console.log("No qualifications matched. Nothing to do.");
      return;
    }

    const ids = targets.map((t) => t.id);

    console.log(
      `${targets.length} qualification${targets.length === 1 ? "" : "s"} in scope:\n`,
    );
    for (const t of targets) {
      console.log(`  [${t.slug}] ${t.title}  ${t.code ?? "(no code)"}`);
    }

    // Everything reachable, gathered before anything is removed so the report
    // and the deletion cannot disagree.
    const scope = {
      modules: sql`select id from curriculum_modules where qualification_id in ${sql(ids)}`,
      units: sql`select id from study_units where qualification_id in ${sql(ids)}`,
    };

    const courses = await sql<{ id: string }[]>`
      select id from courses
      where curriculum_module_id in (${scope.modules})
         or study_unit_id in (${scope.units})
    `;
    const courseIds = courses.map((c) => c.id);

    const enrolments = await sql<{ id: string }[]>`
      select id from enrolments
      where qualification_id in ${sql(ids)}
        ${courseIds.length ? sql`or course_id in ${sql(courseIds)}` : sql``}
        or learning_path_id in (
          select id from learning_paths where qualification_id in ${sql(ids)}
        )
    `;
    const enrolmentIds = enrolments.map((e) => e.id);

    const count = async (query: postgres.PendingQuery<postgres.Row[]>) =>
      Number(((await query) as unknown as { n: string }[])[0]?.n ?? 0);

    const tally: Record<string, number> = {
      "curriculum modules": await count(
        sql`select count(*)::int as n from curriculum_modules where qualification_id in ${sql(ids)}`,
      ),
      "study units": await count(
        sql`select count(*)::int as n from study_units where qualification_id in ${sql(ids)}`,
      ),
      "exit level outcomes": await count(
        sql`select count(*)::int as n from exit_level_outcomes where qualification_id in ${sql(ids)}`,
      ),
      "filed documents": await count(
        sql`select count(*)::int as n from programme_documents where qualification_id in ${sql(ids)}`,
      ),
      "statements of results": await count(
        sql`select count(*)::int as n from statements_of_results where qualification_id in ${sql(ids)}`,
      ),
      "capture jobs": await count(
        sql`select count(*)::int as n from capture_jobs where qualification_id in ${sql(ids)}`,
      ),
      programmes: await count(
        sql`select count(*)::int as n from learning_paths where qualification_id in ${sql(ids)}`,
      ),
      "workplace agreements": await count(
        sql`select count(*)::int as n from workplace_agreements where qualification_id in ${sql(ids)}`,
      ),
      courses: courseIds.length,
      enrolments: enrolmentIds.length,
    };

    // Certificates hold enrolments with ON DELETE RESTRICT, on purpose: an
    // issued certificate is a statutory record and the database is right to
    // refuse. Say so loudly rather than quietly sweeping them up.
    const certificates = enrolmentIds.length
      ? await count(
          sql`select count(*)::int as n from certificates where enrolment_id in ${sql(enrolmentIds)}`,
        )
      : 0;

    console.log("\nWhat goes with them:\n");
    for (const [what, n] of Object.entries(tally)) {
      if (n > 0) console.log(`  ${String(n).padStart(5)}  ${what}`);
    }
    if (certificates > 0) {
      console.log(`  ${String(certificates).padStart(5)}  ISSUED CERTIFICATES`);
      console.log(
        "\n  Certificates are protected by the database (ON DELETE RESTRICT)\n" +
          "  because an issued certificate is a statutory record. They will be\n" +
          "  removed too. If any of these were issued to a real learner, stop.",
      );
    }

    // Stored evidence lives on disk or in a bucket, not in the database, and
    // is not reference-counted. Naming the count is honest about what this
    // script does not clean up.
    const artifacts = enrolmentIds.length
      ? await count(
          sql`select count(*)::int as n from evidence_artifacts
              where submission_id in (
                select id from assessment_submissions where enrolment_id in ${sql(enrolmentIds)}
              )`,
        )
      : 0;
    if (artifacts > 0) {
      console.log(
        `\n  ${artifacts} stored evidence file(s) belong to these enrolments.\n` +
          "  Their records go; the files themselves stay in storage and are\n" +
          "  left for the storage sweep rather than deleted from under it.",
      );
    }

    if (!commit) {
      console.log("\nReport only. Re-run with --commit to remove all of this.");
      return;
    }

    await sql.begin(async (tx) => {
      if (enrolmentIds.length) {
        await tx`delete from certificates where enrolment_id in ${tx(enrolmentIds)}`;
        await tx`delete from assessment_submissions where enrolment_id in ${tx(enrolmentIds)}`;
        await tx`delete from enrolments where id in ${tx(enrolmentIds)}`;
      }
      if (courseIds.length) {
        await tx`delete from courses where id in ${tx(courseIds)}`;
      }
      await tx`delete from learning_paths where qualification_id in ${tx(ids)}`;
      await tx`delete from workplace_agreements where qualification_id in ${tx(ids)}`;
      // The rest cascade from the qualification itself.
      await tx`delete from qualifications where id in ${tx(ids)}`;
    });

    const left = await count(
      sql`select count(*)::int as n from qualifications where id in ${sql(ids)}`,
    );
    const orphans = await count(
      sql`select count(*)::int as n from enrolments
          where qualification_id is null and course_id is null and learning_path_id is null`,
    );

    console.log(
      `\nRemoved. ${left === 0 ? "None of the targets remain." : `${left} STILL PRESENT — investigate.`}`,
    );
    console.log(
      orphans === 0
        ? "No enrolment was left pointing at nothing."
        : `WARNING: ${orphans} enrolment(s) now point at nothing.`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("Scrub failed. Nothing was removed — it runs in one transaction.");
  console.error(error);
  process.exit(1);
});
