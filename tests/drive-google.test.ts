/**
 * Reading a folder out of Google Drive.
 *
 * Roland, 17 September: "In Curiosa's case, all the learning material is
 * stored on Google Drive." Asking somebody to download eighty files and upload
 * them again is a step that exists only because the platform could not read
 * where the files already live.
 *
 * Nothing here calls Google. `fetch` is replaced, so what is tested is what
 * the platform does with an answer, a refusal, and — most of all — with the
 * credential.
 *
 * The walk is the part worth testing hardest. Drive has no "everything under
 * here" query: a file knows its parent and nothing else, so the folders are
 * walked and the path built on the way down. That path is what the importer
 * files documents by — it is how "Study Unit 1/CA 121151 SU1 WB1.docx" becomes
 * a workbook under SU1 — so getting it wrong loses the study unit structure
 * without losing any files, which is the kind of failure that looks like
 * success.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { googleDriveProvider } from "@/lib/drive/google-drive";
import { worthDownloading } from "@/lib/drive/base";

const TOKEN = "ya29-not-a-real-access-token";

let calls: string[] = [];
const realFetch = globalThis.fetch;

/** Answers a Drive listing for whichever parent was asked about. */
function drive(tree: Record<string, unknown[]>) {
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url.toString());

    const q = url.searchParams.get("q") ?? "";
    const parent = /'([^']+)' in parents/.exec(q)?.[1] ?? "";

    return {
      ok: true,
      status: 200,
      json: async () => ({ files: tree[parent] ?? [] }),
    } as unknown as Response;
  }) as typeof fetch;
}

function refusing(status: number, body: unknown) {
  globalThis.fetch = (async (input: string | URL) => {
    calls.push(String(input));
    return {
      ok: false,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as typeof fetch;
}

const folder = (id: string, name: string) => ({
  id,
  name,
  mimeType: "application/vnd.google-apps.folder",
});

const file = (id: string, name: string, size = "1024") => ({
  id,
  name,
  mimeType:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size,
});

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("walking a folder", () => {
  it("builds the path the importer files documents by", async () => {
    drive({
      root: [folder("su1", "Study Unit 1"), file("base", "121151 Curriculum Document.pdf")],
      su1: [file("wb", "CA 121151 SU1 WB1.docx")],
    });

    const found = await googleDriveProvider.list({
      accessToken: TOKEN,
      folderId: "root",
    });

    expect(found.map((one) => one.path).sort()).toEqual([
      "121151 Curriculum Document.pdf",
      "Study Unit 1/CA 121151 SU1 WB1.docx",
    ]);
  });

  it("goes all the way down, not one level", async () => {
    drive({
      root: [folder("a", "A")],
      a: [folder("b", "B")],
      b: [file("deep", "buried.docx")],
    });

    const found = await googleDriveProvider.list({
      accessToken: TOKEN,
      folderId: "root",
    });

    expect(found.map((one) => one.path)).toEqual(["A/B/buried.docx"]);
  });

  /**
   * A folder can contain a shortcut back to one of its ancestors. Without a
   * guard the walk never finishes, and what the person sees is a page that
   * never loads.
   */
  it("does not loop when a folder contains itself", async () => {
    drive({
      root: [folder("a", "A")],
      a: [folder("root", "Back to the top"), file("one", "one.docx")],
    });

    const found = await googleDriveProvider.list({
      accessToken: TOKEN,
      folderId: "root",
    });

    expect(found.map((one) => one.path)).toEqual(["A/one.docx"]);
  });

  it("asks for shared drives as well as the person's own", async () => {
    drive({ root: [] });

    await googleDriveProvider.list({ accessToken: TOKEN, folderId: "root" });

    // A folder somebody shared is the ordinary case for a provider's material.
    expect(calls[0]).toContain("includeItemsFromAllDrives=true");
    expect(calls[0]).toContain("supportsAllDrives=true");
  });
});

describe("what is not worth downloading", () => {
  /**
   * A Google Doc has no bytes to download — it would have to be exported, and
   * which format is a decision nobody has made. Fetching it would return an
   * error per file in a folder full of them.
   */
  it("skips Google's own document formats", () => {
    expect(
      worthDownloading({
        id: "1",
        path: "notes",
        name: "notes",
        bytes: null,
        mimeType: "application/vnd.google-apps.document",
      }),
    ).toBe(false);
  });

  it("keeps an ordinary Word or PDF file", () => {
    expect(
      worthDownloading({
        id: "2",
        path: "a.docx",
        name: "a.docx",
        bytes: 10,
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe(true);
  });
});

describe("what it says when Google says no", () => {
  it("explains a withdrawn connection as something to reconnect", async () => {
    refusing(401, { error: { message: "Invalid Credentials" } });

    await expect(
      googleDriveProvider.list({ accessToken: TOKEN, folderId: "root" }),
    ).rejects.toThrow(/connect the drive again/i);
  });

  /**
   * The most likely real failure, and the least obvious: a folder shared with
   * somebody is not visible to the API until they have opened it once.
   */
  it("explains a folder it cannot see", async () => {
    refusing(404, { error: { message: "File not found" } });

    await expect(
      googleDriveProvider.list({ accessToken: TOKEN, folderId: "missing" }),
    ).rejects.toThrow(/shared with you has to be opened/i);
  });
});

describe("the consent it asks for", () => {
  it("asks to read, and for nothing else", () => {
    process.env.GOOGLE_DRIVE_CLIENT_ID = "test-client";
    process.env.GOOGLE_DRIVE_CLIENT_SECRET = "test-secret";

    const url = googleDriveProvider.consentUrl({
      state: "abc.def",
      redirectUri: "https://lms.example/api/drive/google_drive/callback",
    });

    expect(url).toContain("drive.readonly");
    // Nothing that writes, anywhere in the request.
    expect(url).not.toContain("drive.file");
    expect(url).not.toMatch(/scope=[^&]*drive(?!\.readonly)/);
  });

  /**
   * Without `access_type=offline` Google returns an access token and no way to
   * renew it, so the connection works for an hour and then stops with nothing
   * to explain it.
   */
  it("asks for a connection that can be renewed", () => {
    const url = googleDriveProvider.consentUrl({
      state: "abc.def",
      redirectUri: "https://lms.example/api/drive/google_drive/callback",
    });

    expect(url).toContain("access_type=offline");
    expect(url).toContain("prompt=consent");
  });

  it("is absent where the deployment has not registered an application", () => {
    const id = process.env.GOOGLE_DRIVE_CLIENT_ID;
    delete process.env.GOOGLE_DRIVE_CLIENT_ID;

    expect(googleDriveProvider.configured()).toBe(false);

    process.env.GOOGLE_DRIVE_CLIENT_ID = id;
  });
});
