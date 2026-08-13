/**
 * Loads a QCTO curriculum file into a tenant.
 *
 *   npx tsx scripts/import-curriculum.mts curricula/121150-hrm-administrator.json --org roft
 *   npx tsx scripts/import-curriculum.mts <file> --org <slug> --check
 *
 * `--check` validates the file and reports what it would do, without writing.
 * Use it after transcribing a curriculum: it catches percentages that do not
 * add up, duplicated codes, and modules with nothing to assess, which are the
 * three mistakes transcription actually produces.
 *
 * Re-importing the same QCTO code replaces that qualification's structure.
 * That is intended when the QCTO reissues a curriculum, and it discards the
 * links from lessons and assessment items to the old criteria — so it is a
 * deliberate act, not something to run on every deploy.
 */
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";

config({ path: ".env.local" });

const { withPlatformScope } = await import("../db/client");
const { organisations, userRoles, users } = await import("../db/schema");
const { importCurriculum, curriculumFileSchema, inspectCurriculum } =
  await import("../lib/curriculum-import");
const { permissionsFor } = await import("../lib/rbac");

const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith("--"));
const orgIndex = args.indexOf("--org");
const orgSlug = orgIndex === -1 ? undefined : args[orgIndex + 1];
const checkOnly = args.includes("--check");

if (!filePath) {
  console.error(
    "Give the curriculum file:\n" +
      "  npx tsx scripts/import-curriculum.mts curricula/121150-hrm-administrator.json --org roft\n",
  );
  process.exit(1);
}

const raw: unknown = JSON.parse(readFileSync(filePath, "utf8"));
const parsed = curriculumFileSchema.safeParse(raw);

if (!parsed.success) {
  console.error(`\n${filePath} is not a valid curriculum file:\n`);
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  console.error("");
  process.exit(1);
}

const file = parsed.data;
const warnings = inspectCurriculum(file);

const moduleCount = file.modules.length;
const topicCount = file.modules.reduce((n, m) => n + m.topics.length, 0);
const criterionCount = file.modules.reduce(
  (n, m) => n + m.topics.reduce((t, topic) => t + topic.criteria.length, 0),
  0,
);
const elementCount = file.modules.reduce(
  (n, m) => n + m.topics.reduce((t, topic) => t + topic.elements.length, 0),
  0,
);

console.log(`
  ${file.title}
  SAQA ${file.saqaId ?? "—"} · QCTO ${file.qctoCode ?? "—"} · NQF ${file.nqfLevel ?? "—"}

  ${moduleCount} modules, ${topicCount} topics, ${elementCount} things to teach, ${criterionCount} criteria to assess
`);

if (warnings.length > 0) {
  console.log("  Worth checking against the document:\n");
  for (const warning of warnings) console.log(`    · ${warning}`);
  console.log("");
}

if (checkOnly) {
  console.log("  --check: nothing was written.\n");
  process.exit(0);
}

if (!orgSlug) {
  console.error("  Give the tenant to import into: --org <slug>\n");
  process.exit(1);
}

// The import is recorded in the audit log, so it needs a real actor rather
// than a synthetic one. Any administrator of the tenant will do; naming a
// person who did not run it would be worse than naming the most senior one.
const actor = await withPlatformScope(
  "importing a curriculum from the server, where no administrator session exists",
  async (tx) => {
    const [organisation] = await tx
      .select({ id: organisations.id, name: organisations.displayName })
      .from(organisations)
      .where(eq(organisations.slug, orgSlug));

    if (!organisation) return null;

    const [admin] = await tx
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: userRoles.role,
      })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .where(
        and(
          eq(users.organisationId, organisation.id),
          eq(users.status, "active"),
          isNull(userRoles.revokedAt),
          eq(userRoles.role, "tenant_admin"),
        ),
      );

    return admin ? { organisation, admin } : { organisation, admin: null };
  },
);

if (!actor) {
  console.error(`  No tenant with the slug "${orgSlug}".\n`);
  process.exit(1);
}

if (!actor.admin) {
  console.error(
    `  ${actor.organisation.name} has no active administrator to attribute this to.\n`,
  );
  process.exit(1);
}

const roles = ["tenant_admin" as const];
const summary = await importCurriculum(
  {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId: actor.admin.id,
    organisationId: actor.organisation.id,
    email: actor.admin.email,
    firstName: actor.admin.firstName,
    lastName: actor.admin.lastName,
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
  },
  raw,
);

console.log(`  ${summary.created ? "Imported" : "Replaced"} in ${actor.organisation.name}.
  Attributed to ${actor.admin.firstName} ${actor.admin.lastName}.
  ${summary.modules} modules, ${summary.topics} topics, ${summary.elements} elements, ${summary.criteria} criteria.
`);

process.exit(0);
