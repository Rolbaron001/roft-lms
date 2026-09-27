import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withPlatformScope, withTenant } from "@/db/client";
import { recordStoreConnections, recordStoreDeliveries } from "@/db/schema";
import { recordAudit } from "./audit";
import { hintOf, seal, sealingAvailable, unseal } from "./secret-box";
import { assertSessionCan, type AuthenticatedSession } from "./session";
import { statementsIn, type Statement } from "./xapi";

/**
 * Sending learning records to a provider's own learning record store.
 *
 * Job sheet D6, 27 September 2026. A10 let a provider download every record as
 * xAPI statements and load them elsewhere by hand. This sends them itself: the
 * hourly job (scripts/notify.mts send) posts every statement the store has not
 * yet accepted, so a record reaches the provider's store within the hour of
 * happening here.
 *
 * Checked against the xAPI 1.0.3 communication specification on 27 September,
 * not recalled: statements go as an array to `<endpoint>/statements` by POST,
 * a store that accepts them answers 200 with their ids, and every request
 * carries `X-Experience-API-Version`. A store that already holds a statement
 * with the same id "MUST NOT modify" it and answers 204 or 409. Statement ids
 * here are the same every time for the same record (`statementId`), so a
 * statement sent twice is harmless, and one the store says it already has is
 * counted as delivered rather than retried for ever.
 *
 * The key is the second credential the platform keeps for somebody else, after
 * the AI extension's tokens, and is kept the same way: sealed, shown again only
 * as a hint, and gone when the connection is removed.
 */

export const XAPI_VERSION = "1.0.3";
/** Statements per request: small enough for any store's request limit. */
const BATCH = 100;

export class RecordStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordStoreError";
  }
}

/** Https, or plain http to this machine for a store being tried out locally. */
function acceptableEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

const connectionInput = z.object({
  endpoint: z
    .string()
    .trim()
    .refine(acceptableEndpoint, "The store's address must start with https://.")
    .transform((value) => value.replace(/\/+$/, "").replace(/\/statements$/, "")),
  username: z.string().trim().min(1, "The key's name is needed.").max(500),
  /** Blank keeps the key already held. */
  secret: z.string().trim().max(2000).optional(),
  enabled: z.boolean().default(true),
});

export type RecordStoreView = {
  endpoint: string;
  username: string;
  secretHint: string;
  enabled: boolean;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  delivered: number;
};

/** The provider's connection, without its key. */
export async function recordStoreFor(session: AuthenticatedSession): Promise<RecordStoreView | null> {
  assertSessionCan(session, "records:manage");
  return withTenant(session.organisationId, async (tx) => {
    const [row] = await tx.select().from(recordStoreConnections);
    if (!row) return null;
    const delivered = await tx
      .select({ id: recordStoreDeliveries.id })
      .from(recordStoreDeliveries);
    return {
      endpoint: row.endpoint,
      username: row.username,
      secretHint: row.secretHint,
      enabled: row.enabled,
      lastAttemptAt: row.lastAttemptAt,
      lastSuccessAt: row.lastSuccessAt,
      lastError: row.lastError,
      delivered: delivered.length,
    };
  });
}

/**
 * Connects, or changes, the provider's record store.
 *
 * `activityBase` is the provider's own address, taken from the request the
 * administrator made, so statements sent later name the same activities as a
 * file downloaded from the same screen.
 */
export async function saveRecordStore(
  session: AuthenticatedSession,
  input: z.input<typeof connectionInput>,
  activityBase: string,
) {
  assertSessionCan(session, "records:manage");
  const parsed = connectionInput.parse(input);

  if (parsed.secret && !sealingAvailable()) {
    throw new RecordStoreError("This platform has no key to seal secrets with, so it cannot keep the store's key.");
  }

  return withTenant(session.organisationId, async (tx) => {
    const [existing] = await tx.select({ id: recordStoreConnections.id }).from(recordStoreConnections);
    if (!existing && !parsed.secret) {
      throw new RecordStoreError("The store's key is needed to connect.");
    }

    const secret = parsed.secret
      ? { secretSealed: seal(parsed.secret), secretHint: hintOf(parsed.secret) }
      : {};
    const values = {
      endpoint: parsed.endpoint,
      username: parsed.username,
      enabled: parsed.enabled,
      activityBase: activityBase.replace(/\/+$/, ""),
      lastError: null,
      updatedAt: new Date(),
      ...secret,
    };

    if (existing) {
      await tx.update(recordStoreConnections).set(values).where(eq(recordStoreConnections.id, existing.id));
    } else {
      await tx.insert(recordStoreConnections).values({
        organisationId: session.organisationId,
        createdById: session.userId,
        secretSealed: secret.secretSealed!,
        secretHint: secret.secretHint!,
        ...values,
      });
    }

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: existing ? "record_store.changed" : "record_store.connected",
      entityType: "organisation",
      entityId: session.organisationId,
      // Never the key; whether it changed is enough.
      after: { endpoint: parsed.endpoint, username: parsed.username, enabled: parsed.enabled, keyChanged: Boolean(parsed.secret) },
    });
  });
}

/**
 * Disconnects the store and forgets its key. What was delivered is forgotten
 * too, so connecting a store again sends everything to it.
 */
export async function removeRecordStore(session: AuthenticatedSession) {
  assertSessionCan(session, "records:manage");
  return withTenant(session.organisationId, async (tx) => {
    await tx.delete(recordStoreConnections);
    await tx.delete(recordStoreDeliveries);
    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "record_store.removed",
      entityType: "organisation",
      entityId: session.organisationId,
    });
  });
}

export type SendResult = {
  sent: number;
  alreadyHeld: number;
  /** Set when the store could not be reached or refused, and nothing more was sent. */
  error: string | null;
};

type Sender = typeof fetch;

/** Words for what a store's answer means, for the screen and the log. */
function explain(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return `The store refused the key (${status}). Check the key's name and secret on the Learning records page.`;
  }
  if (status === 404) return "The store's address was not found (404). Check it is the xAPI address, the one ending before /statements.";
  return `The store answered ${status}${body ? `: ${body.slice(0, 200)}` : ""}.`;
}

/**
 * Sends every statement the provider's store has not yet accepted.
 *
 * Stops at the first failure and records why, so a store that is down or has
 * refused the key is tried again next hour rather than hammered.
 */
export async function sendToRecordStore(
  organisationId: string,
  options: { send?: Sender; now?: Date } = {},
): Promise<SendResult | null> {
  const send = options.send ?? fetch;
  const now = options.now ?? new Date();

  const plan = await withTenant(organisationId, async (tx) => {
    const [connection] = await tx.select().from(recordStoreConnections);
    if (!connection || !connection.enabled) return null;
    const statements = await statementsIn(tx, organisationId, connection.activityBase);
    const held = new Set(
      statements.length === 0
        ? []
        : (
            await tx
              .select({ id: recordStoreDeliveries.statementId })
              .from(recordStoreDeliveries)
              .where(inArray(recordStoreDeliveries.statementId, statements.map((s) => s.id)))
          ).map((row) => row.id),
    );
    return { connection, waiting: statements.filter((s) => !held.has(s.id)) };
  });
  if (!plan) return null;

  const { connection, waiting } = plan;
  const result: SendResult = { sent: 0, alreadyHeld: 0, error: null };

  const secret = unseal(connection.secretSealed);
  if (secret === null) {
    result.error = "The store's key can no longer be opened on this platform. Enter it again on the Learning records page.";
  }

  const headers = {
    "content-type": "application/json",
    "x-experience-api-version": XAPI_VERSION,
    authorization: `Basic ${Buffer.from(`${connection.username}:${secret ?? ""}`).toString("base64")}`,
  };
  const url = `${connection.endpoint}/statements`;

  const record = (statements: Statement[], outcome: "stored" | "already held") =>
    withTenant(organisationId, (tx) =>
      tx
        .insert(recordStoreDeliveries)
        .values(statements.map((s) => ({ organisationId, statementId: s.id, outcome })))
        .onConflictDoNothing(),
    );

  for (let at = 0; !result.error && at < waiting.length; at += BATCH) {
    const batch = waiting.slice(at, at + BATCH);
    let response: Response;
    try {
      response = await send(url, { method: "POST", headers, body: JSON.stringify(batch) });
    } catch (error) {
      result.error = `The store could not be reached: ${error instanceof Error ? error.message : String(error)}.`;
      break;
    }

    if (response.ok) {
      await record(batch, "stored");
      result.sent += batch.length;
      continue;
    }

    // One of the batch is already there. Send each alone, so the rest are
    // stored and the ones it holds are counted as delivered.
    if (response.status === 409) {
      for (const statement of batch) {
        const single = await send(url, { method: "POST", headers, body: JSON.stringify([statement]) }).catch(() => null);
        if (!single) {
          result.error = "The store stopped answering part of the way through.";
          break;
        }
        if (single.ok) {
          await record([statement], "stored");
          result.sent += 1;
        } else if (single.status === 409) {
          await record([statement], "already held");
          result.alreadyHeld += 1;
        } else {
          result.error = explain(single.status, await single.text().catch(() => ""));
          break;
        }
      }
      continue;
    }

    result.error = explain(response.status, await response.text().catch(() => ""));
  }

  await withTenant(organisationId, (tx) =>
    tx
      .update(recordStoreConnections)
      .set({
        lastAttemptAt: now,
        ...(result.error ? {} : { lastSuccessAt: now }),
        lastError: result.error,
      })
      .where(eq(recordStoreConnections.id, connection.id)),
  );

  return result;
}

/** Every provider with a store connected, for the hourly job. */
export async function sendToAllRecordStores(options: { send?: Sender; now?: Date } = {}) {
  const connected = await withPlatformScope("providers with a learning record store", (tx) =>
    tx
      .select({ organisationId: recordStoreConnections.organisationId })
      .from(recordStoreConnections)
      .where(eq(recordStoreConnections.enabled, true)),
  );
  const results: { organisationId: string; result: SendResult | null }[] = [];
  for (const { organisationId } of connected) {
    results.push({ organisationId, result: await sendToRecordStore(organisationId, options) });
  }
  return results;
}
