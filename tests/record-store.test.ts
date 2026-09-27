/**
 * Sending learning records to a provider's own record store. Job sheet D6,
 * 27 September 2026.
 *
 * Against a small store run on this machine for the test, speaking the parts
 * of xAPI 1.0.3 the platform uses: statements POSTed as an array to
 * /statements, 200 with their ids, 409 for a statement already held.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import {
  courses,
  enrolments,
  organisations,
  qualificationAwards,
  qualifications,
  recordStoreConnections,
  userRoles,
  users,
} from "@/db/schema";
import {
  recordStoreFor,
  removeRecordStore,
  saveRecordStore,
  sendToRecordStore,
} from "@/lib/record-store";
import { permissionsFor } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

let organisationId: string;
let admin: AuthenticatedSession;
let server: Server;
let endpoint: string;

/** What the store received, and what it holds. */
const received: { auth: string | undefined; version: string | undefined; ids: string[] }[] = [];
const held = new Set<string>();
let refuse = false;

function body(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => resolve(text));
  });
}

beforeAll(async () => {
  server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/xapi/statements") {
      response.writeHead(404).end();
      return;
    }
    const statements = JSON.parse(await body(request)) as { id: string }[];
    received.push({
      auth: request.headers.authorization,
      version: request.headers["x-experience-api-version"] as string | undefined,
      ids: statements.map((s) => s.id),
    });
    if (refuse) {
      response.writeHead(401).end("bad key");
      return;
    }
    if (statements.some((s) => held.has(s.id))) {
      response.writeHead(409).end("already held");
      return;
    }
    for (const s of statements) held.add(s.id);
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(statements.map((s) => s.id)));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  endpoint = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/xapi`;

  const slug = `lrs-${Date.now()}`;
  await withPlatformScope("record store fixture", async (tx) => {
    const [organisation] = await tx
      .insert(organisations)
      .values({ slug, legalName: `${slug} Ltd`, displayName: "Record Keeper", status: "active" })
      .returning({ id: organisations.id });
    organisationId = organisation.id;

    const [person] = await tx
      .insert(users)
      .values({ organisationId, email: `admin-${slug}@example.test`, firstName: "A", lastName: "Admin", status: "active" })
      .returning({ id: users.id });
    await tx.insert(userRoles).values({ organisationId, userId: person.id, role: "tenant_admin" });
    admin = {
      sessionId: "00000000-0000-0000-0000-000000000000",
      userId: person.id,
      organisationId,
      email: "a@example.test",
      firstName: "A",
      lastName: "Admin",
      roles: ["tenant_admin"],
      permissions: permissionsFor({ roles: ["tenant_admin"] }),
      mustChangePassword: false,
      aiOn: false,
    };

    const [learner] = await tx
      .insert(users)
      .values({ organisationId, email: `learner-${slug}@example.test`, firstName: "Lea", lastName: "Rner", status: "active" })
      .returning({ id: users.id });
    const [qualification] = await tx
      .insert(qualifications)
      .values({ organisationId, title: "Occupational Certificate: Records" })
      .returning({ id: qualifications.id });
    const [course] = await tx
      .insert(courses)
      .values({ organisationId, title: "Keeping records", status: "published" })
      .returning({ id: courses.id });
    await tx.insert(enrolments).values({
      organisationId,
      userId: learner.id,
      courseId: course.id,
      qualificationId: qualification.id,
      status: "in_progress",
    });
    await tx.insert(qualificationAwards).values({
      organisationId,
      userId: learner.id,
      qualificationId: qualification.id,
      certificateNumber: "QCTO-77",
      awardedOn: "2026-11-20",
    });
  });
});

afterAll(async () => {
  await withPlatformScope("record store teardown", (tx) =>
    tx.delete(organisations).where(eq(organisations.id, organisationId)),
  );
  await new Promise((resolve) => server.close(resolve));
});

describe("connecting a store", () => {
  it("refuses an address that is not https, except on this machine", async () => {
    await expect(
      saveRecordStore(admin, { endpoint: "http://records.example.com/xapi", username: "k", secret: "s3cret-value" }, "https://keeper.example.test"),
    ).rejects.toThrow(/https/);
  });

  it("keeps the key sealed and shows only its last four characters", async () => {
    await saveRecordStore(admin, { endpoint: `${endpoint}/statements`, username: "keeper", secret: "s3cret-value" }, "https://keeper.example.test/");
    const view = await recordStoreFor(admin);
    expect(view).toMatchObject({ endpoint, username: "keeper", secretHint: "alue", enabled: true, delivered: 0 });
    expect(JSON.stringify(view)).not.toContain("s3cret-value");

    const [row] = await withPlatformScope("read sealed", (tx) =>
      tx.select().from(recordStoreConnections).where(eq(recordStoreConnections.organisationId, organisationId)),
    );
    expect(row.secretSealed).not.toContain("s3cret-value");
    expect(row.activityBase).toBe("https://keeper.example.test");
  });
});

describe("sending", () => {
  it("sends every statement once, with the version header and the key", async () => {
    const first = await sendToRecordStore(organisationId);
    // Registered on the course, and the qualification certificate.
    expect(first).toEqual({ sent: 2, alreadyHeld: 0, error: null });
    expect(received[0].version).toBe("1.0.3");
    expect(received[0].auth).toBe(`Basic ${Buffer.from("keeper:s3cret-value").toString("base64")}`);

    const again = await sendToRecordStore(organisationId);
    expect(again).toEqual({ sent: 0, alreadyHeld: 0, error: null });
    expect((await recordStoreFor(admin))?.delivered).toBe(2);
  });

  it("counts a statement the store already holds as delivered, and sends the rest", async () => {
    // Forget what was delivered, as a reconnection does, while the store keeps it.
    await removeRecordStore(admin);
    await saveRecordStore(admin, { endpoint, username: "keeper", secret: "s3cret-value" }, "https://keeper.example.test");
    const result = await sendToRecordStore(organisationId);
    expect(result).toEqual({ sent: 0, alreadyHeld: 2, error: null });
  });

  it("stops and says why when the store refuses the key, and tries again later", async () => {
    await removeRecordStore(admin);
    await saveRecordStore(admin, { endpoint, username: "keeper", secret: "wrong-secret" }, "https://keeper.example.test");
    refuse = true;
    const result = await sendToRecordStore(organisationId);
    refuse = false;
    expect(result?.sent).toBe(0);
    expect(result?.error).toMatch(/refused the key \(401\)/);
    expect((await recordStoreFor(admin))?.lastError).toMatch(/refused the key/);
  });

  it("runs from the hourly job, whose container can open the key", () => {
    expect(readFileSync(join(process.cwd(), "scripts/notify.mts"), "utf8")).toMatch(/await sendRecords\(\);/);
    const compose = readFileSync(join(process.cwd(), "docker-compose.production.yml"), "utf8");
    const tools = compose.slice(compose.indexOf("\n  tools:"), compose.indexOf("\n  mail:"));
    expect(tools).toMatch(/AI_TOKEN_KEY: \$\{AI_TOKEN_KEY:-\}/);
  });

  it("is never carried into the development site's copy", () => {
    expect(readFileSync(join(process.cwd(), "scripts/setup-development.sh"), "utf8")).toMatch(
      /delete from record_store_connections/,
    );
  });
});
