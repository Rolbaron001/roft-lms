/**
 * Working out what an uploaded file actually is.
 *
 * The filename and the content type the browser sends are both supplied by
 * whoever is uploading, and neither survives contact with someone determined.
 * A file called `safe.png` announcing `image/png` can contain anything at all
 * — and if the platform later serves it back with that content type, the
 * browser will do whatever the real contents say. That is how an "image"
 * uploaded as evidence becomes a script running on an assessor's session.
 *
 * So the type is decided by reading the first bytes of the file. The
 * extension is used only to tell apart formats that genuinely share a
 * container, notably the Office formats, which are all ZIP archives.
 */

export type MediaKind =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "slides"
  | "spreadsheet"
  | "archive";

export type DetectedMedia = {
  kind: MediaKind;
  /** The type the file really is, not the one it claimed. */
  mimeType: string;
  extension: string;
  /**
   * Whether this may be rendered inline in a page. Anything that can carry
   * script — HTML, SVG — is false, and gets sent as a download instead.
   */
  safeToEmbed: boolean;
  label: string;
};

export type DetectionFailure = {
  ok: false;
  reason: string;
};

export type DetectionSuccess = { ok: true } & DetectedMedia;

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

/** Formats recognised by their leading bytes. */
const SIGNATURES: {
  kind: MediaKind;
  mimeType: string;
  extension: string;
  label: string;
  safeToEmbed: boolean;
  matches: (bytes: Uint8Array) => boolean;
}[] = [
  {
    kind: "image",
    mimeType: "image/png",
    extension: "png",
    label: "PNG image",
    safeToEmbed: true,
    matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    kind: "image",
    mimeType: "image/jpeg",
    extension: "jpg",
    label: "JPEG image",
    safeToEmbed: true,
    matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  },
  {
    kind: "image",
    mimeType: "image/gif",
    extension: "gif",
    label: "GIF image",
    safeToEmbed: true,
    matches: (b) => asciiAt(b, 0, 4) === "GIF8",
  },
  {
    kind: "image",
    mimeType: "image/webp",
    extension: "webp",
    label: "WebP image",
    safeToEmbed: true,
    matches: (b) => asciiAt(b, 0, 4) === "RIFF" && asciiAt(b, 8, 4) === "WEBP",
  },
  {
    kind: "document",
    mimeType: "application/pdf",
    extension: "pdf",
    label: "PDF document",
    safeToEmbed: true,
    matches: (b) => asciiAt(b, 0, 4) === "%PDF",
  },
  {
    kind: "video",
    mimeType: "video/mp4",
    extension: "mp4",
    label: "MP4 video",
    // The `ftyp` box sits after a four-byte length.
    safeToEmbed: true,
    matches: (b) => asciiAt(b, 4, 4) === "ftyp",
  },
  {
    kind: "video",
    mimeType: "video/webm",
    extension: "webm",
    label: "WebM video",
    safeToEmbed: true,
    matches: (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]),
  },
  {
    kind: "audio",
    mimeType: "audio/mpeg",
    extension: "mp3",
    label: "MP3 audio",
    safeToEmbed: true,
    matches: (b) =>
      asciiAt(b, 0, 3) === "ID3" || startsWith(b, [0xff, 0xfb]) ||
      startsWith(b, [0xff, 0xf3]) || startsWith(b, [0xff, 0xf2]),
  },
  {
    kind: "audio",
    mimeType: "audio/ogg",
    extension: "ogg",
    label: "Ogg audio",
    safeToEmbed: true,
    matches: (b) => asciiAt(b, 0, 4) === "OggS",
  },
];

/**
 * The Office formats are ZIP archives, so the leading bytes are identical for
 * a Word document, a slide deck and a spreadsheet. The extension is the only
 * practical way to tell them apart, and it is safe to rely on here because the
 * container has already been confirmed as a genuine ZIP.
 */
const ZIP_FORMATS: Record<
  string,
  { kind: MediaKind; mimeType: string; label: string }
> = {
  docx: {
    kind: "document",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    label: "Word document",
  },
  pptx: {
    kind: "slides",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    label: "PowerPoint slide deck",
  },
  xlsx: {
    kind: "spreadsheet",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    label: "Excel spreadsheet",
  },
  odt: {
    kind: "document",
    mimeType: "application/vnd.oasis.opendocument.text",
    label: "OpenDocument text",
  },
  odp: {
    kind: "slides",
    mimeType: "application/vnd.oasis.opendocument.presentation",
    label: "OpenDocument presentation",
  },
  zip: {
    kind: "archive",
    mimeType: "application/zip",
    // SCORM packages arrive this way.
    label: "ZIP archive",
  },
};

export function extensionOf(filename: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

/**
 * Reads the leading bytes and reports what the file is.
 *
 * Refuses anything it does not positively recognise. An allowlist is the only
 * defensible position: a denylist of dangerous formats is a list of the ones
 * somebody thought of.
 */
export function detectMedia(
  bytes: Uint8Array,
  filename: string,
): DetectionSuccess | DetectionFailure {
  if (bytes.length === 0) {
    return { ok: false, reason: "The file is empty." };
  }

  const extension = extensionOf(filename);

  // Refused before anything else. An SVG is a document that can carry script,
  // and HTML obviously so; neither belongs in a file another person will open
  // from inside their signed-in session.
  const leading = asciiAt(bytes, 0, Math.min(bytes.length, 64))
    .trim()
    .toLowerCase();

  if (
    leading.startsWith("<svg") ||
    leading.startsWith("<!doctype html") ||
    leading.startsWith("<html") ||
    (leading.startsWith("<?xml") && leading.includes("<svg"))
  ) {
    return {
      ok: false,
      reason:
        "SVG and HTML files are not accepted, because they can carry scripts that would run for whoever opens them. Export it as PNG or PDF instead.",
    };
  }

  for (const signature of SIGNATURES) {
    if (signature.matches(bytes)) {
      return {
        ok: true,
        kind: signature.kind,
        mimeType: signature.mimeType,
        extension: signature.extension,
        safeToEmbed: signature.safeToEmbed,
        label: signature.label,
      };
    }
  }

  // ZIP container: PK\x03\x04, or the empty-archive variant.
  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])
  ) {
    const format = ZIP_FORMATS[extension];
    if (!format) {
      return {
        ok: false,
        reason: `That looks like a compressed file, but "${extension || "no extension"}" is not one this platform handles.`,
      };
    }

    return {
      ok: true,
      kind: format.kind,
      mimeType: format.mimeType,
      extension,
      // Office formats download rather than render; the browser has no
      // business trying to display them inline.
      safeToEmbed: false,
      label: format.label,
    };
  }

  // Plain text is accepted only when it says so, and only when it really is
  // text — a run of NUL bytes means something binary is wearing a .txt.
  if (extension === "txt" || extension === "csv") {
    const sample = bytes.slice(0, 512);
    if (!sample.includes(0)) {
      return {
        ok: true,
        kind: "document",
        mimeType: extension === "csv" ? "text/csv" : "text/plain",
        extension,
        safeToEmbed: false,
        label: extension === "csv" ? "CSV file" : "Text file",
      };
    }
  }

  return {
    ok: false,
    reason:
      "That file type is not recognised. Images, video, audio, PDF and Office documents are accepted.",
  };
}

/**
 * Size ceilings by kind.
 *
 * Video is generous because a recorded practical assessment is genuinely
 * large; everything else is held down so a mistyped upload cannot fill the
 * disk. These are checked before the file is written, not after.
 */
export const SIZE_LIMITS: Record<MediaKind, number> = {
  image: 10 * 1024 * 1024,
  video: 500 * 1024 * 1024,
  audio: 100 * 1024 * 1024,
  document: 50 * 1024 * 1024,
  slides: 100 * 1024 * 1024,
  spreadsheet: 25 * 1024 * 1024,
  archive: 250 * 1024 * 1024,
};

export function describeSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The lesson content type that suits a detected file. */
export function lessonContentTypeFor(kind: MediaKind): string {
  switch (kind) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "slides":
      return "slide_deck";
    case "archive":
      return "scorm";
    default:
      return "document";
  }
}
