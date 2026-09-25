/**
 * Archiving a cohort, against a live database and real storage.
 *
 * Job sheet 4.3. What these guard is the one thing the archive must never get
 * wrong: evidence leaving the server without a proven copy somewhere else. So
 * the tests are mostly about refusals. Nothing is removed before the provider's
 * copy matches; a copy that does not match removes nothing; a restore that is
 * not the same archive changes nothing.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import {
  assessmentCriteria,
  assessmentDecisions,
  assessmentSubmissions,
  assessments,
  certificates,
  cohortArchives,
  cohortMembers,
  cohorts,
  courses,
  curriculumModules,
  enrolmentDocuments,
  enrolments,
  evidenceArtifacts,
  moderationRecords,
  organisations,
  qualifications,
  statementsOfResults,
  studyUnits,
  userRoles,
  users,
} from "@/db/schema";
import { ChunkedFingerprint } from "@/lib/archive-format";
import {
  abandonArchive,
  appendRestoreChunk,
  ArchiveError,
  archiveForDownload,
  cohortArchiveState,
  confirmArchiveCopy,
  finishRestore,
  removeArchivedFiles,
  restoreProgress,
  startCohortArchive,
} from "@/lib/cohort-archive";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";
import { buildStorageKey, getObject, putObject } from "@/lib/storage";
import { readEvidence, UploadError } from "@/lib/uploads";

let organisationId: string;
let workRoot: string;
let admin: AuthenticatedSession;
let assessor: AuthenticatedSession;
let cohortId: string;
let qualificationId: string;
let courseId: string;

const people: Record<string, string> = {};
const keys: Record<string, string> = {};
const contents: Record<string, Uint8Array> = {};

const sha256 = async (bytes: Uint8Array) =>
  new Uint8Array(createHash("sha256").update(bytes).digest());

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "archive@example.test",
    firstName: "Archive",
    lastName: "Admin",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

/** Verification matches on the last twenty characters, so they must differ. */
function reference(): string {
  return randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase();
}

function sample(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (i * 17 + seed) & 0xff;
  return out;
}

/** What the provider's browser does with the file they saved. */
async function fingerprintOf(bytes: Uint8Array) {
  const f = new ChunkedFingerprint(sha256);
  for (let at = 0; at < bytes.length; at += 8 * 1024 * 1024) {
    await f.update(bytes.subarray(at, at + 8 * 1024 * 1024));
  }
  return f.finish();
}

async function downloaded(archiveId: string): Promise<Uint8Array> {
  const download = await archiveForDownload(admin, archiveId);
  return new Uint8Array(await readFile(download.path));
}

async function store(name: string, bytes: Uint8Array) {
  const key = buildStorageKey(organisationId, "archive-test", name);
  const stored = await putObject(key, bytes);
  keys[name] = key;
  contents[name] = bytes;
  return stored;
}

async function expectReason(promise: Promise<unknown>, reason: ArchiveError["reason"]) {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof ArchiveError && error.reason === reason,
  );
}

async function row(archiveId: string) {
  return withPlatformScope("archive test read", async (tx) => {
    const [found] = await tx.select().from(cohortArchives).where(eq(cohortArchives.id, archiveId));
    return found;
  });
}

async function evidenceRow(name: string) {
  return withPlatformScope("archive test read", async (tx) => {
    const [found] = await tx
      .select()
      .from(evidenceArtifacts)
      .where(eq(evidenceArtifacts.storageKey, keys[name]));
    return found;
  });
}

/** Builds, downloads, checks and removes: the whole ordinary path. */
async function archiveAndRemove() {
  const { archiveId } = await startCohortArchive(admin, cohortId, { wait: true });
  const copy = await downloaded(archiveId);
  await confirmArchiveCopy(admin, archiveId, await fingerprintOf(copy));
  await removeArchivedFiles(admin, archiveId);
  return { archiveId, copy };
}

beforeAll(async () => {
  workRoot = await mkdtemp(join(tmpdir(), "roft-archive-"));
  process.env.ARCHIVE_WORK_ROOT = workRoot;

  const slug = `archive-${Date.now()}`;
  organisationId = await withPlatformScope("archive test setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: "Archive Test Co", status: "active" })
      .returning({ id: organisations.id });
    return organisation.id;
  });

  await withPlatformScope("archive test fixture", async (tx) => {
    for (const [name, roles] of [
      ["admin", ["tenant_admin"]],
      ["assessor", ["assessor"]],
      ["moderator", ["moderator"]],
      ["thandi", ["learner"]],
      ["sipho", ["learner"]],
      ["lerato", ["learner"]],
    ] as [string, Role[]][]) {
      const [user] = await tx
        .insert(users)
        .values({
          organisationId,
          email: `${name}-${slug}@example.test`,
          firstName: name.charAt(0).toUpperCase() + name.slice(1),
          lastName: "Tester",
          status: "active",
        })
        .returning({ id: users.id });
      people[name] = user.id;
      for (const role of roles) {
        await tx.insert(userRoles).values({ organisationId, userId: user.id, role });
      }
    }

    const [qualification] = await tx
      .insert(qualifications)
      .values({ organisationId, title: "Occupational Certificate: Archive Officer" })
      .returning({ id: qualifications.id });
    qualificationId = qualification.id;

    const [module] = await tx
      .insert(curriculumModules)
      .values({ organisationId, qualificationId, component: "knowledge", code: "KM-01", title: "Records" })
      .returning({ id: curriculumModules.id });

    const [criterion] = await tx
      .insert(assessmentCriteria)
      .values({ organisationId, curriculumModuleId: module.id, code: "IAC0101", description: "Files a record correctly" })
      .returning({ id: assessmentCriteria.id });

    const [unit] = await tx
      .insert(studyUnits)
      .values({ organisationId, qualificationId, code: "SU1", title: "Keeping records" })
      .returning({ id: studyUnits.id });

    const [course] = await tx
      .insert(courses)
      .values({ organisationId, studyUnitId: unit.id, title: "SU1 Keeping records", status: "published" })
      .returning({ id: courses.id });
    courseId = course.id;

    // A second programme, which Sipho is still on.
    const [otherCourse] = await tx
      .insert(courses)
      .values({ organisationId, title: "Unrelated short course", status: "published" })
      .returning({ id: courses.id });

    const [cohort] = await tx
      .insert(cohorts)
      .values({ organisationId, courseId, name: "Archive Officer 2026 A", code: "ARC-26A", startDate: "2026-01-12" })
      .returning({ id: cohorts.id });
    cohortId = cohort.id;

    const [assessment] = await tx
      .insert(assessments)
      .values({ organisationId, courseId, title: "SU1 Summative", purpose: "summative", status: "published" })
      .returning({ id: assessments.id });

    for (const name of ["thandi", "sipho", "lerato"]) {
      await tx.insert(cohortMembers).values({ organisationId, cohortId, userId: people[name] });
      const [enrolment] = await tx
        .insert(enrolments)
        .values({ organisationId, userId: people[name], courseId, qualificationId, status: "completed" })
        .returning({ id: enrolments.id });

      const [submission] = await tx
        .insert(assessmentSubmissions)
        .values({ organisationId, assessmentId: assessment.id, userId: people[name], enrolmentId: enrolment.id, status: "finalised" })
        .returning({ id: assessmentSubmissions.id });

      const [decision] = await tx
        .insert(assessmentDecisions)
        .values({
          organisationId,
          submissionId: submission.id,
          assessorId: people.assessor,
          outcome: "competent",
          criterionOutcomes: { [criterion.id]: "competent" },
          criterionNotes: { [criterion.id]: `Observed ${name} filing a lease correctly` },
        })
        .returning({ id: assessmentDecisions.id });
      await tx.insert(moderationRecords).values({
        organisationId,
        decisionId: decision.id,
        moderatorId: people.moderator,
        outcome: "endorsed",
        samplingReason: "random",
      });

      for (const [file, size] of [[`${name}-evidence.pdf`, 40_000], [`${name}-photo.jpg`, 120_000]] as const) {
        const stored = await store(file, sample(size, file.length));
        await tx.insert(evidenceArtifacts).values({
          organisationId,
          submissionId: submission.id,
          filename: file.endsWith(".pdf") ? "evidence.pdf" : "photo.jpg",
          storageKey: stored.storageKey,
          mimeType: "application/octet-stream",
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
          uploadedById: people[name],
        });
      }

      const idDocument = await store(`${name}-id.pdf`, sample(9_000, name.length));
      await tx.insert(enrolmentDocuments).values({
        organisationId,
        userId: people[name],
        kind: "certified_id",
        storageKey: idDocument.storageKey,
        filename: "certified id.pdf",
        sizeBytes: idDocument.sizeBytes,
        sha256: idDocument.sha256,
      });

      // Lerato resits: no certificate and no statement yet.
      if (name === "lerato") continue;

      await tx.insert(statementsOfResults).values({
        organisationId,
        userId: people[name],
        qualificationId,
        verificationReference: `SOR-${reference()}`,
        statement: {
          learner: { firstName: name, lastName: "Tester", nationalId: null },
          qualification: {
            title: "Occupational Certificate: Archive Officer",
            saqaId: null,
            curriculumCode: null,
            nqfLevel: 4,
            totalCredits: 40,
            assessmentQualityPartner: null,
          },
          provider: { legalName: "Archive Test Co", accreditationNumber: null },
          modules: [{ code: "KM-01", title: "Records", component: "knowledge", credits: 8, route: "assessed", result: "Competent", achievedAt: "2026-06-01" }],
        },
      });

      const certificateFile = await store(`${name}-certificate.pdf`, sample(5_000, 99));
      await tx.insert(certificates).values({
        organisationId,
        userId: people[name],
        enrolmentId: enrolment.id,
        verificationReference: `CERT-${name}-${reference()}`,
        title: "Certificate of competence",
        storageKey: certificateFile.storageKey,
      });
    }

    await tx.insert(enrolments).values({
      organisationId,
      userId: people.sipho,
      courseId: otherCourse.id,
      status: "in_progress",
    });
  });

  admin = sessionFor(["tenant_admin"], people.admin);
  assessor = sessionFor(["assessor"], people.assessor);
});

afterAll(async () => {
  await withPlatformScope("archive test teardown", async (tx) => {
    await tx.delete(certificates).where(eq(certificates.organisationId, organisationId));
    await tx.delete(moderationRecords).where(eq(moderationRecords.organisationId, organisationId));
    await tx.delete(assessmentDecisions).where(eq(assessmentDecisions.organisationId, organisationId));
    await tx.delete(evidenceArtifacts).where(eq(evidenceArtifacts.organisationId, organisationId));
    await tx.delete(organisations).where(eq(organisations.id, organisationId));
  });
  await rm(workRoot, { recursive: true, force: true });
});

describe("who is ready", () => {
  it("offers the certificated and leaves the resit behind, saying why", async () => {
    const state = await cohortArchiveState(admin, cohortId);
    expect(state.qualification?.id).toBe(qualificationId);
    expect(state.ready.map((l) => l.userId).sort()).toEqual([people.sipho, people.thandi].sort());
    expect(state.waiting).toHaveLength(1);
    expect(state.waiting[0].userId).toBe(people.lerato);
    expect(state.waiting[0].reason).toContain("a certificate and a statement of results");
  });

  it("is for a provider administrator only", async () => {
    await expect(cohortArchiveState(assessor, cohortId)).rejects.toThrow();
    await expect(startCohortArchive(assessor, cohortId, { wait: true })).rejects.toThrow();
  });
});

describe("building an archive", () => {
  let archiveId: string;
  let opened: Record<string, Uint8Array>;

  beforeAll(async () => {
    ({ archiveId } = await startCohortArchive(admin, cohortId, { wait: true }));
    opened = unzipSync(await downloaded(archiveId));
  });

  afterAll(async () => {
    await abandonArchive(admin, archiveId);
  });

  it("finishes, with a size and a fingerprint recorded", async () => {
    const built = await row(archiveId);
    expect(built.status).toBe("built");
    expect(built.fingerprint).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(built.sizeBytes).toBe((await stat(built.workingPath!)).size);
  });

  it("holds every file byte for byte, and nobody who was not ready", async () => {
    const names = Object.keys(opened);
    expect(names).toContain("index.html");
    expect(names).toContain("manifest.json");
    expect(names).toContain("Thandi Tester/index.html");
    expect(names.some((n) => n.startsWith("Lerato"))).toBe(false);

    const evidence = opened["Thandi Tester/SU1 Summative attempt 1/evidence.pdf"];
    expect(evidence).toBeDefined();
    expect(Buffer.from(evidence).equals(Buffer.from(contents["thandi-evidence.pdf"]))).toBe(true);
  });

  it("reads without the platform, criteria and moderation included", () => {
    const page = new TextDecoder().decode(opened["Thandi Tester/index.html"]);
    expect(page).toContain("IAC0101");
    expect(page).toContain("Observed thandi filing a lease correctly");
    expect(page).toContain("Endorsed");
    expect(page).toContain("CERT-thandi");
  });

  it("keeps an identity document on the server while another programme needs it", () => {
    const manifest = JSON.parse(new TextDecoder().decode(opened["manifest.json"]));
    const documentOf = (name: string) =>
      manifest.learners
        .find((l: { name: string }) => l.name === name)
        .files.find((f: { source: { table: string } }) => f.source.table === "enrolment_documents");
    expect(documentOf("Thandi Tester").removeFromServer).toBe(true);
    expect(documentOf("Sipho Tester").removeFromServer).toBe(false);
  });

  it("will not start a second archive of the same learners", async () => {
    await expectReason(startCohortArchive(admin, cohortId, { wait: true }), "nobody_eligible");
  });

  it("removes nothing before the copy is checked", async () => {
    await expectReason(removeArchivedFiles(admin, archiveId), "wrong_state");
    expect((await evidenceRow("thandi-evidence.pdf")).archivedAt).toBeNull();
  });

  it("refuses a copy that differs, and says so without removing anything", async () => {
    const copy = await downloaded(archiveId);
    const damaged = copy.slice();
    damaged[damaged.length - 100] ^= 1;
    await expectReason(confirmArchiveCopy(admin, archiveId, await fingerprintOf(damaged)), "mismatch");
    await expectReason(
      confirmArchiveCopy(admin, archiveId, await fingerprintOf(copy.subarray(0, copy.length - 1))),
      "mismatch",
    );
    expect((await row(archiveId)).status).toBe("built");
  });
});

describe("removing and restoring", () => {
  it("takes the files off the server and leaves every record", async () => {
    const { archiveId, copy } = await archiveAndRemove();

    const removed = await row(archiveId);
    expect(removed.status).toBe("removed");
    expect(removed.workingPath).toBeNull();
    await expect(stat(join(workRoot, organisationId, `${archiveId}.zip`))).rejects.toThrow();

    const evidence = await evidenceRow("thandi-evidence.pdf");
    expect(evidence.archiveId).toBe(archiveId);
    expect(evidence.archivedAt).not.toBeNull();
    await expect(getObject(keys["thandi-evidence.pdf"])).rejects.toThrow();
    await expect(getObject(keys["thandi-certificate.pdf"])).rejects.toThrow();

    // Asking for it says where it went, and only to somebody entitled to it.
    const asked = readEvidence(admin, evidence.id);
    await expect(asked).rejects.toBeInstanceOf(UploadError);
    await expect(asked).rejects.toMatchObject({ code: "archived" });
    await expect(asked).rejects.toThrow(/archived on \d{4}-\d{2}-\d{2}, in "ARC-26A archive/);
    await expect(readEvidence(sessionFor(["learner"], people.sipho), evidence.id)).rejects.toMatchObject({
      code: "not_permitted",
    });

    // Sipho's identity document stays; his other programme is still running.
    expect(Buffer.from(await getObject(keys["sipho-id.pdf"])).equals(Buffer.from(contents["sipho-id.pdf"]))).toBe(true);
    // Lerato was never in it.
    expect(Buffer.from(await getObject(keys["lerato-evidence.pdf"])).length).toBe(40_000);

    const state = await cohortArchiveState(admin, cohortId);
    expect(state.ready).toHaveLength(0);
    expect(state.archived.map((l) => l.userId).sort()).toEqual([people.sipho, people.thandi].sort());

    // Restore, in pieces, as a browser would send it.
    await expectReason(appendRestoreChunk(admin, archiveId, 5, new Uint8Array(3)), "upload");
    const piece = 50_000;
    for (let at = 0; at < copy.length; at += piece) {
      await appendRestoreChunk(admin, archiveId, at, copy.subarray(at, at + piece));
    }
    expect(await restoreProgress(admin, archiveId)).toEqual({ received: copy.length, expected: copy.length });
    await finishRestore(admin, archiveId);

    expect((await row(archiveId)).status).toBe("restored");
    expect((await evidenceRow("thandi-evidence.pdf")).archivedAt).toBeNull();
    expect(Buffer.from(await getObject(keys["thandi-evidence.pdf"])).equals(Buffer.from(contents["thandi-evidence.pdf"]))).toBe(true);
    expect(Buffer.from(await getObject(keys["thandi-certificate.pdf"])).equals(Buffer.from(contents["thandi-certificate.pdf"]))).toBe(true);
    expect((await cohortArchiveState(admin, cohortId)).ready).toHaveLength(2);
  });

  it("restores nothing from a file that is not the archive", async () => {
    const { archiveId, copy } = await archiveAndRemove();
    const altered = copy.slice();
    altered[200] ^= 1;
    await appendRestoreChunk(admin, archiveId, 0, altered);
    await expectReason(finishRestore(admin, archiveId), "mismatch");

    expect((await row(archiveId)).status).toBe("removed");
    await expect(getObject(keys["thandi-evidence.pdf"])).rejects.toThrow();

    // The genuine copy still works afterwards.
    await appendRestoreChunk(admin, archiveId, 0, copy);
    await finishRestore(admin, archiveId);
    expect((await row(archiveId)).status).toBe("restored");
  });
});

describe("a file that cannot be read", () => {
  it("fails the build, removes nothing, and frees the learners", async () => {
    const saved = await getObject(keys["sipho-photo.jpg"]);
    await rm(join(process.env.STORAGE_LOCAL_ROOT ?? "storage", keys["sipho-photo.jpg"]));
    try {
      const { archiveId } = await startCohortArchive(admin, cohortId, { wait: true });
      const failed = await row(archiveId);
      expect(failed.status).toBe("failed");
      expect(failed.failureReason).toContain("could not be read");
      expect((await cohortArchiveState(admin, cohortId)).ready).toHaveLength(2);
      await expect(stat(join(workRoot, organisationId, `${archiveId}.zip.part`))).rejects.toThrow();
    } finally {
      await writeFile(join(process.env.STORAGE_LOCAL_ROOT ?? "storage", keys["sipho-photo.jpg"]), saved);
    }
  });
});
