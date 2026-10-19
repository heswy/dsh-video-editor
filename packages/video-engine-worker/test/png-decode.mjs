// Minimal PNG decoder for evidence checks: 8-bit RGB/RGBA, non-interlaced.
// Used only by tests to compare worker frames / rendered stills; no dependency.
import { inflateSync } from "node:zlib";

function paeth(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

export function decodePng(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!bytes.subarray(0, 8).equals(signature)) throw new Error("not a PNG");
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (!header) throw new Error("PNG has no IHDR");
  if (header.bitDepth !== 8) throw new Error("unsupported PNG bit depth");
  if (header.interlace !== 0) throw new Error("interlaced PNG unsupported");
  if (![2, 6].includes(header.colorType))
    throw new Error(`unsupported PNG color type ${header.colorType}`);
  const channels = header.colorType === 6 ? 4 : 3;
  const stride = header.width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const expected = (stride + 1) * header.height;
  if (raw.length !== expected)
    throw new Error(`unexpected PNG data length ${raw.length} != ${expected}`);
  const data = Buffer.alloc(header.width * header.height * channels);
  for (let y = 0; y < header.height; y++) {
    const filter = raw[y * (stride + 1)];
    const source = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const rowOffset = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? data[rowOffset + x - channels] : 0;
      const up = y > 0 ? data[rowOffset - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? data[rowOffset - stride + x - channels] : 0;
      let value = source[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) value += paeth(left, up, upLeft);
      data[rowOffset + x] = value & 0xff;
    }
  }
  return {
    width: header.width,
    height: header.height,
    channels,
    data,
  };
}

/** Bounding box of pixels matching predicate(image, x, y) or null. */
export function pixelBBox(image, predicate) {
  const { width, height, channels, data } = image;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * channels;
      if (!predicate(data, index, x, y)) continue;
      count += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return count ? { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1, count } : null;
}

export function diffImages(before, after, tolerance = 0) {
  if (before.width !== after.width || before.height !== after.height)
    throw new Error("image size mismatch");
  const channels = Math.min(before.channels, after.channels);
  const { width, height } = before;
  let changed = 0;
  let sum = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const beforeIndex = (y * width + x) * before.channels;
      const afterIndex = (y * width + x) * after.channels;
      let delta = 0;
      for (let channel = 0; channel < channels; channel++)
        delta = Math.max(
          delta,
          Math.abs(before.data[beforeIndex + channel] - after.data[afterIndex + channel]),
        );
      sum += delta;
      if (delta > tolerance) {
        changed += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return {
    changedPixels: changed,
    changedPct: changed / (width * height),
    mae: sum / (width * height),
    bbox: changed
      ? { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 }
      : null,
  };
}

/** Reddish text pixels (title color #ff0000 blended over the scene background). */
export function redTextBBox(image) {
  return pixelBBox(
    image,
    (data, index) => data[index] > 150 && data[index + 1] < 100,
  );
}
