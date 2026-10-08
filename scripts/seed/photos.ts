// The demo's photos are the prototype's files, copied to public/photos (thumbs
// in public/photos/thumbs). A media row points at '/photos/<name>.jpg' and
// carries the real size and pixel dimensions, read from the file here.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PHOTOS_DIR = fileURLToPath(new URL('../../public/photos/', import.meta.url));

export type PhotoInfo = { storageKey: string; sizeBytes: number; width: number | null; height: number | null };

/** Pixel size from a JPEG's SOF segment (baseline, progressive, …). */
function jpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

const cache = new Map<string, PhotoInfo>();

/** '/photos/<name>.jpg' plus its size and dimensions. Throws if the file is missing (D77: only existing photos). */
export function photo(name: string): PhotoInfo {
  const hit = cache.get(name);
  if (hit) return hit;
  const buf = readFileSync(`${PHOTOS_DIR}${name}.jpg`);
  const dim = jpegSize(buf);
  const info: PhotoInfo = { storageKey: `/photos/${name}.jpg`, sizeBytes: buf.length, width: dim?.width ?? null, height: dim?.height ?? null };
  cache.set(name, info);
  return info;
}
