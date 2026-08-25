/**
 * Sets the organisation that operates this deployment.
 *
 *   npx tsx scripts/set-operator.mts --slug curiosa --name "Curiosa Academy" \
 *     --primary "#402850" --accent "#B06088"
 *
 * The platform is deployed more than once — ROFT runs an instance for its own
 * clients, Curiosa Academy runs another for theirs — from one codebase. What
 * differs between them is the organisation sitting at the top, and this is how
 * that organisation is named.
 *
 * It renames the deployment's existing operator rather than creating a second
 * one, so the people, roles and material already there stay where they are.
 * Pass --create to stand one up on a database that has none.
 *
 * Afterwards, set these in the deployment's own .env and restart:
 *
 *   PLATFORM_ORG_SLUG           the slug given here
 *   PLATFORM_NAME               the name, for pages rendered before sign-in
 *   PLATFORM_REFERENCE_PREFIX   printed before certificate references
 *
 * The logo is not set here. It is uploaded through Appearance, by whoever runs
 * the deployment, and can be replaced whenever the brand changes.
 */
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { eq, ne, and } from "drizzle-orm";

config({ path: ".env.local" });

const { withPlatformScope } = await import("../db/client");
const { organisations } = await import("../db/schema");

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const slug = arg("slug");
const name = arg("name");
const primary = arg("primary");
const accent = arg("accent");
const create = process.argv.includes("--create");
const currentSlug = process.env.PLATFORM_ORG_SLUG?.trim() || "roft";

if (!slug || !name) {
  console.error(
    'Give at least a slug and a name:\n' +
      '  npx tsx scripts/set-operator.mts --slug curiosa --name "Curiosa Academy"\n',
  );
  process.exit(1);
}

if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
  console.error("A slug is lower-case letters, digits and hyphens.");
  process.exit(1);
}

for (const [label, value] of [
  ["--primary", primary],
  ["--accent", accent],
] as const) {
  if (value && !/^#[0-9A-Fa-f]{6}$/.test(value)) {
    console.error(`${label} must be a colour like #402850.`);
    process.exit(1);
  }
}

await withPlatformScope("naming the organisation that operates this deployment", async (tx) => {
  // A slug already belonging to somebody else is a collision, not a rename.
  const [clash] = await tx
    .select({ id: organisations.id, displayName: organisations.displayName })
    .from(organisations)
    .where(and(eq(organisations.slug, slug), ne(organisations.slug, currentSlug)));

  const [existing] = await tx
    .select()
    .from(organisations)
    .where(eq(organisations.slug, currentSlug));

  if (clash && (!existing || clash.id !== existing.id)) {
    console.error(
      `The slug "${slug}" already belongs to ${clash.displayName}. ` +
        `Pick another, or rename that tenant first.`,
    );
    process.exit(1);
  }

  if (!existing) {
    if (!create) {
      console.error(
        `No organisation with the slug "${currentSlug}" — that is what ` +
          `PLATFORM_ORG_SLUG currently names. Add --create to stand one up.`,
      );
      process.exit(1);
    }

    const [made] = await tx
      .insert(organisations)
      .values({
        id: randomUUID(),
        slug,
        legalName: name,
        displayName: name,
        status: "active",
        deploymentMode: "shared_cloud",
        ...(primary ? { primaryColour: primary } : {}),
        ...(accent ? { accentColour: accent } : {}),
      })
      .returning();

    console.log(`Created ${made.displayName} (${made.slug}) as the operator.`);
    return;
  }

  const [updated] = await tx
    .update(organisations)
    .set({
      slug,
      displayName: name,
      legalName: name,
      ...(primary ? { primaryColour: primary } : {}),
      ...(accent ? { accentColour: accent } : {}),
      updatedAt: new Date(),
    })
    .where(eq(organisations.id, existing.id))
    .returning();

  console.log(
    `${existing.displayName} (${existing.slug}) is now ` +
      `${updated.displayName} (${updated.slug}).`,
  );
  console.log(
    `Its people, roles and material are untouched — this renamed the ` +
      `organisation, it did not create a second one.`,
  );
});

console.log("\nNow set these in this deployment's .env and restart:");
console.log(`  PLATFORM_ORG_SLUG="${slug}"`);
console.log(`  PLATFORM_NAME="${name}"`);
console.log(`  PLATFORM_REFERENCE_PREFIX="${slug.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 12)}"`);
console.log("\nThe logo is uploaded through Appearance, not set here.");

process.exit(0);
