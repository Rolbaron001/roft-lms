/**
 * Reading a folder out of somebody's own file store.
 *
 * Roland, 17 September: "In Curiosa's case, all the learning material is
 * stored on Google Drive." Asking somebody to download eighty files and upload
 * them again is a step that exists only because the platform could not read
 * where the files already live.
 *
 * The contract is deliberately small, and smaller than it looks like it should
 * be. A drive provider does three things: say where to send somebody to
 * consent, turn what comes back into a token, and hand over a folder as files.
 * Everything the platform then does with those files — classifying them,
 * matching study units, filing them — is the code that already exists for a
 * folder chosen from a computer. A drive is a different way of *getting* the
 * files, not a different kind of import.
 *
 * Read-only throughout. Each provider asks for the narrowest scope that lets
 * it list and download, and nothing here can create, change or delete anything
 * in anybody's drive.
 *
 * This module imports nothing, so the shapes can be used from a form.
 */

export type DriveFile = {
  /** The provider's own id, for fetching the bytes. */
  id: string;
  /** The path within the chosen folder, as the importer expects it. */
  path: string;
  name: string;
  /** Null where the provider does not say. */
  bytes: number | null;
  mimeType: string | null;
};

export type DriveFolder = {
  id: string;
  name: string;
  /** For showing where a folder sits, where the provider says. */
  path?: string;
};

export type DriveConnectionInfo = {
  refreshToken: string;
  accessToken: string;
  /** Seconds from now. */
  expiresIn: number;
  /** The account that consented, for telling two connections apart. */
  accountLabel: string | null;
};

export type DriveProvider = {
  /** Stable identifier, stored against the person. Never change one. */
  name: string;
  label: string;
  /** What a person is agreeing to, in their words rather than the API's. */
  description: string;

  /**
   * Whether this deployment is set up to offer it at all.
   *
   * An OAuth application has to be registered with the provider by whoever
   * runs the deployment — it is their application asking for consent, not the
   * platform's — so the client id and secret are configuration. Without them
   * the option is absent rather than present and failing.
   */
  configured(): boolean;

  /** Where to send somebody to consent. `state` comes back untouched. */
  consentUrl(input: { state: string; redirectUri: string }): string;

  /** The code from the callback, exchanged for tokens. */
  exchange(input: {
    code: string;
    redirectUri: string;
  }): Promise<DriveConnectionInfo>;

  /** A fresh access token from a stored refresh token. */
  refresh(refreshToken: string): Promise<{
    accessToken: string;
    expiresIn: number;
  }>;

  /** The folders a person can choose from, under `parentId` or at the root. */
  folders(input: {
    accessToken: string;
    parentId?: string;
  }): Promise<DriveFolder[]>;

  /**
   * Every file in a folder and its subfolders.
   *
   * Recursive, because a qualification folder has study units inside it and
   * the paths are what the importer files documents by.
   */
  list(input: { accessToken: string; folderId: string }): Promise<DriveFile[]>;

  /** The bytes of one file. */
  download(input: { accessToken: string; fileId: string }): Promise<Uint8Array>;
};

/** Every drive provider the platform knows. Used to validate a stored value. */
export const DRIVE_PROVIDER_NAMES = ["google_drive", "one_drive"] as const;
export type DriveProviderName = (typeof DRIVE_PROVIDER_NAMES)[number];

/**
 * Files a drive holds that the platform has no use for.
 *
 * Skipped at the point of listing rather than downloaded and then ignored,
 * because a shared drive folder routinely holds shortcuts, native documents
 * and things somebody left there, and downloading eighty megabytes to discard
 * it is a cost the person waiting can feel.
 */
export function worthDownloading(file: DriveFile): boolean {
  // A Google-native document has no bytes to download; it would have to be
  // exported, which is a different call and a decision about which format.
  if (file.mimeType?.startsWith("application/vnd.google-apps")) return false;

  // Shortcuts point at a file rather than being one.
  if (file.mimeType === "application/vnd.google-apps.shortcut") return false;

  return true;
}
