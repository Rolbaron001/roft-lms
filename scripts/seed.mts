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
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { eq, inArray } from "drizzle-orm";

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
  assessments,
  assessmentItems,
} = await import("../db/schema");
const { hashPassword } = await import("../lib/password");

const DEMO_SLUGS = ["roft", "acme", "harbourtraining"];

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

/**
 * ROFT's own people. Roland holds platform_owner — which manages client
 * organisations — alongside tenant_admin and instructor, which is what lets
 * him run ROFT's own academy. The design document notes explicitly that one
 * person may hold several roles.
 */
const ROFT_USERS: SeedUser[] = [
  {
    email: "roland@roftbusiness.org",
    firstName: "Roland",
    lastName: "Jones",
    roles: ["platform_owner", "tenant_admin", "instructor"],
    jobTitle: "Founder, Strategic Workforce Advisory",
  },
  {
    email: "advisor@roftbusiness.org",
    firstName: "Nomvula",
    lastName: "Sithole",
    roles: ["instructor", "assessor"],
    jobTitle: "Principal Workforce Advisor",
    registrationNumber: "ASR-2026-0001",
  },
  {
    email: "associate@roftbusiness.org",
    firstName: "Daniel",
    lastName: "Meyer",
    roles: ["learner"],
    jobTitle: "Associate Consultant",
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

    /**
     * ROFT itself.
     *
     * The design document gives the platform two jobs: hosting the learning
     * ROFT delivers in its own advisory engagements, and being deployable as a
     * branded system for a client. ROFT is therefore a tenant like any other —
     * its people sign in the same way, its courses work the same way — and
     * what separates it is that its owner also holds the platform_owner role.
     *
     * It resolves at the platform host, so http://localhost:3000 is ROFT's own
     * academy and the console for managing every other client.
     */
    const [roft] = await tx
      .insert(organisations)
      .values({
        slug: "roft",
        legalName: "ROFT Strategic Workforce Advisory",
        displayName: "ROFT Strategic Workforce Advisory",
        status: "active",
        deploymentMode: "shared_cloud",
        // The canonical ROFT palette: Deep Navy and Saffron Gold.
        primaryColour: "#0d1e32",
        accentColour: "#b9975b",
        featureFlags: {
          qcto_portfolio: true,
          statutory_reporting: true,
          learning_paths: true,
        },
        physicalAddress: {
          city: "Johannesburg",
          province: "Gauteng",
          country: "South Africa",
        },
        dataRetentionYears: 7,
      })
      .returning({ id: organisations.id });

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
      [roft.id, ROFT_USERS],
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

    // -----------------------------------------------------------------------
    // ROFT's own academy.
    //
    // Built from ROFT's actual service lines rather than filler, so the
    // platform demonstrates the workforce-risk framing it is meant to carry:
    // risk here means capability vulnerability — skills gaps, single points of
    // failure, thin supervisory cover — never fraud or financial compliance.
    // -----------------------------------------------------------------------
    const [roftFramework] = await tx
      .insert(competencyFrameworks)
      .values({
        organisationId: roft.id,
        name: "ROFT Advisory Capability Framework",
        description:
          "The capabilities a ROFT advisor applies across competency framework, career path, skills gap and workforce planning engagements.",
        source: "ROFT Strategic Workforce Advisory",
        version: "1.0",
      })
      .returning({ id: competencyFrameworks.id });

    const roftCompetencies = await tx
      .insert(competencies)
      .values(
        [
          [
            "ADV-01",
            "Workforce risk analysis",
            "Identifies and scores human-capital vulnerabilities: skills deficiency, single points of failure, weak supervisory cover and succession gaps.",
          ],
          [
            "ADV-02",
            "Competency framework design",
            "Builds capability-based frameworks with defined proficiency levels and behavioural indicators, mapped to recognised occupational standards.",
          ],
          [
            "ADV-03",
            "Skills gap analysis",
            "Measures the distance between current and required capability, prioritises the gaps, and maps a build, buy or rent response.",
          ],
          [
            "ADV-04",
            "Career path design",
            "Designs transparent progression routes and lateral moves that retain talent and remove single points of failure.",
          ],
          [
            "ADV-05",
            "Strategic workforce planning",
            "Models workforce demand and supply three to five years out, including automation exposure and critical-role succession.",
          ],
        ].map(([code, name, description]) => ({
          organisationId: roft.id,
          frameworkId: roftFramework.id,
          code,
          name,
          description,
          proficiencyLevels: [
            "Aware",
            "Practitioner",
            "Advisor",
            "Lead Advisor",
          ],
        })),
      )
      .returning({ id: competencies.id, code: competencies.code });

    const roftCompetencyByCode = new Map(
      roftCompetencies.map((row) => [row.code, row.id]),
    );

    const [roftCourse] = await tx
      .insert(courses)
      .values({
        organisationId: roft.id,
        title: "Workforce Risk Fundamentals",
        description:
          "How ROFT identifies capability vulnerability in a client workforce, and why a completion report cannot show it.",
        status: "published",
        ownerId: usersByEmail.get("roland@roftbusiness.org")!,
        publishedAt: new Date(),
        estimatedMinutes: 60,
      })
      .returning({ id: courses.id });

    await tx.insert(courseCompetencies).values({
      organisationId: roft.id,
      courseId: roftCourse.id,
      competencyId: roftCompetencyByCode.get("ADV-01")!,
      proficiencyLevel: "Practitioner",
    });

    const [roftSection] = await tx
      .insert(courseSections)
      .values({
        organisationId: roft.id,
        courseId: roftCourse.id,
        title: "Seeing capability vulnerability",
        sortOrder: 0,
      })
      .returning({ id: courseSections.id });

    await tx.insert(lessons).values(
      [
        [
          "What workforce risk actually means",
          "Workforce risk is capability vulnerability: the gap between what a business needs its people to be able to do and what they can currently do. It is not fraud, and it is not regulatory compliance — those are different disciplines with different owners.\n\nFour vulnerabilities account for most of what we find in an engagement: skills deficiency against a stated strategy, single points of failure where one person holds a capability alone, thin or ineffective supervisory cover, and succession gaps in critical roles.",
        ],
        [
          "Single points of failure",
          "A single point of failure is a capability held by exactly one person. It rarely appears in any report, because on paper the capability is present — the organisation can do the thing.\n\nThe vulnerability only becomes visible when you count holders rather than completions. One resignation, one extended illness, and the capability leaves with them. This is why capability coverage is counted from assessed outcomes and reported per competency, not as a training completion percentage.",
        ],
        [
          "Why completion reports mislead",
          "A completion report answers 'did people attend the training'. A capability report answers 'can this workforce do the work'. They diverge constantly.\n\nA team can show ninety per cent completion and still hold a critical capability in one pair of hands. Conversely a low completion rate against irrelevant training tells you nothing worth acting on. When advising a client, always move the conversation from activity to coverage — and be ready for the discomfort when the first coverage report lands.",
        ],
      ].map(([title, body], index) => ({
        organisationId: roft.id,
        sectionId: roftSection.id,
        title,
        contentType: "text" as const,
        body,
        durationMinutes: 20,
        sortOrder: index,
      })),
    );

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

    // A summative quiz on the published course. Summative means every
    // decision is moderated, so a demonstration reaches the moderation queue
    // without waiting for a random sample to select it.
    const [quiz] = await tx
      .insert(assessments)
      .values({
        organisationId: acme.id,
        courseId: safety.courseId,
        curriculumModuleId: knowledgeModule.id,
        title: "Plant safety knowledge check",
        instructions:
          "Answer both questions. This assessment counts towards the qualification.",
        type: "quiz",
        purpose: "summative",
        status: "published",
        passMark: 70,
        moderationSampleRate: "1.000",
      })
      .returning({ id: assessments.id });

    const employerOption = randomUUID();
    const hazardOption = randomUUID();

    await tx.insert(assessmentItems).values([
      {
        organisationId: acme.id,
        assessmentId: quiz.id,
        criterionId: criterionByCode.get("IAC-01")!,
        stem: "Who holds the general duty to provide a safe working environment?",
        type: "multiple_choice",
        options: [
          { id: employerOption, text: "The employer" },
          { id: randomUUID(), text: "The learner" },
          { id: randomUUID(), text: "The inspector" },
        ],
        correctOptionIds: [employerOption],
        points: 1,
        sortOrder: 0,
      },
      {
        organisationId: acme.id,
        assessmentId: quiz.id,
        criterionId: criterionByCode.get("IAC-02")!,
        stem: "A hazard is best described as:",
        type: "multiple_choice",
        options: [
          { id: hazardOption, text: "Anything with the potential to cause harm" },
          { id: randomUUID(), text: "An injury that has already happened" },
        ],
        correctOptionIds: [hazardOption],
        points: 1,
        sortOrder: 1,
      },
    ]);

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

    // An overdue enrolment, so the reporting has something to flag rather than
    // showing a uniformly healthy picture nobody would need a report for.
    await tx.insert(enrolments).values({
      organisationId: acme.id,
      userId: usersByEmail.get("instructor@acme.test")!,
      courseId: safety.courseId,
      enrolledById: usersByEmail.get("admin@acme.test")!,
      status: "overdue",
      dueDate: new Date(Date.now() - 9 * 86_400_000),
    });

    /**
     * Demographic data for the statutory return.
     *
     * Every identity number below is arithmetically valid — the check digit
     * was computed, not invented — so the validation demonstrates a genuine
     * pass rather than passing because nothing was checked.
     *
     * Pieter van Wyk keeps a valid identity number but no equity or
     * disability code, so the return is submittable while the validation
     * still has something real to report. A demonstration that is blocked
     * with no way to unblock it is worse than one that shows both states.
     */
    for (const [email, nationalId, equity, gender, ofoCode] of [
      ["admin@acme.test", "8001015009087", "AF", "male", "2026-134101"],
      ["learner@acme.test", "9501285216089", "AF", "male", "2026-811201"],
      ["manager@acme.test", "8711050367089", "IN", "female", "2026-132104"],
      ["assessor@acme.test", "9107160482083", "AF", "female", "2026-235101"],
      ["moderator@acme.test", "6903045122081", "WH", "male", "2026-235101"],
      ["sdf@acme.test", "8305195744086", "AF", "male", "2026-242401"],
      ["verifier@acme.test", "7608125431083", "AF", "male", "2026-242401"],
      ["both@acme.test", "8802270913081", "CO", "female", "2026-235101"],
    ] as const) {
      await tx
        .update(users)
        .set({
          nationalId,
          equityCode: equity,
          disabilityCode: "N",
          gender,
          nationality: "South African",
          ofoCode,
        })
        .where(eq(users.id, usersByEmail.get(email)!));
    }

    // Valid identity number, but demographic fields left blank on purpose.
    await tx
      .update(users)
      .set({
        nationalId: "7411225088089",
        gender: "male",
        nationality: "South African",
        ofoCode: "2026-235101",
      })
      .where(eq(users.id, usersByEmail.get("instructor@acme.test")!));

    // Team and site on a few people so the report filters do something, and
    // the line manager has direct reports to see.
    const managerId = usersByEmail.get("manager@acme.test")!;
    for (const [email, team, site, reportsTo] of [
      ["manager@acme.test", "Plant Operations", "Rustenburg", null],
      ["learner@acme.test", "Plant Operations", "Rustenburg", managerId],
      ["instructor@acme.test", "Learning", "Johannesburg", null],
      ["assessor@acme.test", "Learning", "Johannesburg", null],
    ] as const) {
      await tx
        .update(users)
        .set({ team, site, lineManagerId: reportsTo })
        .where(eq(users.id, usersByEmail.get(email)!));
    }
  });

  console.log(`
Demo data created.

  ROFT (platform console)   http://localhost:3000
  ROFT academy              http://roft.localhost:3000
  Acme Mining Services      http://acme.localhost:3000
  Harbour Training Centre   http://harbourtraining.localhost:3000

ROFT's own people:

  roland@roftbusiness.org    Platform Owner, Administrator, Instructor
  advisor@roftbusiness.org   Instructor and Assessor
  associate@roftbusiness.org Learner

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
