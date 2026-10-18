/**
 * Session-owned image previews for the embedded AI conversation.
 *
 * The native chat normally opens files through the Host's global right sidebar.
 * Inside a global main panel that surface is not mounted, so the plugin offers a
 * local preview backed by this small reader. The request is deliberately narrow:
 * the caller names one already-registered project Session, and the file must live
 * under the trusted session cwd or the worker output root. There is no arbitrary
 * filesystem read, no path from the tool, and no URL fetching.
 */

import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BridgeError } from './errors.js';

const MAX_PATH = 4096;
const IMAGE_EXTENSIONS = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
});

function fail(code, message, stage) {
  throw new BridgeError(code, message, { stage: stage || 'preview' });
}

function pathText(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH || value.includes('\0')) {
    fail('E_PARAMS', 'Invalid preview path', 'params');
  }
  return value;
}

/** Detect an image type from its leading bytes; never trust the extension alone. */
export function sniffImageMediaType(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return null;
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  ) {
    return 'image/gif';
  }
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

function inside(root, candidate) {
  if (candidate === root) return true;
  return candidate.startsWith(root.endsWith('/') ? root : root + '/');
}

async function canonicalRoot(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const real = await realpath(value);
    const info = await stat(real);
    return info.isDirectory() ? real : null;
  } catch (_error) {
    return null;
  }
}

function requestedPath(value) {
  const raw = pathText(value);
  if (raw.startsWith('file://')) {
    try {
      return fileURLToPath(raw);
    } catch (_error) {
      fail('E_PREVIEW_DENIED', 'The preview path is not a file address', 'preview');
    }
  }
  return raw;
}

/**
 * Read one image preview for an explicitly registered Session.
 *
 * @param options - trusted limits/roots plus the requested relative/absolute path.
 * @returns image metadata and a bounded data URL; the absolute Host path is not returned.
 */
export async function readPreviewFile(options) {
  const input = options || {};
  const limit = Number.isFinite(input.maxBytes) && input.maxBytes > 0 ? Math.floor(input.maxBytes) : 8 * 1024 * 1024;
  const requested = requestedPath(input.path);
  const roots = [];
  if (typeof input.sessionCwd === 'string' && input.sessionCwd.length > 0) {
    const root = await canonicalRoot(input.sessionCwd);
    if (root !== null) roots.push({ root, kind: 'session' });
  }
  if (typeof input.artifactRoot === 'string' && input.artifactRoot.length > 0) {
    const root = await canonicalRoot(input.artifactRoot);
    if (root !== null) roots.push({ root, kind: 'artifact' });
  }
  if (roots.length === 0) fail('E_PREVIEW_DENIED', 'No trusted preview root is configured', 'preview');

  let candidatePath;
  if (isAbsolute(requested)) {
    candidatePath = requested;
  } else {
    const sessionRoot = roots.find((entry) => entry.kind === 'session');
    if (sessionRoot === undefined) fail('E_PREVIEW_DENIED', 'Relative preview paths need a session root', 'preview');
    candidatePath = join(sessionRoot.root, requested);
  }

  let canonical;
  let info;
  try {
    canonical = await realpath(candidatePath);
    info = await stat(canonical);
  } catch (_error) {
    fail('E_PREVIEW_NOT_FOUND', 'The preview file does not exist', 'preview');
  }
  if (info.isFile() === false) fail('E_PREVIEW_DENIED', 'The preview target is not a regular file', 'preview');
  const allowed = roots.some((entry) => inside(entry.root, canonical));
  if (allowed === false) fail('E_PREVIEW_DENIED', 'The preview target is outside the trusted roots', 'preview');
  if (info.size > limit) fail('E_PREVIEW_LIMIT', `The preview file exceeds ${limit} bytes`, 'preview');

  const extension = extname(canonical).toLowerCase();
  const declared = IMAGE_EXTENSIONS[extension];
  if (declared === undefined) fail('E_PREVIEW_UNSUPPORTED', 'This file type has no embedded preview', 'preview');
  let bytes;
  try {
    bytes = await readFile(canonical);
  } catch (_error) {
    fail('E_PREVIEW_NOT_FOUND', 'The preview file could not be read', 'preview');
  }
  if (bytes.length > limit) fail('E_PREVIEW_LIMIT', `The preview file exceeds ${limit} bytes`, 'preview');
  const sniffed = sniffImageMediaType(bytes);
  if (sniffed === null || sniffed !== declared) {
    // A renamed non-image must not become an in-panel script or fake image.
    fail('E_PREVIEW_UNSUPPORTED', 'The file content does not match a supported image', 'preview');
  }
  return {
    fileName: basename(canonical),
    mediaType: sniffed,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    dataUrl: `data:${sniffed};base64,${Buffer.from(bytes).toString('base64')}`,
  };
}

export { IMAGE_EXTENSIONS };
