/**
 * The queue on the phone: what a learner captured with no signal.
 *
 * Runs only in a browser. Imports nothing from the server, and nothing here
 * reaches the database - so this file can be pulled into a client component
 * without dragging the Postgres driver into the bundle with it.
 *
 * IndexedDB rather than localStorage, for one reason that decides it: a
 * photograph is a Blob, and localStorage holds strings. Base64-encoding a
 * fortnight of photographs to fit them into a five-megabyte string store is
 * how a phone runs out of room on day three.
 *
 * Three things here are less obvious than they look.
 *
 * **The device key is generated once, when the work is captured**, and never
 * again. It is what makes an upload idempotent: a phone that sends, loses
 * signal before hearing the reply and retries must not create the work twice.
 *
 * **The capture time is recorded on the device and sent as what the device
 * said**, not as fact. The server keeps its own received time alongside it.
 * A phone's clock can be wrong by accident or set wrong on purpose.
 *
 * **Only what the server accepted is cleared.** A refusal that might be
 * temporary stays queued; a refusal that will never succeed is dropped, because
 * holding it for a fortnight helps nobody.
 */

const DATABASE = "roft-lms-offline";
const STORE = "queued";
const VERSION = 1;

export type QueuedItem = {
  /** Generated once at capture. The idempotency key. */
  deviceKey: string;
  kind: string;
  targetType: string;
  targetId: string;
  qualificationId?: string;
  payload: Record<string, unknown>;
  /** What this device's clock said when the learner captured it. */
  capturedAt: string;
  /** A photograph or a recording, held as a Blob rather than a string. */
  file?: Blob;
  fileName?: string;
  /** How many times we have tried to send it, for the learner's own sake. */
  attempts: number;
  lastError?: string;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "deviceKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = run(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

/**
 * A key nobody else will generate.
 *
 * `crypto.randomUUID` where the browser has it, and a composed fallback where
 * it does not - an older Android WebView, which is exactly the device this
 * feature exists for.
 */
export function newDeviceKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Puts one piece of captured work on the queue. */
export async function enqueue(
  item: Omit<QueuedItem, "deviceKey" | "capturedAt" | "attempts"> & {
    deviceKey?: string;
    capturedAt?: string;
  },
): Promise<QueuedItem> {
  const queued: QueuedItem = {
    ...item,
    deviceKey: item.deviceKey ?? newDeviceKey(),
    capturedAt: item.capturedAt ?? new Date().toISOString(),
    attempts: 0,
  };

  await transact("readwrite", (store) => store.put(queued));
  return queued;
}

/** Everything still waiting to go. */
export async function queued(): Promise<QueuedItem[]> {
  const all = await transact<QueuedItem[]>("readonly", (store) =>
    store.getAll(),
  );
  return all.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

export async function forget(deviceKey: string): Promise<void> {
  await transact("readwrite", (store) => store.delete(deviceKey));
}

/** How much room the queue is taking, for the screen that shows it. */
export async function queueSize(): Promise<{ count: number; bytes: number }> {
  const all = await queued();
  let bytes = 0;
  for (const item of all) {
    bytes += item.file?.size ?? 0;
    bytes += JSON.stringify(item.payload).length;
  }
  return { count: all.length, bytes };
}

/**
 * Shrinks a photograph before it is queued.
 *
 * Heidi's answer on 10 September was that the work is reading *and* evidence
 * capture, and photographs are what fill a phone. A modern camera writes four
 * megabytes a picture; a fortnight of those is most of the storage a browser
 * will allow.
 *
 * Done at capture rather than at upload, deliberately. Compressing on the way
 * out would mean holding the full-size originals for the fortnight in between,
 * which is the problem.
 *
 * Returns the original untouched if anything goes wrong, or if the file is not
 * an image. A slightly large photograph is a much smaller problem than a
 * photograph the learner cannot submit at all.
 */
export async function compressImage(
  file: File | Blob,
  options: { maxEdge?: number; quality?: number } = {},
): Promise<Blob> {
  const maxEdge = options.maxEdge ?? 1600;
  const quality = options.quality ?? 0.7;

  if (!file.type.startsWith("image/")) return file;
  if (typeof createImageBitmap !== "function") return file;

  try {
    const bitmap = await createImageBitmap(file);

    // Already small enough, so re-encoding would only lose detail.
    if (bitmap.width <= maxEdge && bitmap.height <= maxEdge) {
      bitmap.close?.();
      return file;
    }

    const scale = maxEdge / Math.max(bitmap.width, bitmap.height);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas =
      typeof OffscreenCanvas === "function"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), { width, height });

    const context = (
      canvas as HTMLCanvasElement | OffscreenCanvas
    ).getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;

    if (!context) {
      bitmap.close?.();
      return file;
    }

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const shrunk =
      canvas instanceof OffscreenCanvas
        ? await canvas.convertToBlob({ type: "image/jpeg", quality })
        : await new Promise<Blob | null>((resolve) =>
            (canvas as HTMLCanvasElement).toBlob(
              resolve,
              "image/jpeg",
              quality,
            ),
          );

    // Only worth keeping if it actually saved something.
    return shrunk && shrunk.size < file.size ? shrunk : file;
  } catch {
    return file;
  }
}

export type DrainResult = {
  sent: number;
  kept: number;
  dropped: { deviceKey: string; why: string }[];
};

/**
 * Sends what is queued, and clears only what was accepted.
 *
 * In batches, because a failure should lose a batch rather than a fortnight.
 * The file goes as its own request after the record it belongs to, so a large
 * photograph failing does not take the note with it.
 */
export async function drain(
  options: { batchSize?: number } = {},
): Promise<DrainResult> {
  const batchSize = options.batchSize ?? 20;
  const all = await queued();

  const result: DrainResult = { sent: 0, kept: 0, dropped: [] };
  if (all.length === 0) return result;

  for (let index = 0; index < all.length; index += batchSize) {
    const batch = all.slice(index, index + batchSize);

    let response: Response;
    try {
      response = await fetch("/api/offline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          batch.map((item) => ({
            kind: item.kind,
            targetType: item.targetType,
            targetId: item.targetId,
            qualificationId: item.qualificationId,
            payload: {
              ...item.payload,
              // Named rather than attached: the file follows separately, and
              // the record has to say that one is coming.
              ...(item.fileName ? { fileName: item.fileName } : {}),
            },
            deviceKey: item.deviceKey,
            capturedAt: item.capturedAt,
          })),
        ),
      });
    } catch {
      // No signal, or it went away mid-send. Everything stays queued.
      result.kept += batch.length;
      continue;
    }

    if (!response.ok) {
      result.kept += batch.length;
      continue;
    }

    const body = (await response.json()) as {
      results: { deviceKey: string; ok: boolean; error?: string; retry?: boolean }[];
    };

    for (const outcome of body.results ?? []) {
      if (outcome.ok) {
        await forget(outcome.deviceKey);
        result.sent += 1;
        continue;
      }

      if (outcome.retry === false) {
        // It will be refused every time, so the learner is told and it goes.
        await forget(outcome.deviceKey);
        result.dropped.push({
          deviceKey: outcome.deviceKey,
          why: outcome.error ?? "Refused.",
        });
        continue;
      }

      const item = batch.find((q) => q.deviceKey === outcome.deviceKey);
      if (item) {
        await transact("readwrite", (store) =>
          store.put({
            ...item,
            attempts: item.attempts + 1,
            lastError: outcome.error,
          }),
        );
      }
      result.kept += 1;
    }
  }

  return result;
}
