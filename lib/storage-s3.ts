import { createHash, createHmac } from "node:crypto";

/**
 * S3-compatible object storage.
 *
 * Written against the REST API rather than pulling in the AWS SDK. Three
 * operations — put, get, head — do not justify fifteen megabytes of
 * dependencies on a small VPS, and going direct is what keeps this working
 * against any S3-compatible provider rather than AWS specifically. Oracle
 * Object Storage, Backblaze, MinIO and Hostinger all speak this protocol; the
 * differences between them are the endpoint and whether the bucket goes in the
 * host or the path, both of which are configuration here.
 *
 * The signing is Signature Version 4. It is fiddly but it is specified, and it
 * fails loudly: a signature that is wrong in any detail produces a 403 with a
 * message naming what did not match. That matters for the decision to write it
 * by hand — this is not like parsing a document, where wrong looks like right.
 */

export class StorageError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * Bucket in the path (`https://host/bucket/key`) rather than in the host
   * (`https://bucket.host/key`).
   *
   * Path style is the default here because it is what every S3-compatible
   * provider accepts, and because virtual-host style needs a wildcard
   * certificate the provider may not have issued.
   */
  forcePathStyle: boolean;
};

/** Empty payload, hashed. Required on every request that carries no body. */
const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function s3ConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): S3Config {
  const missing = [
    "S3_ENDPOINT",
    "S3_REGION",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ].filter((name) => !env[name]);

  if (missing.length > 0) {
    throw new StorageError(
      `STORAGE_DRIVER is "s3" but ${missing.join(", ")} ${
        missing.length === 1 ? "is" : "are"
      } not set. Evidence cannot be stored until they are.`,
    );
  }

  return {
    endpoint: env.S3_ENDPOINT!.replace(/\/+$/, ""),
    region: env.S3_REGION!,
    bucket: env.S3_BUCKET!,
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    // Opt out explicitly; anything else, including unset, keeps path style.
    forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? "true") !== "false",
  };
}

/**
 * Percent-encoding as the signing spec defines it, which is stricter than
 * encodeURIComponent: that leaves `!'()*` alone and S3 expects them encoded.
 * A key containing one would otherwise sign correctly and be rejected.
 */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalKeyPath(config: S3Config, key: string): string {
  const encoded = key.split("/").map(encodeSegment).join("/");
  return config.forcePathStyle
    ? `/${encodeSegment(config.bucket)}/${encoded}`
    : `/${encoded}`;
}

function hostFor(config: S3Config): string {
  const url = new URL(config.endpoint);
  return config.forcePathStyle ? url.host : `${config.bucket}.${url.host}`;
}

function urlFor(config: S3Config, key: string): string {
  const url = new URL(config.endpoint);
  const path = canonicalKeyPath(config, key);
  return config.forcePathStyle
    ? `${url.origin}${path}`
    : `${url.protocol}//${config.bucket}.${url.host}${path}`;
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Builds the Authorization header for one request.
 *
 * Exported so it can be tested on its own: this is the part where an ordering
 * mistake or a missing newline produces a request that looks perfectly normal
 * and is refused by the server.
 */
export function signRequest(
  config: S3Config,
  input: {
    method: "GET" | "PUT" | "HEAD" | "DELETE";
    key: string;
    payloadSha256: string;
    contentType?: string;
    now?: Date;
  },
): { url: string; headers: Record<string, string> } {
  const now = input.now ?? new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const date = stamp.slice(0, 8);

  const host = hostFor(config);

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": input.payloadSha256,
    "x-amz-date": stamp,
  };
  if (input.contentType) headers["content-type"] = input.contentType;

  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders
    .map((name) => `${name}:${headers[name].trim()}\n`)
    .join("");

  const canonicalRequest = [
    input.method,
    canonicalKeyPath(config, input.key),
    // No query string on any request this makes.
    "",
    canonicalHeaders,
    signedHeaders.join(";"),
    input.payloadSha256,
  ].join("\n");

  const scope = `${date}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, date), config.region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return {
    url: urlFor(config, input.key),
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}`,
    },
  };
}

/** Long enough for a 500 MB video on a poor line, short enough to give up. */
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

async function send(
  config: S3Config,
  input: {
    method: "GET" | "PUT" | "HEAD" | "DELETE";
    key: string;
    body?: Uint8Array;
    contentType?: string;
  },
): Promise<Response> {
  const payloadSha256 = input.body ? sha256Hex(input.body) : EMPTY_SHA256;
  const { url, headers } = signRequest(config, {
    method: input.method,
    key: input.key,
    payloadSha256,
    contentType: input.contentType,
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: input.method,
      headers,
      body: input.body ? Buffer.from(input.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // A network failure here means evidence was not stored. It must not be
    // reported as anything softer than that.
    throw new StorageError(
      `Object storage could not be reached: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  if (!response.ok) {
    // S3 puts the reason in an XML body. Passed through rather than
    // summarised: "SignatureDoesNotMatch" and "NoSuchBucket" need different
    // things done about them.
    const detail = await response.text().catch(() => "");
    const reason = /<Message>([^<]+)<\/Message>/.exec(detail)?.[1] ?? "";

    throw new StorageError(
      `Object storage refused the request (${response.status})${reason ? `: ${reason}` : ""}`,
      response.status,
    );
  }

  return response;
}

export async function putObjectS3(
  config: S3Config,
  key: string,
  bytes: Uint8Array,
  contentType?: string,
): Promise<void> {
  await send(config, {
    method: "PUT",
    key,
    body: bytes,
    contentType: contentType ?? "application/octet-stream",
  });
}

export async function getObjectS3(
  config: S3Config,
  key: string,
): Promise<Uint8Array> {
  const response = await send(config, { method: "GET", key });
  return new Uint8Array(await response.arrayBuffer());
}

/** Whether the object is there, without pulling it down. */
export async function objectExistsS3(
  config: S3Config,
  key: string,
): Promise<boolean> {
  try {
    await send(config, { method: "HEAD", key });
    return true;
  } catch (error) {
    if (error instanceof StorageError && error.status === 404) return false;
    throw error;
  }
}
