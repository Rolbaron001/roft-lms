import type {
  DriveConnectionInfo,
  DriveFile,
  DriveFolder,
  DriveProvider,
} from "./base";
import { exportFormatFor, worthDownloading } from "./base";

/**
 * Google Drive, read-only.
 *
 * Curiosa keep all their learning material there, so this is the one that
 * matters first.
 *
 * The scope asked for is `drive.readonly` and nothing else. It cannot create,
 * change or delete anything, and that is not a matter of this code being
 * careful — Google will refuse the calls. Worth saying because "connect your
 * Google Drive" sounds like handing over the keys, and what is actually being
 * agreed to is narrower than that.
 *
 * The OAuth application belongs to whoever runs the deployment rather than to
 * the platform: it is their name on the consent screen. So the client id and
 * secret are configuration, and without them the option is absent rather than
 * present and failing.
 */

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const FILES = "https://www.googleapis.com/drive/v3/files";

/** Read, and nothing else. */
const SCOPE = "https://www.googleapis.com/auth/drive.readonly";

function clientId(): string {
  return process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() ?? "";
}

function clientSecret(): string {
  return process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() ?? "";
}

/** Google's error text, with the secret removed before anything reads it. */
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
    return "Google no longer accepts that connection. It may have been withdrawn from your Google account. Connect the drive again in Settings.";
  }
  if (status === 403) {
    return `Google refused that request. If it mentions a quota, the deployment's Drive API limit has been reached for now. ${message}`;
  }
  if (status === 404) {
    return "That folder is not there, or the account you connected cannot see it. A folder shared with you has to be opened in Drive at least once before it can be read.";
  }
  return message || `Google returned ${status}.`;
}

async function call(
  url: string,
  accessToken: string,
  init?: RequestInit,
  say?: { exportTooLarge?: string },
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = explain(response.status, body);

    if (say?.exportTooLarge && /export size|too large/i.test(message)) {
      throw new Error(say.exportTooLarge);
    }

    throw new Error(message);
  }

  return response;
}

export const googleDriveProvider: DriveProvider = {
  name: "google_drive",
  label: "Google Drive",
  description:
    "Read a folder straight from your Google Drive. Read-only: the platform can list and download, and cannot create, change or delete anything. You can withdraw it here or from your Google account at any time.",

  configured(): boolean {
    return Boolean(clientId() && clientSecret());
  },

  consentUrl({ state, redirectUri }): string {
    const query = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPE,
      // Needed for a refresh token at all, and to get one every time rather
      // than only on the first consent - a person who reconnects after
      // withdrawing would otherwise get an access token and no way to renew it.
      access_type: "offline",
      prompt: "consent",
      state,
      include_granted_scopes: "true",
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
      }),
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(explain(response.status, body));

    const tokens = body as {
      refresh_token?: string;
      access_token?: string;
      expires_in?: number;
      id_token?: string;
    };

    if (!tokens.refresh_token) {
      throw new Error(
        "Google did not return a way to renew the connection, which usually means this account had already granted it. Remove the platform's access in your Google account under Third-party apps, then connect again.",
      );
    }

    return {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token ?? "",
      expiresIn: tokens.expires_in ?? 3600,
      accountLabel: emailFromIdToken(tokens.id_token),
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
      }),
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(explain(response.status, body));

    const tokens = body as { access_token?: string; expires_in?: number };
    if (!tokens.access_token) {
      throw new Error("Google did not return an access token.");
    }

    return {
      accessToken: tokens.access_token,
      expiresIn: tokens.expires_in ?? 3600,
    };
  },

  async folders({ accessToken, parentId }): Promise<DriveFolder[]> {
    const query = [
      "mimeType = 'application/vnd.google-apps.folder'",
      "trashed = false",
      `'${(parentId ?? "root").replace(/'/g, "\\'")}' in parents`,
    ].join(" and ");

    const url = new URL(FILES);
    url.searchParams.set("q", query);
    url.searchParams.set("fields", "files(id,name)");
    url.searchParams.set("pageSize", "200");
    url.searchParams.set("orderBy", "name");
    // A folder somebody shared, as well as one they own.
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");

    const response = await call(url.toString(), accessToken);
    const body = (await response.json()) as {
      files?: { id: string; name: string }[];
    };

    return (body.files ?? []).map((one) => ({ id: one.id, name: one.name }));
  },

  async list({ accessToken, folderId }): Promise<DriveFile[]> {
    /*
     * Walked rather than queried in one go. Drive has no "everything under
     * here" query - a file knows its parent and nothing else - so the folders
     * are walked and the path is built on the way down, which is what the
     * importer files documents by.
     */
    const found: DriveFile[] = [];
    const queue: { id: string; prefix: string }[] = [{ id: folderId, prefix: "" }];
    const seen = new Set<string>();

    while (queue.length > 0) {
      const here = queue.shift()!;
      if (seen.has(here.id)) continue;
      seen.add(here.id);

      let pageToken: string | undefined;

      do {
        const url = new URL(FILES);
        url.searchParams.set(
          "q",
          `'${here.id.replace(/'/g, "\\'")}' in parents and trashed = false`,
        );
        url.searchParams.set(
          "fields",
          "nextPageToken, files(id,name,mimeType,size)",
        );
        url.searchParams.set("pageSize", "200");
        url.searchParams.set("supportsAllDrives", "true");
        url.searchParams.set("includeItemsFromAllDrives", "true");
        if (pageToken) url.searchParams.set("pageToken", pageToken);

        const response = await call(url.toString(), accessToken);
        const body = (await response.json()) as {
          nextPageToken?: string;
          files?: {
            id: string;
            name: string;
            mimeType?: string;
            size?: string;
          }[];
        };

        for (const entry of body.files ?? []) {
          const path = here.prefix ? `${here.prefix}/${entry.name}` : entry.name;

          if (entry.mimeType === "application/vnd.google-apps.folder") {
            queue.push({ id: entry.id, prefix: path });
            continue;
          }

          /*
           * A Google Doc is not a file and has no name ending in anything.
           *
           * The extension is added because everything downstream reads it: the
           * media check decides what a document is by its bytes and its name,
           * and the classifier matches "WB1 AG" in a filename. A theory guide
           * called "CA 121151 SU1 Theory Guide" with nothing after it would
           * arrive as an unknown kind of file with no format.
           *
           * This is what Google's own folder download does, and it is why
           * downloading a folder as a zip produces something the platform can
           * already read.
           */
          const exportAs = exportFormatFor(entry.mimeType ?? null);

          const file: DriveFile = {
            id: entry.id,
            path: exportAs ? `${path}${exportAs.extension}` : path,
            name: exportAs ? `${entry.name}${exportAs.extension}` : entry.name,
            // A native document has no size until it is exported.
            bytes: entry.size ? Number(entry.size) : null,
            mimeType: entry.mimeType ?? null,
            exportAs,
          };

          if (worthDownloading(file)) found.push(file);
        }

        pageToken = body.nextPageToken;
      } while (pageToken);
    }

    return found;
  },

  async download({ accessToken, file }): Promise<Uint8Array> {
    /*
     * A native document is exported; an uploaded one is downloaded.
     *
     * Two different endpoints, and the difference is not a detail: asking for
     * the bytes of a Google Doc returns an error saying it cannot be
     * downloaded, which is what made a folder of Docs look unreadable.
     */
    if (file.exportAs) {
      const url = new URL(`${FILES}/${encodeURIComponent(file.id)}/export`);
      url.searchParams.set("mimeType", file.exportAs.mimeType);

      const response = await call(url.toString(), accessToken, undefined, {
        // Google refuses to export a very large document - the documented
        // limit is about 10 MB of exported content - and the error it returns
        // says only "export size limit exceeded", which is true and gives
        // nobody anything to do.
        exportTooLarge: `"${file.name}" is too large for Google to export in one piece. Download that one document from Drive as ${file.exportAs.extension} and add it on its own afterwards; everything else in the folder reads normally.`,
      });

      return new Uint8Array(await response.arrayBuffer());
    }

    const url = new URL(`${FILES}/${encodeURIComponent(file.id)}`);
    url.searchParams.set("alt", "media");
    url.searchParams.set("supportsAllDrives", "true");

    const response = await call(url.toString(), accessToken);
    return new Uint8Array(await response.arrayBuffer());
  },
};

/**
 * The email Google put in the identity token, for labelling the connection.
 *
 * Read without verifying the signature, deliberately: it came straight from
 * Google's token endpoint over TLS in response to our own request, and it is
 * used as a label on a screen rather than to decide anything. Nothing is
 * authorised on the strength of it.
 */
function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;

  const [, payload] = idToken.split(".");
  if (!payload) return null;

  try {
    const json = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64")
        .toString("utf8"),
    ) as { email?: string };
    return json.email ?? null;
  } catch {
    return null;
  }
}
