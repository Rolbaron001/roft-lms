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
const {
  organisations,
  users,
  userRoles,
  competencyFrameworks,
  competencies,
  qualifications,
  curriculumModules,
  assessmentCriteria,
  courses,
  courseSections,
  courseCompetencies,
  lessons,
  lessonCriteria,
  enrolments,
  progressRecords,
} = await import("../db/schema");
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
      // Plain ASCII: the Windows console renders an em dash as mojibake.
      console.log("  Data already present - leaving it alone.");
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

    const usersByEmail = new Map<string, string>();

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

        usersByEmail.set(seedUser.email, created.id);

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

    const insertedCompetencies = await tx
      .insert(competencies)
      .values([
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
      ])
      .returning({ id: competencies.id, code: competencies.code });

    const competencyByCode = new Map(
      insertedCompetencies.map((row) => [row.code, row.id]),
    );

    // -----------------------------------------------------------------------
    // A qualification, two courses and some learners already part-way through.
    //
    // Built here rather than clicked in by hand so the demonstration state is
    // reproducible: reset-demo-data.bat restores exactly this, which matters
    // if something is changed by accident five minutes before a meeting.
    // -----------------------------------------------------------------------

    const [qualification] = await tx
      .insert(qualifications)
      .values({
        organisationId: acme.id,
        title: "Occupational Certificate: Mine Plant Operator",
        description:
          "Occupational qualification for plant operators working on surface mining operations.",
        qctoCode: "QCTO-2026-0451",
        saqaId: "118742",
        ofoCode: "2026-81121",
        nqfLevel: 4,
        totalCredits: 120,
        assessmentQualityPartner: "MQA",
        status: "published",
      })
      .returning({ id: qualifications.id });

    const [knowledgeModule] = await tx
      .insert(curriculumModules)
      .values({
        organisationId: acme.id,
        qualificationId: qualification.id,
        component: "knowledge",
        code: "KM-01",
        title: "Plant safety principles and legislation",
        credits: 12,
        notionalHours: 120,
        sortOrder: 0,
      })
      .returning({ id: curriculumModules.id });

    // A practical module as well, so the tripartite structure is visible
    // rather than merely described.
    await tx.insert(curriculumModules).values({
      organisationId: acme.id,
      qualificationId: qualification.id,
      component: "practical",
      code: "PM-01",
      title: "Safe start-up and shut-down of plant",
      credits: 18,
      notionalHours: 180,
      sortOrder: 1,
    });

    const criteria = await tx
      .insert(assessmentCriteria)
      .values([
        {
          organisationId: acme.id,
          curriculumModuleId: knowledgeModule.id,
          code: "IAC-01",
          description:
            "Explains the employer's legal duties under mine health and safety legislation.",
          sortOrder: 0,
        },
        {
          organisationId: acme.id,
          curriculumModuleId: knowledgeModule.id,
          code: "IAC-02",
          description:
            "Identifies hazards present in a described plant operating environment.",
          sortOrder: 1,
        },
      ])
      .returning({ id: assessmentCriteria.id, code: assessmentCriteria.code });

    const criterionByCode = new Map(
      criteria.map((row) => [row.code, row.id]),
    );

    /** Builds a course, its lessons, and the criteria each lesson covers. */
    async function buildCourse(options: {
      title: string;
      description: string;
      status: "draft" | "published";
      competencyCode: string;
      lessons: { title: string; body: string; covers: string[] }[];
    }) {
      const [course] = await tx
        .insert(courses)
        .values({
          organisationId: acme.id,
          curriculumModuleId: knowledgeModule.id,
          title: options.title,
          description: options.description,
          status: options.status,
          ownerId: usersByEmail.get("instructor@acme.test")!,
          publishedAt: options.status === "published" ? new Date() : null,
          estimatedMinutes: options.lessons.length * 20,
        })
        .returning({ id: courses.id });

      await tx.insert(courseCompetencies).values({
        organisationId: acme.id,
        courseId: course.id,
        competencyId: competencyByCode.get(options.competencyCode)!,
        proficiencyLevel: "Competent",
      });

      const [section] = await tx
        .insert(courseSections)
        .values({
          organisationId: acme.id,
          courseId: course.id,
          title: "Core content",
          sortOrder: 0,
        })
        .returning({ id: courseSections.id });

      const created: string[] = [];

      for (const [index, lesson] of options.lessons.entries()) {
        const [row] = await tx
          .insert(lessons)
          .values({
            organisationId: acme.id,
            sectionId: section.id,
            title: lesson.title,
            contentType: "text",
            body: lesson.body,
            durationMinutes: 20,
            sortOrder: index,
          })
          .returning({ id: lessons.id });

        created.push(row.id);

        if (lesson.covers.length > 0) {
          await tx.insert(lessonCriteria).values(
            lesson.covers.map((code) => ({
              organisationId: acme.id,
              lessonId: row.id,
              criterionId: criterionByCode.get(code)!,
            })),
          );
        }
      }

      return { courseId: course.id, lessonIds: created };
    }

    // Fully covered and published: the one learners are working through.
    const safety = await buildCourse({
      title: "Plant Safety Fundamentals",
      description:
        "The legal framework for mine health and safety, and how to recognise hazards on the plant floor.",
      status: "published",
      competencyCode: "OPS-01",
      lessons: [
        {
          title: "Employer duties under the Mine Health and Safety Act",
          body: "The Act places a general duty on the employer to provide and maintain a working environment that is safe and without risk to health.\n\nIn practice this means identifying hazards before work begins, putting controls in place, and keeping a record that both were done. The duty cannot be delegated away to a contractor: an employer remains responsible for conditions on its own site.",
          covers: ["IAC-01"],
        },
        {
          title: "Identifying hazards on the plant floor",
          body: "A hazard is anything with the potential to cause harm. A risk is the likelihood that it will.\n\nWalking a plant area, work through the same four questions each time: what could release energy unexpectedly, what could someone fall from or into, what is moving that a person could contact, and what would happen if the power failed right now.",
          covers: ["IAC-02"],
        },
      ],
    });

    // Deliberately incomplete, so the publish refusal can be shown rather than
    // described: it covers IAC-01 but nothing addresses IAC-02.
    await buildCourse({
      title: "Equipment Fault Diagnosis (in development)",
      description:
        "Draft course. One assessment criterion is not yet covered by any lesson, so the platform will refuse to publish it.",
      status: "draft",
      competencyCode: "OPS-02",
      lessons: [
        {
          title: "Reading fault codes",
          body: "Fault codes narrow the search; they rarely identify the cause on their own. Confirm the reading against the machine's behaviour before replacing anything.",
          covers: ["IAC-01"],
        },
      ],
    });

    // Two learners on the published course, one part-way through, so the
    // progress reporting has something real to show.
    const [samEnrolment] = await tx
      .insert(enrolments)
      .values({
        organisationId: acme.id,
        userId: usersByEmail.get("learner@acme.test")!,
        courseId: safety.courseId,
        enrolledById: usersByEmail.get("admin@acme.test")!,
        status: "in_progress",
        startedAt: new Date(),
        dueDate: new Date(Date.now() + 14 * 86_400_000),
      })
      .returning({ id: enrolments.id });

    await tx.insert(progressRecords).values({
      organisationId: acme.id,
      enrolmentId: samEnrolment.id,
      lessonId: safety.lessonIds[0],
      state: "completed",
      firstAccessedAt: new Date(),
      lastAccessedAt: new Date(),
      completedAt: new Date(),
    });

    await tx.insert(enrolments).values({
      organisationId: acme.id,
      userId: usersByEmail.get("manager@acme.test")!,
      courseId: safety.courseId,
      enrolledById: usersByEmail.get("admin@acme.test")!,
      status: "assigned",
      dueDate: new Date(Date.now() + 14 * 86_400_000),
    });
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
