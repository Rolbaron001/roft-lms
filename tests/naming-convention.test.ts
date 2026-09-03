/**
 * Changing how a tenant's filenames are read, against a live database.
 *
 * The field has existed since capture was built and nothing ever wrote to it,
 * so every tenant sat permanently on the default. These cover the write path
 * and, more importantly, the settings it refuses — because the failure here is
 * quiet. A convention saved with a code the classifier cannot match does not
 * error; it just means every upload from then on arrives as a blank form, and
 * whoever is doing the uploading assumes that is normal.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { organisations, userRoles, users } from "@/db/schema";
import {
  CaptureError,
  classifyFilename,
  DEFAULT_CONVENTION,
  namingConventionFor,
  setNamingConvention,
} from "@/lib/capture";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let instructor: AuthenticatedSession;

function sessionFor(roles: Role[], userId: string): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-0000-0000-000000000000",
    userId,
    organisationId,
    email: "test@example.test",
    firstName: "Test",
    lastName: "User",
    roles,
    permissions: permissionsFor({ roles }),
    mustChangePassword: false,
    aiOn: false,
  };
}

beforeAll(async () => {
  const slug = `naming-${Date.now()}`;

  const created = await withPlatformScope("naming setup", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({
        slug,
        legalName: `${slug} Ltd`,
        displayName: "Naming Test Co",
        status: "active",
      })
      .returning({ id: organisations.id });

    const people = await tx
      .insert(users)
      .values(
        ["admin", "instructor"].map((name) => ({
          organisationId: organisation.id,
          email: `${name}@naming.test`,
          firstName: name,
          lastName: "Tester",
          status: "active" as const,
        })),
      )
      .returning({ id: users.id, email: users.email });

    const byEmail = new Map(people.map((row) => [row.email, row.id]));

    await tx.insert(userRoles).values([
      {
        organisationId: organisation.id,
        userId: byEmail.get("admin@naming.test")!,
        role: "tenant_admin" as const,
      },
      {
        organisationId: organisation.id,
        userId: byEmail.get("instructor@naming.test")!,
        role: "instructor" as const,
      },
    ]);

    return {
      organisationId: organisation.id,
      ids: Object.fromEntries(byEmail),
    };
  });

  organisationId = created.organisationId;
  admin = sessionFor(["tenant_admin"], created.ids["admin@naming.test"]);
  instructor = sessionFor(
    ["instructor"],
    created.ids["instructor@naming.test"],
  );
});

afterAll(async () => {
  await withPlatformScope("naming teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
});

describe("a tenant that has never set one", () => {
  it("falls back to the default rather than to nothing", async () => {
    const convention = await namingConventionFor(admin);

    expect(convention).toEqual(DEFAULT_CONVENTION);
  });
});

describe("changing it", () => {
  it("is saved and read back", async () => {
    await setNamingConvention(admin, {
      pattern: "{provider}-{qualification}-{studyUnit}-{artefact}{number}",
      artefactCodes: { WKB: "workbook", SUM: "summative_assessment" },
      memorandumMarker: "MEMO",
    });

    const convention = await namingConventionFor(admin);

    expect(convention.artefactCodes).toEqual({
      WKB: "workbook",
      SUM: "summative_assessment",
    });
    expect(convention.memorandumMarker).toBe("MEMO");
  });

  /**
   * The whole point of the setting. A file named to the tenant's own
   * convention has to be read by it — otherwise the setting is decoration.
   */
  it("changes what the App reads out of a filename", async () => {
    const convention = await namingConventionFor(admin);

    expect(classifyFilename("ACME 654321 SU3 WKB2 MEMO.docx", convention))
      .toMatchObject({
        provider: "ACME",
        qualification: "654321",
        studyUnit: "SU3",
        artefact: "workbook",
        number: "2",
        isMemorandum: true,
      });

    // And the old codes stop being recognised, which is the other half of it.
    expect(
      classifyFilename("ACME 654321 SU3 WB2.docx", convention).artefact,
    ).toBeNull();
  });

  it("upper-cases codes so a lower-case filename still matches", async () => {
    await setNamingConvention(admin, {
      pattern: DEFAULT_CONVENTION.pattern,
      artefactCodes: { wb: "workbook" },
      memorandumMarker: "ag",
    });

    const convention = await namingConventionFor(admin);

    expect(convention.artefactCodes).toEqual({ WB: "workbook" });
    expect(convention.memorandumMarker).toBe("AG");
  });
});

describe("what it refuses", () => {
  it("refuses a convention with no codes at all", async () => {
    await expect(
      setNamingConvention(admin, {
        pattern: DEFAULT_CONVENTION.pattern,
        artefactCodes: {},
        memorandumMarker: "AG",
      }),
    ).rejects.toThrow(/at least one artefact code/);
  });

  it("refuses a code that could not appear as one word in a filename", async () => {
    await expect(
      setNamingConvention(admin, {
        pattern: DEFAULT_CONVENTION.pattern,
        artefactCodes: { "WB 1": "workbook" },
        memorandumMarker: "AG",
      }),
    ).rejects.toThrow(/letters and digits only/);
  });

  /**
   * The subtle one. If the memorandum marker is also an artefact code, one
   * token in the filename means both "this is a workbook" and "this is the
   * answer guide", and the classifier has to guess between them.
   */
  it("refuses a marker that is also an artefact code", async () => {
    await expect(
      setNamingConvention(admin, {
        pattern: DEFAULT_CONVENTION.pattern,
        artefactCodes: { AG: "workbook" },
        memorandumMarker: "AG",
      }),
    ).rejects.toThrow(/cannot mean both/);
  });

  it("refuses somebody without the permission", async () => {
    await expect(
      setNamingConvention(instructor, {
        pattern: DEFAULT_CONVENTION.pattern,
        artefactCodes: { WB: "workbook" },
        memorandumMarker: "AG",
      }),
    ).rejects.toThrow();
  });

  it("leaves the saved convention alone when it refuses", async () => {
    const before = await namingConventionFor(admin);

    await expect(
      setNamingConvention(admin, {
        pattern: DEFAULT_CONVENTION.pattern,
        artefactCodes: {},
        memorandumMarker: "AG",
      }),
    ).rejects.toThrow(CaptureError);

    expect(await namingConventionFor(admin)).toEqual(before);
  });
});
