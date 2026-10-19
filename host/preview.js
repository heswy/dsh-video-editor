/**
 * Session-owned image previews for the embedded AI conversation (P3-006-C, R3).
 *
 * The native chat normally opens files through the Host's global right sidebar.
 * Inside a global main panel that surface is not mounted, so the plugin offers a
 * local preview backed by this small reader.
 *
 * The caller (VideoBridge) computes the exact owned roots for one bound
 * project/Session pair: the managed project directory, the per-project Session
 * working directory, worker job outputs registered to that project, Host-issued
 * inbox upload receipts, and the legacy shared Session root with an ownership
 * verifier. This module only canonicalizes those roots, resolves the requested
 * path, and requires that at least one owned root both contains the real file and
 * passes its verifier. There is no arbitrary filesystem read, no path from the
 * model Tool, and no URL fetching.
 */

import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, basename, extname, resolve } from 'node:path';
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
/** Roots that may resolve a relative request, in priority order. */
const RELATIVE_ROOT_KINDS = Object.freeze(['session', 'legacy']);

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

/** Both paths are canonical absolute paths, so a plain prefix check is exact. */
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
 * Canonicalize the caller-supplied trusted roots. Entries may carry an async
 * `verify(canonical, root)` ownership probe; a root without one is trusted as-is
 * for this project/Session pair by the caller's provenance rules.
 */
async function canonicalRoots(entries) {
  const roots = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue;
    if (typeof entry.path !== 'string' || entry.path.length === 0) continue;
    const canonical = await canonicalRoot(entry.path);
    if (canonical === null) continue;
    roots.push({
      kind: typeof entry.kind === 'string' && entry.kind.length > 0 ? entry.kind : 'trusted',
      root: canonical,
      verify: typeof entry.verify === 'function' ? entry.verify : null,
    });
  }
  return roots;
}

async function canonicalFile(path) {
  try {
    const real = await realpath(path);
    const info = await stat(real);
    return info.isFile() ? { canonical: real, info } : null;
  } catch (_error) {
    return null;
  }
}

/**
 * Whether a missing absolute path belongs to an owned root, proven through its
 * nearest existing ancestor. This keeps "not found" honest without turning a
 * missing arbitrary path into a filesystem existence oracle.
 */
async function missingPathInsideOwnedRoot(roots, requested) {
  let current = resolve(requested);
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      const real = await realpath(current);
      return roots.some((entry) => inside(entry.root, real));
    } catch (_error) {
      const parent = dirname(current);
      if (parent === current) return false;
      current = parent;
    }
  }
  return false;
}

/**
 * Read one image preview for an explicitly registered Session.
 *
 * @param options.roots - trusted owned roots for the bound project/Session pair,
 *   each `{ kind, path, verify?(canonical, rootPath) }`.
 * @param options.path - one absolute or Session-relative path named by the UI.
 * @param options.maxBytes - trusted byte limit.
 * @returns image metadata and a bounded data URL; the absolute Host path is not returned.
 */
export async function readPreviewFile(options) {
  const input = options || {};
  const limit = Number.isFinite(input.maxBytes) && input.maxBytes > 0 ? Math.floor(input.maxBytes) : 8 * 1024 * 1024;
  const requested = requestedPath(input.path);
  const roots = await canonicalRoots(Array.isArray(input.roots) ? input.roots : []);
  if (roots.length === 0) fail('E_PREVIEW_DENIED', 'No owned preview root is available for this project or Session', 'preview');

  let resolved;
  if (isAbsolute(requested)) {
    resolved = await canonicalFile(requested);
    if (resolved === null) {
      // Do not turn preview into an arbitrary-filesystem existence oracle: a
      // missing path is only "not found" when its nearest existing ancestor
      // belongs to an owned root; everything else is denied like an existing
      // outside file.
      if ((await missingPathInsideOwnedRoot(roots, requested)) === false) {
        fail('E_PREVIEW_DENIED', 'The preview target is outside the files owned by this project or Session', 'preview');
      }
      fail('E_PREVIEW_NOT_FOUND', 'The preview file does not exist', 'preview');
    }
  } else {
    // A relative request may only name a path below an owned Session root; `..`
    // traversal is denied before any stat so escapes cannot probe the filesystem.
    if (requested === '..' || requested.startsWith('../') || requested.startsWith('..\\') || requested.includes('/../') || requested.includes('\\..\\')) {
      fail('E_PREVIEW_DENIED', 'The preview path may not leave the Session root', 'preview');
    }
    const bases = roots.filter((entry) => RELATIVE_ROOT_KINDS.includes(entry.kind));
    if (bases.length === 0) fail('E_PREVIEW_DENIED', 'Relative preview paths need an owned Session root', 'preview');
    for (const base of bases) {
      resolved = await canonicalFile(join(base.root, requested));
      if (resolved !== null) break;
    }
    if (resolved === null || resolved === undefined) fail('E_PREVIEW_NOT_FOUND', 'The preview file does not exist', 'preview');
  }

  const { canonical, info } = resolved;
  if (info.isFile() === false) fail('E_PREVIEW_DENIED', 'The preview target is not a regular file', 'preview');
  const matches = roots.filter((entry) => inside(entry.root, canonical));
  if (matches.length === 0) {
    fail('E_PREVIEW_DENIED', 'The preview target is outside the files owned by this project or Session', 'preview');
  }
  let allowed = false;
  for (const entry of matches) {
    if (entry.verify === null) {
      allowed = true;
      break;
    }
    try {
      if ((await entry.verify(canonical, entry.root)) === true) {
        allowed = true;
        break;
      }
    } catch (_error) {
      // A failed ownership probe never widens access; keep checking the other
      // owned roots, then deny if none authorizes the exact real file.
    }
  }
  if (allowed === false) {
    fail('E_PREVIEW_DENIED', 'The preview target is not owned by this project or Session', 'preview');
  }
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
