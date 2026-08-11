/**
 * Creates demo data for local development.
 *
 * Two tenants, not one. A single-tenant demo makes it impossible to see
 * whether isolation actually works; with two, you can sign in to each and
 * confirm neither can see the other.
 *
 * Safe to re-run: it deletes both demo tenants first. It refuses to run
 * against anything but a local database.
 */
import { config } from "dotenv";
import { inArray } from "drizzle-orm";

config({ path: ".env.local" });

const adminUrl = process.env.DATABASE_ADMIN_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(adminUrl)) {
  console.error(
    "Refusing to seed: DATABASE_ADMIN_URL does not point at a local database.",
  );
  process.exit(1);
}

const { withPlatformScope } = await import("../db/client");
const { organisations, users, userRoles, competencyFrameworks, competencies } =
  await import("../db/schema");
const { hashPassword } = await import("../lib/password");

const DEMO_SLUGS = ["acme", "harbourtraining"];

type SeedUser = {
  email: string;
  firstName: string;
  lastName: string;
  roles: ("platform_owner" | "tenant_admin" | "instructor" | "assessor" | "moderator" | "line_manager" | "learner" | "skills_development_facilitator" | "external_verifier")[];
  jobTitle?: string;
  registrationNumber?: string;
};

const ACME_USERS: SeedUser[] = [
  {
    email: "admin@acme.test",
    firstName: "Thandi",
    lastName: "Nkosi",
    roles: ["tenant_admin"],
    jobTitle: "Learning and Development Manager",
  },
  {
    email: "instructor@acme.test",
    firstName: "Pieter",
    lastName: "van Wyk",
    roles: ["instructor"],
    jobTitle: "Senior Trainer",
  },
  {
    email: "assessor@acme.test",
    firstName: "Naledi",
    lastName: "Mahlangu",
    roles: ["assessor"],
    jobTitle: "Internal Assessor",
    registrationNumber: "ASR-2024-0117",
  },
  {
    email: "moderator@acme.test",
    firstName: "Johan",
    lastName: "Botha",
    roles: ["moderator"],
    jobTitle: "Internal Moderator",
    registrationNumber: "MOD-2024-0042",
  },
  {
    email: "manager@acme.test",
    firstName: "Fatima",
    lastName: "Patel",
    roles: ["line_manager"],
    jobTitle: "Operations Supervisor",
  },
  {
    email: "sdf@acme.test",
    firstName: "Sipho",
    lastName: "Dlamini",
    roles: ["skills_development_facilitator"],
    jobTitle: "Skills Development Facilitator",
  },
  {
    email: "verifier@acme.test",
    firstName: "Ruth",
    lastName: "Adeyemi",
    roles: ["external_verifier"],
    jobTitle: "SETA External Verifier",
  },
  {
    email: "learner@acme.test",
    firstName: "Sam",
    lastName: "Mokoena",
    roles: ["learner"],
    jobTitle: "Plant Operator",
  },
  {
    // Deliberately holds two roles: the design document notes a person may.
    email: "both@acme.test",
    firstName: "Lerato",
    lastName: "Khumalo",
    roles: ["instructor", "assessor"],
    jobTitle: "Lead Trainer and Assessor",
    registrationNumber: "ASR-2024-0208",
  },
];

const HARBOUR_USERS: SeedUser[] = [
  {
    email: "admin@harbour.test",
    firstName: "Elsa",
    lastName: "Fourie",
    roles: ["tenant_admin"],
    jobTitle: "Centre Manager",
  },
  {
    email: "learner@harbour.test",
    firstName: "Kofi",
    lastName: "Mensah",
    roles: ["learner"],
    jobTitle: "Apprentice Rigger",
  },
];

const DEMO_PASSWORD = "roft-demo-2026";

/**
 * `--if-empty` seeds only when no tenants exist. start-lms.bat passes it on
 * every startup, so a first run gets demo data and later runs leave your work
 * alone. Without the flag the demo tenants are deleted and rebuilt.
 */
const onlyIfEmpty = process.argv.includes("--if-empty");

async function main() {
  if (onlyIfEmpty) {
    const existing = await withPlatformScope(
      "checking whether the database already holds tenants",
      (tx) => tx.select({ id: organisations.id }).from(organisations).limit(1),
    );

    if (existing.length > 0) {
      console.log("  Data already present — leaving it alone.");
      return;
    }
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  await withPlatformScope("seeding local development data", async (tx) => {
    // Cascades remove users, roles and everything else belonging to them.
    await tx
      .delete(organisations)
      .where(inArray(organisations.slug, DEMO_SLUGS));

    const [acme] = await tx
      .insert(organisations)
      .values({
        slug: "acme",
        legalName: "Acme Mining Services (Pty) Ltd",
        displayName: "Acme Mining Services",
        status: "active",
        deploymentMode: "shared_cloud",
        primaryColour: "#0d1e32",
        accentColour: "#b9975b",
        accreditationNumber: "QCTO/SDP/2024/0113",
        featureFlags: {
          qcto_portfolio: true,
          statutory_reporting: true,
          learning_paths: true,
        },
        physicalAddress: {
          line1: "14 Commissioner Street",
          city: "Johannesburg",
          province: "Gauteng",
          postalCode: "2001",
          country: "South Africa",
        },
      })
      .returning({ id: organisations.id });

    // Second tenant, deliberately branded differently, so that signing in to
    // each one visibly proves the white-labelling and the isolation.
    const [harbour] = await tx
      .insert(organisations)
      .values({
        slug: "harbourtraining",
        legalName: "Harbour Training Centre NPC",
        displayName: "Harbour Training Centre",
        status: "active",
        deploymentMode: "shared_cloud",
        primaryColour: "#123d33",
        accentColour: "#d98032",
        featureFlags: { qcto_portfolio: false, learning_paths: true },
      })
      .returning({ id: organisations.id });

    for (const [organisationId, seedUsers] of [
      [acme.id, ACME_USERS],
      [harbour.id, HARBOUR_USERS],
    ] as const) {
      for (const seedUser of seedUsers) {
        const [created] = await tx
          .insert(users)
          .values({
            organisationId,
            email: seedUser.email,
            passwordHash,
            firstName: seedUser.firstName,
            lastName: seedUser.lastName,
            status: "active",
            jobTitle: seedUser.jobTitle,
            consentGivenAt: new Date(),
            consentVersion: "1.0",
          })
          .returning({ id: users.id });

        for (const role of seedUser.roles) {
          await tx.insert(userRoles).values({
            organisationId,
            userId: created.id,
            role,
            registrationNumber: seedUser.registrationNumber ?? null,
          });
        }
      }
    }

    // A small competency framework, so course authoring has something to tag
    // against when that slice lands.
    const [framework] = await tx
      .insert(competencyFrameworks)
      .values({
        organisationId: acme.id,
        name: "Acme Operational Capability Framework",
        description:
          "Capability areas underpinning safe and effective plant operation.",
        source: "ROFT advisory engagement",
      })
      .returning({ id: competencyFrameworks.id });

    await tx.insert(competencies).values([
      {
        organisationId: acme.id,
        frameworkId: framework.id,
        code: "OPS-01",
        name: "Plant safety awareness",
        description:
          "Recognises hazards in the operating environment and applies the correct controls.",
        proficiencyLevels: ["Aware", "Competent", "Proficient", "Expert"],
      },
      {
        organisationId: acme.id,
        frameworkId: framework.id,
        code: "OPS-02",
        name: "Equipment fault diagnosis",
        description:
          "Identifies the cause of a fault and decides whether to correct or escalate it.",
        proficiencyLevels: ["Aware", "Competent", "Proficient", "Expert"],
      },
      {
        organisationId: acme.id,
        frameworkId: framework.id,
        code: "WFR-01",
        name: "Workforce risk identification",
        description:
          "Identifies capability vulnerabilities in a team: skills gaps, single points of failure, and thin supervisory cover.",
        proficiencyLevels: ["Aware", "Competent", "Proficient", "Expert"],
      },
    ]);
  });

  console.log(`
Demo data created.

  Acme Mining Services      http://acme.localhost:3000
  Harbour Training Centre   http://harbourtraining.localhost:3000

Every demo account uses the password: ${DEMO_PASSWORD}

  admin@acme.test        Administrator
  instructor@acme.test   Instructor
  assessor@acme.test     Assessor
  moderator@acme.test    Moderator
  manager@acme.test      Line Manager
  sdf@acme.test          Skills Development Facilitator
  verifier@acme.test     External Verifier
  learner@acme.test      Learner
  both@acme.test         Instructor and Assessor together

  admin@harbour.test     Administrator at the second tenant
  learner@harbour.test   Learner at the second tenant

Sign in to both tenants to see the branding change and the isolation hold.
`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
