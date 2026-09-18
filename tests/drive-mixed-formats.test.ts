/**
 * A folder holding both native Google documents and uploaded Office files.
 *
 * Roland, 18 September: "Whether Curiosa's material is native Google Docs or
 * uploaded Word files is immaterial, the functionality still needs to be there
 * so that it is available to Tenants."
 *
 * He is right, and the question I asked was the wrong one. What one tenant
 * happens to use cannot decide what the platform supports, because the next
 * tenant will do it the other way — and a real folder is usually both at once:
 * a theory guide written in Docs, a workbook somebody uploaded from Word, a
 * published curriculum as a PDF, an alignment matrix somebody keeps in Sheets.
 *
 * The two routes are tested separately elsewhere. What is tested here is that
 * they meet: that a folder of both comes back whole, and that a workbook is a
 * workbook either way.
 *
 * That last part is the actual promise. If a Doc arrived without the extension
 * its export gave it, the classifier would see "CA 121151 SU1 WB1 AG" with
 * nothing after it and file an answer guide as "other" — which is unrestricted,
 * and would publish it to the learners it is the answer key for. The formats
 * meeting correctly is what keeps that from depending on which word processor
 * a provider prefers.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { googleDriveProvider } from "@/lib/drive/google-drive";
import { classifyDocument } from "@/lib/folder-plan";

const TOKEN = "ya29-not-a-real-access-token";

let calls: string[] = [];
const realFetch = globalThis.fetch;

function listing(files: unknown[]) {
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url.toString());

    if (url.pathname.includes("/export") || url.searchParams.has("alt")) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(8),
      } as unknown as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        files: /'root' in parents/.test(url.searchParams.get("q") ?? "")
          ? files
          : [],
      }),
    } as unknown as Response;
  }) as typeof fetch;
}

/** The mixture a provider's folder actually holds. */
const MIXED = [
  {
    id: "guide",
    name: "CA 121151 SU1 Theory Guide",
    mimeType: "application/vnd.google-apps.document",
  },
  {
    id: "wb",
    name: "CA 121151 SU1 WB1.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: "2048",
  },
  {
    id: "ag",
    name: "CA 121151 SU1 WB1 AG",
    mimeType: "application/vnd.google-apps.document",
  },
  {
    id: "matrix",
    name: "CA 121151 Alignment",
    mimeType: "application/vnd.google-apps.spreadsheet",
  },
  {
    id: "curriculum",
    name: "121151 Curriculum Document.pdf",
    mimeType: "application/pdf",
    size: "500000",
  },
];

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function kindOf(path: string): string | null {
  const filename = path.split("/").pop()!;
  return classifyDocument(path, filename, 1024).kind;
}

describe("a folder of both kinds", () => {
  it("comes back whole, with nothing dropped for being native", async () => {
    listing(MIXED);

    const found = await googleDriveProvider.list({
      accessToken: TOKEN,
      folderId: "root",
    });

    expect(found.map((one) => one.path).sort()).toEqual([
      "121151 Curriculum Document.pdf",
      "CA 121151 Alignment.xlsx",
      "CA 121151 SU1 Theory Guide.docx",
      "CA 121151 SU1 WB1 AG.docx",
      "CA 121151 SU1 WB1.docx",
    ]);
  });

  /**
   * The promise this all rests on. A provider who writes in Google and one who
   * writes in Word get the same qualification out the other end.
   */
  it("classifies a document the same whichever it came from", async () => {
    listing(MIXED);

    const found = await googleDriveProvider.list({
      accessToken: TOKEN,
      folderId: "root",
    });

    const kinds = Object.fromEntries(
      found.map((one) => [one.id, kindOf(one.path)]),
    );

    // Uploaded from Word.
    expect(kinds.wb).toBe("workbook");
    // Written in Docs. Same kind, because the export gave it the extension.
    expect(kinds.guide).toBe("theory_guide");
    // And the one that matters most: an answer guide is restricted either way.
    expect(kinds.ag).toBe("workbook_memorandum");
    // A matrix kept in Sheets is still the matrix.
    expect(kinds.matrix).toBe("alignment_matrix");
    expect(kinds.curriculum).toBe("curriculum_document");
  });

  it("fetches each one the way that file needs fetching", async () => {
    listing(MIXED);

    const found = await googleDriveProvider.list({
      accessToken: TOKEN,
      folderId: "root",
    });

    calls = [];

    for (const file of found) {
      await googleDriveProvider.download({ accessToken: TOKEN, file });
    }

    const exported = calls.filter((one) => one.includes("/export"));
    const downloaded = calls.filter((one) => one.includes("alt=media"));

    // Three native documents exported, two real files downloaded.
    expect(exported).toHaveLength(3);
    expect(downloaded).toHaveLength(2);
  });
});
