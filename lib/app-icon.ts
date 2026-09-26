import { deflateSync } from "node:zlib";

/**
 * The install icon, as a PNG, drawn without any image library.
 *
 * A square of the provider's colour with a white open book on it. Written by
 * hand because the image library the platform carries for PDFs is a native
 * module, and on 26 September it could not be loaded from a route: a picture
 * this simple is cheaper to compute than to depend on.
 *
 * Chrome offers to install a web app only when its manifest names a 192 pixel
 * and a 512 pixel icon (web.dev, "What does it take to be installable?",
 * checked 26 September).
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Whether a point lies inside a convex quadrilateral given clockwise or not. */
function inside(x: number, y: number, points: [number, number][]): boolean {
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cross !== 0) {
      if (sign === 0) sign = Math.sign(cross);
      else if (Math.sign(cross) !== sign) return false;
    }
  }
  return true;
}

export function iconPng(size: number, colour: string): Buffer {
  const hex = /^#[0-9a-f]{6}$/i.test(colour) ? colour : "#1f2937";
  const background = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const unit = size / 16;
  const left: [number, number][] = [
    [3 * unit, 4.5 * unit],
    [7.5 * unit, 5.5 * unit],
    [7.5 * unit, 12.5 * unit],
    [3 * unit, 11.5 * unit],
  ];
  const right: [number, number][] = [
    [13 * unit, 4.5 * unit],
    [8.5 * unit, 5.5 * unit],
    [8.5 * unit, 12.5 * unit],
    [13 * unit, 11.5 * unit],
  ];

  // Each row starts with a filter byte of 0, then RGB per pixel.
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const white = inside(px, py, left) || inside(px, py, right);
      const at = row + 1 + x * 3;
      raw[at] = white ? 255 : background[0];
      raw[at + 1] = white ? 255 : background[1];
      raw[at + 2] = white ? 255 : background[2];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
