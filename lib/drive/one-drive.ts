import type {
  DriveConnectionInfo,
  DriveFile,
  DriveFolder,
  DriveProvider,
} from "./base";

/**
 * OneDrive, read-only, through Microsoft Graph.
 *
 * The same shape as the Google provider beside it. Curiosa are on Google
 * Drive, so this one is here because Roland asked for both and the next tenant
 * will not be — a platform that reads one company's file store and not the
 * other's is a platform built for one company.
 *
 * `Files.Read.All` and `offline_access`: read every file this person can
 * already see, and be able to renew. Nothing that writes.
 *
 * As with Google, the OAuth application belongs to whoever runs the
 * deployment. Without a client id and secret the option is absent rather than
 * present and failing.
 */

const AUTH = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH = "https://graph.microsoft.com/v1.0";

const SCOPE = "offline_access Files.Read.All User.Read";

function clientId(): string {
  return process.env.ONE_DRIVE_CLIENT_ID?.trim() ?? "";
}

function clientSecret(): string {
  return process.env.ONE_DRIVE_CLIENT_SECRET?.trim() ?? "";
}

function explain(status: number, body: unknown): string {
  const raw =
    typeof body === "object" && body !== null
      ? String(
          (body as { error_description?: string; error?: { message?: string } })
            .error_description ??
            (body as { error?: { message?: string } }).error?.message ??
            JSON.stringify(body).slice(0, 300),
        )
      : String(body ?? "").slice(0, 300);

  const message = clientSecret()
    ? raw.split(clientSecret()).join("[secret removed]")
    : raw;

  if (status === 401) {
    return "Microsoft no longer accepts that connection. It may have been withdrawn from your account. Connect the drive again in Settings.";
  }
  if (status === 403) {
    return `Microsoft refused that request. The account you connected may not have access to that folder. ${message}`;
  }
  if (status === 404) {
    return "That folder is not there, or the account you connected cannot see it.";
  }
  return message || `Microsoft returned ${status}.`;
}

async function call(url: string, accessToken: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(explain(response.status, body));
  }

  return response;
}

export const oneDriveProvider: DriveProvider = {
  name: "one_drive",
  label: "OneDrive",
  description:
    "Read a folder straight from your OneDrive. Read-only: the platform can list and download, and cannot create, change or delete anything. You can withdraw it here or from your Microsoft account at any time.",

  configured(): boolean {
    return Boolean(clientId() && clientSecret());
  },

  consentUrl({ state, redirectUri }): string {
    const query = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPE,
      response_mode: "query",
      state,
    });

    return `${AUTH}?${query.toString()}`;
  },

  async exchange({ code, redirectUri }): Promise<DriveConnectionInfo> {
    const response = await fetch(TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId(),
        client_secret: clientSecret(),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: SCOPE,
      }),
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(explain(response.status, body));

    const tokens = body as {
      refresh_token?: string;
      access_token?: string;
      expires_in?: number;
    };

    if (!tokens.refresh_token) {
      throw new Error(
        "Microsoft did not return a way to renew the connection. The application may not be asking for offline access.",
      );
    }

    let accountLabel: string | null = null;
    if (tokens.access_token) {
      try {
        const me = await call(`${GRAPH}/me`, tokens.access_token);
        const who = (await me.json()) as {
          userPrincipalName?: string;
          mail?: string;
        };
        accountLabel = who.mail ?? who.userPrincipalName ?? null;
      } catch {
        // A label is a nicety. Not being able to read it is not a reason to
        // refuse a connection that otherwise works.
      }
    }

    return {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token ?? "",
      expiresIn: tokens.expires_in ?? 3600,
      accountLabel,
    };
  },

  async refresh(refreshToken) {
    const response = await fetch(TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId(),
        client_secret: clientSecret(),
        grant_type: "refresh_token",
        scope: SCOPE,
      }),
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(explain(response.status, body));

    const tokens = body as { access_token?: string; expires_in?: number };
    if (!tokens.access_token) {
      throw new Error("Microsoft did not return an access token.");
    }

    return {
      accessToken: tokens.access_token,
      expiresIn: tokens.expires_in ?? 3600,
    };
  },

  async folders({ accessToken, parentId }): Promise<DriveFolder[]> {
    const url = parentId
      ? `${GRAPH}/me/drive/items/${encodeURIComponent(parentId)}/children`
      : `${GRAPH}/me/drive/root/children`;

    const response = await call(url, accessToken);
    const body = (await response.json()) as {
      value?: { id: string; name: string; folder?: unknown }[];
    };

    return (body.value ?? [])
      .filter((one) => one.folder)
      .map((one) => ({ id: one.id, name: one.name }));
  },

  async list({ accessToken, folderId }): Promise<DriveFile[]> {
    // Walked the same way as Drive's, and for the same reason: the path is
    // what the importer files documents by.
    const found: DriveFile[] = [];
    const queue: { id: string; prefix: string }[] = [{ id: folderId, prefix: "" }];
    const seen = new Set<string>();

    while (queue.length > 0) {
      const here = queue.shift()!;
      if (seen.has(here.id)) continue;
      seen.add(here.id);

      let next: string | null =
        `${GRAPH}/me/drive/items/${encodeURIComponent(here.id)}/children?$top=200`;

      while (next) {
        const response = await call(next, accessToken);
        const body = (await response.json()) as {
          value?: {
            id: string;
            name: string;
            size?: number;
            folder?: unknown;
            file?: { mimeType?: string };
          }[];
          "@odata.nextLink"?: string;
        };

        for (const entry of body.value ?? []) {
          const path = here.prefix ? `${here.prefix}/${entry.name}` : entry.name;

          if (entry.folder) {
            queue.push({ id: entry.id, prefix: path });
            continue;
          }

          found.push({
            id: entry.id,
            path,
            name: entry.name,
            bytes: entry.size ?? null,
            mimeType: entry.file?.mimeType ?? null,
          });
        }

        next = body["@odata.nextLink"] ?? null;
      }
    }

    return found;
  },

  async download({ accessToken, fileId }): Promise<Uint8Array> {
    const response = await call(
      `${GRAPH}/me/drive/items/${encodeURIComponent(fileId)}/content`,
      accessToken,
    );
    return new Uint8Array(await response.arrayBuffer());
  },
};
