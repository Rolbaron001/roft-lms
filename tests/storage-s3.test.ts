/**
 * S3-compatible object storage.
 *
 * Two kinds of test here, because there are two kinds of mistake.
 *
 * The signing tests pin the exact bytes that go into the signature. A
 * canonical request with headers in the wrong order, or a missing newline,
 * produces a request that looks perfectly ordinary and is refused — and since
 * the signature is opaque, the only way to find the fault is to have written
 * down what the input should be.
 *
 * The round-trip tests run against a real HTTP server standing in for the
 * bucket. What they prove is that a file goes out and comes back byte for
 * byte, that the hash recorded against a submission is the hash that was
 * actually sent, and that a refusal is reported as a failure rather than
 * swallowed. What they cannot prove is that a real provider accepts the
 * signature; only a real bucket can show that, and that is a configuration
 * step rather than a code one.
 */
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getObjectS3,
  objectExistsS3,
  putObjectS3,
  s3ConfigFromEnv,
  signRequest,
  StorageError,
  type S3Config,
} from "@/lib/storage-s3";

const CONFIG: S3Config = {
  endpoint: "https://objectstorage.example.test",
  region: "af-johannesburg-1",
  bucket: "roft-evidence",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMIexampleKEY",
  forcePathStyle: true,
};

const AT = new Date("2026-08-26T09:15:00.000Z");

describe("signing", () => {
  const signed = signRequest(CONFIG, {
    method: "PUT",
    key: "org-1/evidence/sub-2/file.pdf",
    payloadSha256: "a".repeat(64),
    contentType: "application/pdf",
    now: AT,
  });

  it("puts the bucket in the path by default", () => {
    expect(signed.url).toBe(
      "https://objectstorage.example.test/roft-evidence/org-1/evidence/sub-2/file.pdf",
    );
  });

  it("puts the bucket in the host when asked to", () => {
    const virtual = signRequest(
      { ...CONFIG, forcePathStyle: false },
      {
        method: "GET",
        key: "org-1/evidence/sub-2/file.pdf",
        payloadSha256: "b".repeat(64),
        now: AT,
      },
    );

    expect(virtual.url).toBe(
      "https://roft-evidence.objectstorage.example.test/org-1/evidence/sub-2/file.pdf",
    );
  });

  /**
   * The four things a provider checks before it will look at the signature.
   * A missing x-amz-content-sha256 is refused outright rather than ignored.
   */
  it("sends the headers the protocol requires", () => {
    expect(signed.headers["x-amz-date"]).toBe("20260826T091500Z");
    expect(signed.headers["x-amz-content-sha256"]).toBe("a".repeat(64));
    expect(signed.headers.host).toBe("objectstorage.example.test");
    expect(signed.headers["content-type"]).toBe("application/pdf");
  });

  it("names the credential scope and the signed headers", () => {
    expect(signed.headers.authorization).toContain(
      "Credential=AKIAEXAMPLE/20260826/af-johannesburg-1/s3/aws4_request",
    );
    // Alphabetical, which is what the canonical request is built from.
    expect(signed.headers.authorization).toContain(
      "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date",
    );
    expect(signed.headers.authorization).toMatch(/Signature=[0-9a-f]{64}$/);
  });

  /**
   * The signature has to depend on every part of the request. If any of these
   * produced the same signature, an attacker could reuse one.
   */
  it("changes when anything in the request changes", () => {
    const base = signed.headers.authorization;

    const otherKey = signRequest(CONFIG, {
      method: "PUT",
      key: "org-1/evidence/sub-2/other.pdf",
      payloadSha256: "a".repeat(64),
      contentType: "application/pdf",
      now: AT,
    }).headers.authorization;

    const otherBody = signRequest(CONFIG, {
      method: "PUT",
      key: "org-1/evidence/sub-2/file.pdf",
      payloadSha256: "c".repeat(64),
      contentType: "application/pdf",
      now: AT,
    }).headers.authorization;

    const otherMethod = signRequest(CONFIG, {
      method: "GET",
      key: "org-1/evidence/sub-2/file.pdf",
      payloadSha256: "a".repeat(64),
      contentType: "application/pdf",
      now: AT,
    }).headers.authorization;

    expect(new Set([base, otherKey, otherBody, otherMethod]).size).toBe(4);
  });

  it("says what is missing rather than failing obscurely", () => {
    expect(() =>
      s3ConfigFromEnv({ S3_ENDPOINT: "https://x.test" }),
    ).toThrow(/S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY/);
  });

  it("keeps path style unless it is turned off explicitly", () => {
    const env = {
      S3_ENDPOINT: "https://x.test",
      S3_REGION: "r",
      S3_BUCKET: "b",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
    };

    expect(s3ConfigFromEnv(env).forcePathStyle).toBe(true);
    expect(
      s3ConfigFromEnv({ ...env, S3_FORCE_PATH_STYLE: "false" }).forcePathStyle,
    ).toBe(false);
  });
});

describe("against a bucket", () => {
  const objects = new Map<string, { body: Buffer; contentType?: string }>();
  const seen: { method: string; url: string; headers: Record<string, string> }[] =
    [];
  let server: Server;
  let config: S3Config;
  let refuse: number | null = null;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(chunk as Buffer));
      request.on("end", () => {
        seen.push({
          method: request.method ?? "",
          url: request.url ?? "",
          headers: request.headers as Record<string, string>,
        });

        if (refuse !== null) {
          response.writeHead(refuse, { "content-type": "application/xml" });
          response.end(
            "<Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match.</Message></Error>",
          );
          return;
        }

        const key = decodeURIComponent(request.url ?? "").replace(
          "/roft-evidence/",
          "",
        );

        if (request.method === "PUT") {
          objects.set(key, {
            body: Buffer.concat(chunks),
            contentType: request.headers["content-type"],
          });
          response.writeHead(200).end();
          return;
        }

        const stored = objects.get(key);
        if (!stored) {
          response.writeHead(404, { "content-type": "application/xml" });
          response.end(
            "<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>",
          );
          return;
        }

        if (request.method === "HEAD") {
          response.writeHead(200).end();
          return;
        }

        response.writeHead(200).end(stored.body);
      });
    });

    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    config = {
      ...CONFIG,
      endpoint: `http://127.0.0.1:${port}`,
      forcePathStyle: true,
    };
  });

  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
  });

  it("stores a file and hands it back byte for byte", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10]);

    await putObjectS3(config, "org-1/evidence/sub-2/file.pdf", bytes, "application/pdf");
    const back = await getObjectS3(config, "org-1/evidence/sub-2/file.pdf");

    expect([...back]).toEqual([...bytes]);
  });

  /**
   * The invariant the whole Portfolio of Evidence rests on. The hash recorded
   * against a submission has to be the hash of what was actually sent — if the
   * two could differ, the integrity check proves nothing.
   */
  it("signs with the hash of the bytes it actually sends", async () => {
    seen.length = 0;
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const expected = createHash("sha256").update(bytes).digest("hex");

    await putObjectS3(config, "org-1/evidence/sub-3/x.bin", bytes);

    const request = seen.find((entry) => entry.method === "PUT");
    expect(request?.headers["x-amz-content-sha256"]).toBe(expected);
    expect(request?.headers.authorization).toContain("AWS4-HMAC-SHA256");
  });

  it("keeps the content type it was given", async () => {
    await putObjectS3(
      config,
      "org-1/evidence/sub-4/report.pdf",
      new Uint8Array([1]),
      "application/pdf",
    );

    expect(objects.get("org-1/evidence/sub-4/report.pdf")?.contentType).toBe(
      "application/pdf",
    );
  });

  it("reports a missing object as absent rather than as an error", async () => {
    expect(await objectExistsS3(config, "org-1/evidence/nope/x.pdf")).toBe(
      false,
    );
    expect(await objectExistsS3(config, "org-1/evidence/sub-4/report.pdf")).toBe(
      true,
    );
  });

  /**
   * A refusal must never be mistaken for a successful write. The message the
   * bucket gave is passed through, because "SignatureDoesNotMatch" and
   * "NoSuchBucket" need different things done about them.
   */
  it("raises a refusal, carrying what the bucket said", async () => {
    refuse = 403;
    try {
      await expect(
        putObjectS3(config, "org-1/evidence/sub-5/x.pdf", new Uint8Array([1])),
      ).rejects.toThrow(/403.*signature/i);
    } finally {
      refuse = null;
    }
  });

  it("raises when the bucket cannot be reached at all", async () => {
    const unreachable = { ...config, endpoint: "http://127.0.0.1:1" };

    await expect(
      putObjectS3(unreachable, "org-1/evidence/sub-6/x.pdf", new Uint8Array([1])),
    ).rejects.toThrow(StorageError);
  });
});
