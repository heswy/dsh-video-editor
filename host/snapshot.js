/**
 * Host-owned preview snapshot routes (P3-008).
 *
 * The worker creates a private snapshot under `<artifactRoot>/previews/<id>/`
 * and returns only relative paths plus SHA-256/byte metadata. This module
 * validates that manifest once, registers one exact authenticated Fetch route
 * per declared file, and verifies bytes/hash again on every request. It also
 * injects the fixed runtime into the entry document and applies a strict CSP.
 *
 * It does not read the projects directory, expose absolute paths, or treat the
 * iframe sandbox as an OS security boundary.
 */

import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, isAbsolute } from 'node:path';
import { CANVAS_RUNTIME_SOURCE } from './canvas-runtime.js';

const BASE = '/api/dsh-video/preview';
const RUNTIME_PATH = '/api/dsh-video/canvas-runtime.js';
const SNAPSHOT_ID = /^[a-f0-9]{32}$/;
const INSTANCE_ID = /^[a-z0-9][a-z0-9-]{7,63}$/;
const NONCE = /^[a-f0-9]{32}$/;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha256Base64 = (bytes) => createHash('sha256').update(bytes).digest('base64');

function inside(root, target) {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && isAbsolute(rel) === false);
}

function contentType(path) {
  return MIME[extname(path).toLowerCase()] || 'application/octet-stream';
}

function inlineScriptHashes(html) {
  const hashes = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    if (/\bsrc\s*=/i.test(match[1])) continue;
    hashes.push(`'sha256-${sha256Base64(Buffer.from(match[2], 'utf8'))}'`);
  }
  return hashes;
}

function injectRuntime(html, runtimeUrl) {
  const tag = `<script src="${runtimeUrl}"></script>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${tag}\n</body>`);
  return `${html}\n${tag}`;
}

/**
 * Snapshot route manager.
 */
export class SnapshotRoutes {
  constructor(connection) {
    this.connection = connection;
    this.records = new Map();
    this.disposers = [];
  }

  ensureRuntimeRoute() {
    if (this.runtimeInstalled === true) return;
    if (this.connection === undefined || this.connection === null || this.connection.fetch === undefined) return;
    this.runtimeInstalled = true;
    this.disposers.push(
      this.connection.fetch.register({
        path: RUNTIME_PATH,
        methods: ['GET', 'HEAD'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const headers = {
            'content-type': 'text/javascript; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          };
          if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
          return new Response(CANVAS_RUNTIME_SOURCE, { status: 200, headers });
        },
      })
    );
  }

  /** Whether the connection route registry is available. */
  get available() {
    return this.connection !== undefined && this.connection !== null;
  }

  routePath(snapshotId, filePath) {
    return `${BASE}/${snapshotId}/${filePath}`;
  }

  /**
   * Validate one worker snapshot and publish exact authenticated routes.
   * Replaces any prior snapshot routes for the same project.
   */
  async register(projectId, snapshot, previewRoot) {
    if (!this.available) throw new Error('preview routes are unavailable');
    this.ensureRuntimeRoute();
    if (snapshot === null || typeof snapshot !== 'object') throw new Error('invalid snapshot');
    if (typeof snapshot.snapshotId !== 'string' || SNAPSHOT_ID.test(snapshot.snapshotId) === false) {
      throw new Error('invalid snapshotId');
    }
    if (snapshot.projectId !== undefined && snapshot.projectId !== projectId) {
      throw new Error('snapshot project does not match');
    }
    if (typeof snapshot.entry !== 'string' || snapshot.entry.length === 0) throw new Error('invalid snapshot entry');
    if (Array.isArray(snapshot.files) === false || snapshot.files.length === 0) throw new Error('invalid snapshot files');
    if (typeof previewRoot !== 'string' || isAbsolute(previewRoot) === false) throw new Error('invalid preview root');
    const root = await realpath(previewRoot);
    const directory = resolve(root, snapshot.snapshotId);
    if (inside(root, directory) === false) throw new Error('snapshot directory escapes preview root');
    const files = new Map();
    let total = 0;
    for (const declared of snapshot.files) {
      if (declared === null || typeof declared !== 'object') throw new Error('invalid snapshot file');
      const filePath = declared.path;
      if (typeof filePath !== 'string' || filePath.length === 0 || filePath.startsWith('/') || filePath.includes('..') || filePath.includes('\\') || filePath.includes('\0')) {
        throw new Error('invalid snapshot file path');
      }
      if (!Number.isSafeInteger(declared.bytes) || declared.bytes < 0 || declared.bytes > MAX_FILE_BYTES) throw new Error('invalid snapshot file size');
      if (typeof declared.sha256 !== 'string' || /^[a-f0-9]{64}$/.test(declared.sha256) === false) throw new Error('invalid snapshot file hash');
      const target = resolve(directory, filePath);
      if (inside(directory, target) === false) throw new Error('snapshot file escapes directory');
      const info = await stat(target);
      if (info.isFile() === false) throw new Error('snapshot entry is not a file');
      const bytes = await readFile(target);
      if (bytes.length !== declared.bytes || sha256(bytes) !== declared.sha256) throw new Error('snapshot file failed verification');
      total += bytes.length;
      files.set(filePath, { absPath: target, bytes: declared.bytes, sha256: declared.sha256 });
    }
    if (files.has(snapshot.entry) === false) throw new Error('snapshot entry is not in the manifest');
    if (total > 128 * 1024 * 1024) throw new Error('snapshot exceeds preview byte limit');

    this.revokeProject(projectId);
    const record = {
      projectId,
      snapshotId: snapshot.snapshotId,
      entry: snapshot.entry,
      files,
      revision: snapshot.revision,
      expiresAt: typeof snapshot.expiresAt === 'string' ? snapshot.expiresAt : null,
      disposers: [],
    };
    for (const [filePath, declared] of files) {
      const route = this.routePath(snapshot.snapshotId, filePath);
      const disposer = this.connection.fetch.register({
        path: route,
        methods: ['GET', 'HEAD'],
        requestBody: 'buffered',
        fetch: (request) => this.serveFile(record, filePath, declared, request),
      });
      record.disposers.push(disposer);
    }
    this.records.set(snapshot.snapshotId, record);
    return {
      snapshotId: snapshot.snapshotId,
      projectId,
      revision: snapshot.revision,
      entry: snapshot.entry,
      expiresAt: record.expiresAt,
      entryUrl: this.routePath(snapshot.snapshotId, snapshot.entry),
      files: snapshot.files.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })),
    };
  }

  async serveFile(record, filePath, declared, request) {
    if (Date.now() > Date.parse(record.expiresAt || '') && record.expiresAt !== null) {
      this.revoke(record.snapshotId);
      return new Response('snapshot expired', { status: 404 });
    }
    let bytes;
    try {
      bytes = await readFile(declared.absPath);
    } catch (_error) {
      return new Response('not found', { status: 404 });
    }
    if (bytes.length !== declared.bytes || sha256(bytes) !== declared.sha256) {
      return new Response(JSON.stringify({ code: 'E_SNAPSHOT_CORRUPT' }), {
        status: 409,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    if (filePath === record.entry) return this.serveEntry(record, bytes, request);
    const headers = {
      'content-type': contentType(filePath),
      'content-length': String(bytes.length),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
    };
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(bytes, { status: 200, headers });
  }

  serveEntry(record, original, request) {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instance') || '';
    const nonce = url.searchParams.get('nonce') || '';
    if (INSTANCE_ID.test(instanceId) === false || NONCE.test(nonce) === false) {
      return new Response('invalid instance parameters', { status: 400 });
    }
    const html = original.toString('utf8');
    const hashes = inlineScriptHashes(html);
    const origin = url.origin;
    const runtimeUrl = `${RUNTIME_PATH}?v=1&instance=${encodeURIComponent(instanceId)}&nonce=${nonce}`;
    const composed = injectRuntime(html, runtimeUrl);
    const csp = [
      "default-src 'none'",
      `script-src ${origin} ${hashes.join(' ')}`.trim(),
      `style-src ${origin} 'unsafe-inline'`,
      `img-src ${origin} data:`,
      `font-src ${origin}`,
      "connect-src 'none'",
      "frame-src 'none'",
      "media-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'self'",
    ].join('; ');
    const headers = {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': csp,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    };
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(composed, { status: 200, headers });
  }

  revoke(snapshotId) {
    const record = this.records.get(snapshotId);
    if (record === undefined) return false;
    for (const dispose of record.disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch (_error) {
        /* route disposal is best effort; the record is already gone */
      }
    }
    this.records.delete(snapshotId);
    return true;
  }

  revokeProject(projectId) {
    const ids = [...this.records.values()].filter((record) => record.projectId === projectId).map((record) => record.snapshotId);
    for (const id of ids) this.revoke(id);
    return ids;
  }

  dispose() {
    for (const id of [...this.records.keys()]) this.revoke(id);
    for (const dispose of this.disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch (_error) {
        /* plugin teardown must continue */
      }
    }
  }
}

export const SNAPSHOT_ROUTE_BASE = BASE;
export const CANVAS_RUNTIME_ROUTE = RUNTIME_PATH;
