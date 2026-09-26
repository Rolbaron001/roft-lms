/**
 * Working without a signal, made reachable. Job sheet A9, 27 September.
 *
 * The offline feature was built on 11 September and could not be reached:
 * nothing could switch it on, the install manifest was linked from nowhere and
 * named no icon Chrome would accept, "Take it with you" offered four general
 * pages instead of the learner's own study material, and the service worker
 * kept every page a learner opened. These hold each of those.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import {
  courseSections,
  courses,
  courseSteps,
  enrolments,
  lessons,
  organisations,
  programmeDocuments,
  userRoles,
  users,
} from "@/db/schema";
import { iconPng } from "@/lib/app-icon";
import { offlineEnabledFor, offlinePacksFor } from "@/lib/offline";
import { setTenantCapabilities } from "@/lib/provisioning";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

let organisationId: string;
const ids: Record<string, string> = {};

function sessionFor(userId: string, roles: Role[]): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "x@example.test",
    firstName: "X",
    lastName: "Y",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

beforeAll(async () => {
  const slug = `offline-reach-${Date.now()}`;
  await withPlatformScope("offline fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: "Field Rangers", status: "active" })
      .returning({ id: organisations.id });
    organisationId = organisation.id;

    for (const [name, role] of [["admin", "tenant_admin"], ["ranger", "learner"]] as [string, Role][]) {
      const [person] = await tx
        .insert(users)
        .values({ organisationId, email: `${name}-${slug}@example.test`, firstName: name, lastName: "Tester", status: "active" })
        .returning({ id: users.id });
      await tx.insert(userRoles).values({ organisationId, userId: person.id, role });
      ids[name] = person.id;
    }

    const [course] = await tx
      .insert(courses)
      .values({ organisationId, title: "Tracking in the field", status: "published" })
      .returning({ id: courses.id });
    const [section] = await tx
      .insert(courseSections)
      .values({ organisationId, courseId: course.id, title: "One" })
      .returning({ id: courseSections.id });
    const [withFile] = await tx
      .insert(lessons)
      .values({ organisationId, sectionId: section.id, title: "Spoor", storageKey: "k/spoor.pdf" })
      .returning({ id: lessons.id });
    await tx.insert(lessons).values({ organisationId, sectionId: section.id, title: "Text only" });
    const [document] = await tx
      .insert(programmeDocuments)
      .values({
        organisationId,
        courseId: course.id,
        kind: "theory_guide",
        title: "Theory guide",
        filename: "guide.pdf",
        storageKey: "k/guide.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        sha256: "a".repeat(64),
      })
      .returning({ id: programmeDocuments.id });
    await tx.insert(courseSteps).values({
      organisationId,
      courseId: course.id,
      kind: "document",
      programmeDocumentId: document.id,
      sortOrder: 0,
    });
    const [enrolment] = await tx
      .insert(enrolments)
      .values({ organisationId, userId: ids.ranger, courseId: course.id, status: "in_progress" })
      .returning({ id: enrolments.id });

    Object.assign(ids, { enrolment: enrolment.id, lesson: withFile.id, document: document.id });
  });
});

afterAll(async () => {
  await withPlatformScope("offline teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("switching it on", () => {
  it("is done from Settings by a provider administrator, and can be undone", async () => {
    const admin = sessionFor(ids.admin, ["tenant_admin"]);
    expect(await offlineEnabledFor(organisationId)).toBe(false);
    await setTenantCapabilities(admin, { offline: true });
    expect(await offlineEnabledFor(organisationId)).toBe(true);
    await setTenantCapabilities(admin, { offline: false });
    expect(await offlineEnabledFor(organisationId)).toBe(false);
    expect(source("app/settings/capabilities-form.tsx")).toMatch(/name="offline"/);
  });
});

describe("taking it with you", () => {
  it("offers the learner's own course, with its lesson files and documents", async () => {
    const packs = await offlinePacksFor(sessionFor(ids.ranger, ["learner"]));
    expect(packs).toEqual([
      {
        label: "Tracking in the field",
        paths: [
          `/learn/${ids.enrolment}`,
          `/api/lessons/${ids.lesson}/media`,
          `/api/programme-documents/${ids.document}`,
        ],
      },
    ]);
  });

  it("lets the service worker answer for that material with no signal", () => {
    const worker = source("app/sw.js/route.ts");
    expect(worker).toMatch(/MATERIAL_API/);
    // Nothing is stored just for being opened: a fresh copy replaces a held one only.
    expect(worker).toMatch(/if \(await cache\.match\(event\.request\)\)/);
  });
});

describe("installing it", () => {
  it("is linked from every page of a provider with offline on", () => {
    expect(source("app/layout.tsx")).toMatch(/manifest: "\/manifest\.webmanifest"/);
  });

  it("names the 192 and 512 pixel icons Chrome requires", () => {
    const manifest = source("app/manifest.webmanifest/route.ts");
    expect(manifest).toMatch(/sizes: "192x192"/);
    expect(manifest).toMatch(/sizes: "512x512"/);
  });

  it("draws a real PNG of the size asked for", () => {
    const png = iconPng(192, "#0f766e");
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(192);
    expect(png.readUInt32BE(20)).toBe(192);
    // The corner is the provider's colour; the middle of a page is white.
    const idatLength = png.readUInt32BE(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    const pixel = (x: number, y: number) => [...raw.subarray(y * (1 + 192 * 3) + 1 + x * 3, y * (1 + 192 * 3) + 4 + x * 3)];
    expect(pixel(0, 0)).toEqual([0x0f, 0x76, 0x6e]);
    expect(pixel(60, 96)).toEqual([255, 255, 255]);
  });
});
