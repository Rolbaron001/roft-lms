/**
 * Drive connections: who has one, and getting a usable token out of it.
 *
 * The registry and the store. Everything that touches a credential is here,
 * so there is one place to read when somebody asks what the platform holds.
 *
 * Three rules hold throughout, and each was a decision rather than a default:
 *
 * A connection is a person's, never a tenant's. It reads their own drive, and
 * a shared one would let a colleague reach files they were never given.
 *
 * A refresh token is sealed and never leaves this module. What goes to a
 * screen is the account label and when it was connected; what goes to a log is
 * neither.
 *
 * Read-only scope, asked for at consent and enforced by the provider. Nothing
 * here can create, change or delete anything in anybody's drive.
 */
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { driveConnections } from "@/db/schema";
import { recordAudit } from "../audit";
import { seal, sealingAvailable, unseal } from "../secret-box";
import { assertSessionCan, type AuthenticatedSession } from "../session";
import { googleDriveProvider } from "./google-drive";
import { oneDriveProvider } from "./one-drive";
import {
  DRIVE_PROVIDER_NAMES,
  type DriveProvider,
  type DriveProviderName,
} from "./base";

export * from "./base";

const PROVIDERS: Record<DriveProviderName, DriveProvider> = {
  google_drive: googleDriveProvider,
  one_drive: oneDriveProvider,
};

export class DriveError extends Error {}

/** Those this deployment is set up to offer. */
export function availableDriveProviders(): DriveProvider[] {
  return DRIVE_PROVIDER_NAMES.map((name) => PROVIDERS[name]).filter((one) =>
    one.configured(),
  );
}

export function driveProviderByName(name: string): DriveProvider | null {
  return (PROVIDERS as Record<string, DriveProvider>)[name] ?? null;
}

export type DriveConnectionView = {
  provider: DriveProviderName;
  label: string;
  accountLabel: string | null;
  connectedAt: Date;
  lastUsedAt: Date | null;
};

/** What this person has connected, for a screen. No tokens. */
export async function connectionsFor(
  session: AuthenticatedSession,
): Promise<DriveConnectionView[]> {
  const rows = await withTenant(session.organisationId, (tx) =>
    tx
      .select({
        provider: driveConnections.provider,
        accountLabel: driveConnections.accountLabel,
        connectedAt: driveConnections.connectedAt,
        lastUsedAt: driveConnections.lastUsedAt,
      })
      .from(driveConnections)
      .where(eq(driveConnections.userId, session.userId)),
  );

  return rows
    .map((row) => {
      const provider = driveProviderByName(row.provider);
      return provider
        ? {
            provider: row.provider as DriveProviderName,
            label: provider.label,
            accountLabel: row.accountLabel,
            connectedAt: row.connectedAt,
            lastUsedAt: row.lastUsedAt,
          }
        : null;
    })
    .filter((one): one is DriveConnectionView => one !== null);
}

/**
 * Records a consent that has just come back.
 *
 * Replaces any existing connection for this person and provider, which is what
 * somebody reconnecting a different account expects: one connection each, not
 * a pile of them with no way to tell which is in use.
 */
export async function recordConnection(
  session: AuthenticatedSession,
  provider: DriveProviderName,
  info: {
    refreshToken: string;
    accessToken: string;
    expiresIn: number;
    accountLabel: string | null;
  },
): Promise<void> {
  assertSessionCan(session, "qualification:manage");

  if (!sealingAvailable()) {
    throw new DriveError(
      "This deployment cannot store a credential safely, so a drive cannot be connected. Whoever maintains it needs to set the sealing key.",
    );
  }

  await withTenant(session.organisationId, async (tx) => {
    await tx
      .delete(driveConnections)
      .where(
        and(
          eq(driveConnections.userId, session.userId),
          eq(driveConnections.provider, provider),
        ),
      );

    await tx.insert(driveConnections).values({
      organisationId: session.organisationId,
      userId: session.userId,
      provider,
      accountLabel: info.accountLabel,
      refreshTokenSealed: seal(info.refreshToken),
      accessTokenSealed: info.accessToken ? seal(info.accessToken) : null,
      accessTokenExpiresAt: new Date(Date.now() + info.expiresIn * 1000),
    });

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "drive.connected",
      entityType: "user",
      entityId: session.userId,
      // The account, never the token.
      after: { provider, account: info.accountLabel },
    });
  });
}

/** Forgets a connection. The provider's own account page is the other half. */
export async function disconnect(
  session: AuthenticatedSession,
  provider: DriveProviderName,
): Promise<void> {
  await withTenant(session.organisationId, async (tx) => {
    await tx
      .delete(driveConnections)
      .where(
        and(
          eq(driveConnections.userId, session.userId),
          eq(driveConnections.provider, provider),
        ),
      );

    await recordAudit(tx, {
      organisationId: session.organisationId,
      actorId: session.userId,
      action: "drive.disconnected",
      entityType: "user",
      entityId: session.userId,
      after: { provider },
    });
  });
}

/**
 * A usable access token, renewed if the stored one has expired.
 *
 * Renewed a minute early rather than on the stroke: a folder of eighty files
 * takes minutes, and a token that dies in the middle of it fails the run
 * rather than the request.
 *
 * Never returned to anything outside this module's callers, and never logged.
 */
export async function accessTokenFor(
  session: AuthenticatedSession,
  providerName: DriveProviderName,
): Promise<{ provider: DriveProvider; accessToken: string }> {
  assertSessionCan(session, "qualification:manage");

  const provider = driveProviderByName(providerName);
  if (!provider) throw new DriveError("That drive is not one the platform knows.");

  const [row] = await withTenant(session.organisationId, (tx) =>
    tx
      .select({
        id: driveConnections.id,
        refreshTokenSealed: driveConnections.refreshTokenSealed,
        accessTokenSealed: driveConnections.accessTokenSealed,
        accessTokenExpiresAt: driveConnections.accessTokenExpiresAt,
      })
      .from(driveConnections)
      .where(
        and(
          eq(driveConnections.userId, session.userId),
          eq(driveConnections.provider, providerName),
        ),
      ),
  );

  if (!row) {
    throw new DriveError(
      `You have not connected ${provider.label}. Connect it in Settings, and the folder can be read from there.`,
    );
  }

  const stillGood =
    row.accessTokenSealed &&
    row.accessTokenExpiresAt &&
    row.accessTokenExpiresAt.getTime() - 60_000 > Date.now();

  if (stillGood) {
    const token = unseal(row.accessTokenSealed);
    if (token) {
      await touch(session, row.id);
      return { provider, accessToken: token };
    }
  }

  const refreshToken = unseal(row.refreshTokenSealed);
  if (!refreshToken) {
    throw new DriveError(
      `The stored ${provider.label} connection cannot be read. Connect it again in Settings.`,
    );
  }

  const renewed = await provider.refresh(refreshToken);

  await withTenant(session.organisationId, (tx) =>
    tx
      .update(driveConnections)
      .set({
        accessTokenSealed: seal(renewed.accessToken),
        accessTokenExpiresAt: new Date(Date.now() + renewed.expiresIn * 1000),
        lastUsedAt: new Date(),
      })
      .where(eq(driveConnections.id, row.id)),
  );

  return { provider, accessToken: renewed.accessToken };
}

async function touch(
  session: AuthenticatedSession,
  id: string,
): Promise<void> {
  await withTenant(session.organisationId, (tx) =>
    tx
      .update(driveConnections)
      .set({ lastUsedAt: new Date() })
      .where(eq(driveConnections.id, id)),
  );
}
