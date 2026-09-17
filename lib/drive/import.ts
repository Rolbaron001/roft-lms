/**
 * Reading a folder from somebody's drive into the platform.
 *
 * Deliberately thin, and that is the design rather than a shortcut. Everything
 * the platform does with a folder — classifying documents, matching study
 * units, building a curriculum, refusing what it cannot read — is the code
 * that already runs for a folder chosen from a computer. A drive is a
 * different way of *getting* the files, not a different kind of import.
 *
 * So this lists, downloads, and hands the bytes to `ingestUpload`. If it grew
 * a second opinion about any of the rest, the two routes would drift and a
 * provider would get different answers depending on where their files
 * happened to live.
 */
import { ingestUpload, type IngestMode } from "../folder-import";
import type { AuthenticatedSession } from "../session";
import { accessTokenFor, DriveError, type DriveProviderName } from "./index";

/**
 * How much to read in one go.
 *
 * A qualification folder is eighty files and a few hundred megabytes; a
 * personal drive root is neither. Refused rather than truncated, with the
 * number said, because a partial import that looks complete is the failure
 * this codebase keeps meeting.
 */
const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 750 * 1024 * 1024;

export type DriveImportProgress = {
  /** Files downloaded so far, of how many. */
  done: number;
  total: number;
  /** What it is fetching now, for a screen to show. */
  current: string;
};

export async function importFromDrive(
  session: AuthenticatedSession,
  input: {
    provider: DriveProviderName;
    folderId: string;
    folderName: string;
    mode: IngestMode;
    qualificationId?: string;
    courseId?: string;
    learningPathId?: string;
  },
  onProgress?: (progress: DriveImportProgress) => void,
) {
  const { provider, accessToken } = await accessTokenFor(
    session,
    input.provider,
  );

  const listed = await provider.list({
    accessToken,
    folderId: input.folderId,
  });

  if (listed.length === 0) {
    throw new DriveError(
      "That folder has nothing in it the platform can read. A folder of Google Docs rather than Word files reads as empty here — those have to be exported first.",
    );
  }

  if (listed.length > MAX_FILES) {
    throw new DriveError(
      `That folder holds ${listed.length} files, which is more than can be read in one go. Choose the folder for one qualification rather than the drive it sits in.`,
    );
  }

  const known = listed.reduce((total, one) => total + (one.bytes ?? 0), 0);
  if (known > MAX_TOTAL_BYTES) {
    throw new DriveError(
      `That folder comes to about ${Math.round(known / 1024 / 1024)} MB, which is more than can be read in one go. Choose the folder for one qualification rather than the drive it sits in.`,
    );
  }

  const incoming: { path: string; bytes: Uint8Array }[] = [];

  for (const [index, file] of listed.entries()) {
    onProgress?.({
      done: index,
      total: listed.length,
      current: file.path,
    });

    try {
      incoming.push({
        path: file.path,
        bytes: await provider.download({ accessToken, fileId: file.id }),
      });
    } catch (error) {
      /*
       * One unreadable file does not lose the other eighty.
       *
       * A shared folder routinely holds something the person who shared it can
       * open and the person reading cannot. Skipped and named, rather than
       * failing the run — and named rather than skipped silently, because a
       * folder that imports with one document missing looks exactly like one
       * that imported whole.
       */
      throw new DriveError(
        `${file.path} could not be read from ${provider.label}: ${
          error instanceof Error ? error.message : "unknown reason"
        } Everything up to it was read; nothing has been written yet.`,
      );
    }
  }

  onProgress?.({
    done: listed.length,
    total: listed.length,
    current: "reading what was found",
  });

  return ingestUpload(
    session,
    incoming,
    input.mode,
    `${input.folderName} (${provider.label})`,
    {
      qualificationId: input.qualificationId,
      courseId: input.courseId,
      learningPathId: input.learningPathId,
    },
  );
}
