/**
 * Host-side streaming media inbox (V1 M2; preserves the legacy image import API).
 *
 * The UI never hands the worker or the Host an arbitrary filesystem path. It
 * uploads bytes to this authenticated exact route; the Host validates size and
 * signature, checks the project id against the bridge's trusted allowlist, writes
 * a uniquely named file under the trusted inbox root, and returns a receipt. The
 * worker's asset.import receives only that inbox basename through the bridge.
 *
 * Lifecycle: install() registers one route; close()/dispose() refuse new uploads,
 * cancel active body readers, and wait for accepted handlers. A receipt file is
 * owned by this instance until the import finishes or the receipt expires or the
 * inbox is disposed; only those instance-owned inbox copies are removed, never a
 * file the worker already copied into a project.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, realpath, unlink, open, statfs } from 'node:fs/promises';
import { basename, extname, isAbsolute, join } from 'node:path';
import { BridgeError } from './errors.js';

const ASSET_UPLOAD_PATH = '/api/dsh-video/asset-upload';
const RECEIPT_TTL_MS = 10 * 60 * 1000;
const MAX_RECEIPTS = 32;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MIME = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
});
const JSON_HEADERS = Object.freeze({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });

function fail(code, message, stage) {
  throw new BridgeError(code, message, { stage: stage || 'asset' });
}

function assetStatus(code) {
  if (code === 'E_PROJECT_NOT_FOUND') return 404;
  if (code === 'E_ASSET_LIMIT') return 413;
  if (code === 'E_ASSET_DISPOSED' || code === 'E_CONFIGURATION') return 503;
  if (code === 'E_ASSET_RECEIPT') return 409;
  return 400;
}

function errorResponse(error) {
  if (error instanceof BridgeError) {
    return new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), {
      status: assetStatus(error.code),
      headers: JSON_HEADERS,
    });
  }
  return new Response(JSON.stringify({ error: { code: 'E_ASSET_UPLOAD', message: 'The upload failed' } }), {
    status: 400,
    headers: JSON_HEADERS,
  });
}

async function unlinkQuietly(target) {
  try {
    await unlink(target);
  } catch (_error) {
    /* cleanup is best effort; the original failure is reported to the caller */
  }
}

async function cancelReader(reader) {
  try {
    await reader.cancel();
  } catch (_error) {
    /* cancellation is best effort after the limit/teardown */
  }
}

function safeSourceName(name) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(name || 'image.png'));
  } catch {
    fail('E_PARAMS', 'Invalid upload filename');
  }
  const base = basename(decoded).slice(0, 120);
  if (!base || /[\x00-\x1f\x7f\\/]/.test(base)) fail('E_PARAMS', 'Invalid upload filename');
  const extension = extname(base).toLowerCase();
  const mediaType = MIME[extension];
  if (mediaType === undefined) fail('E_ASSET_UNSUPPORTED', 'Unsupported media format', 'asset');
  return { sourceName: base, extension, mediaType };
}

function sniff(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

export class AssetInbox {
  constructor(options) {
    const settings = options || {};
    this.connection = settings.connection;
    this.root = settings.root;
    this.maxBytes = Number.isFinite(settings.maxBytes) ? Math.floor(settings.maxBytes) : 2 * 1024 * 1024 * 1024;
    this.minFreeBytes = settings.minFreeBytes === undefined ? 1024 * 1024 * 1024 : settings.minFreeBytes;
    this.maxReceipts =
      Number.isInteger(settings.maxReceipts) && settings.maxReceipts >= 1 && settings.maxReceipts <= 256
        ? settings.maxReceipts
        : MAX_RECEIPTS;
    this.isTrustedProject = typeof settings.isTrustedProject === 'function' ? settings.isTrustedProject : null;
    this.receipts = new Map();
    this.routes = [];
    /** Inbox copies this instance wrote and has not handed off yet. */
    this.ownedFiles = new Set();
    this.activeReaders = new Set();
    this.handlers = new Set();
    this.closing = false;
    this.disposed = false;
    this.disposePromise = null;
    this.sweepTimer = setInterval(() => {
      this.sweep().catch(() => {});
    }, 60000);
    this.sweepTimer.unref?.();
  }

  get available() {
    return typeof this.root === 'string' && isAbsolute(this.root);
  }

  get accepting() {
    return this.closing === false && this.disposed === false;
  }

  requireAccepting() {
    if (this.accepting === false) fail('E_ASSET_DISPOSED', 'The asset inbox is stopping', 'asset');
    return true;
  }

  install() {
    if (this.available === false || this.accepting === false) return;
    if (this.connection === undefined || this.connection === null || this.connection.fetch === undefined) return;
    this.routes.push(
      this.connection.fetch.register({
        path: ASSET_UPLOAD_PATH,
        methods: ['POST'],
        requestBody: 'streaming',
        fetch: (request) => this.handle(request),
      }),
    );
  }

  /** Unregister routes without touching accepted work or owned files. */
  uninstall() {
    for (const dispose of this.routes.splice(0).reverse()) {
      try {
        dispose();
      } catch (_error) {
        /* route teardown continues */
      }
    }
  }

  /** Refuse new uploads and cancel bodies that are still streaming. */
  close() {
    this.closing = true;
    clearInterval(this.sweepTimer);
    for (const reader of this.activeReaders) {
      try {
        const cancellation = reader.cancel();
        if (cancellation !== null && typeof cancellation === 'object' && typeof cancellation.catch === 'function') {
          cancellation.catch(() => {});
        }
      } catch (_error) {
        /* teardown continues */
      }
    }
  }

  /**
   * Remove expired receipts and their instance-owned inbox copies.
   * @returns expired receipt count.
   */
  async sweep() {
    const now = Date.now();
    const expired = [];
    for (const [id, receipt] of this.receipts) {
      if (now - receipt.createdAt > RECEIPT_TTL_MS) {
        this.receipts.delete(id);
        if (receipt.importing) {
          this.receipts.set(id, receipt);
          continue;
        }
        expired.push(receipt);
      }
    }
    for (const receipt of expired) {
      this.ownedFiles.delete(receipt.target);
      await unlinkQuietly(receipt.target);
    }
    return expired.length;
  }

  async readBody(request, limit, target) {
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > limit) fail('E_ASSET_LIMIT', 'Media exceeds the size limit');
    if (!request.body?.getReader) fail('E_PARAMS', 'Upload body is missing');
    const reader = request.body.getReader();
    this.activeReaders.add(reader);
    const abort = () => {
      cancelReader(reader).catch(() => {});
    };
    request.signal?.addEventListener('abort', abort, { once: true });
    let file;
    try {
      file = await open(target, 'wx', 0o600);
    } catch (e) {
      this.activeReaders.delete(reader);
      request.signal?.removeEventListener('abort', abort);
      await cancelReader(reader);
      throw e;
    }
    const hash = createHash('sha256');
    let total = 0;
    let prefix = Buffer.alloc(0);
    try {
      for (;;) {
        this.requireAccepting();
        if (request.signal?.aborted) fail('E_ASSET_UPLOAD', 'Upload cancelled');
        const { done, value } = await reader.read();
        this.requireAccepting();
        if (request.signal?.aborted) fail('E_ASSET_UPLOAD', 'Upload cancelled');
        if (done) break;
        total += value.length;
        if (total > limit) {
          await cancelReader(reader);
          fail('E_ASSET_LIMIT', 'Media exceeds the size limit');
        }
        const bytes = Buffer.from(value);
        hash.update(bytes);
        if (prefix.length < 16) prefix = Buffer.concat([prefix, bytes.subarray(0, 16 - prefix.length)]);
        let offset = 0;
        while (offset < bytes.length) {
          const result = await file.write(bytes, offset, bytes.length - offset);
          offset += result.bytesWritten;
        }
      }
      return { size: total, sha256: hash.digest('hex'), prefix };
    } catch (e) {
      await cancelReader(reader);
      throw e;
    } finally {
      this.activeReaders.delete(reader);
      request.signal?.removeEventListener('abort', abort);
      reader.releaseLock();
      await file.close();
    }
  }

  /** Track one accepted upload so dispose can wait for its bounded outcome. */
  handle(request) {
    if (this.accepting === false) {
      return Promise.resolve(
        errorResponse(new BridgeError('E_ASSET_DISPOSED', 'The asset inbox is stopping', { stage: 'asset' })),
      );
    }
    if (this.handlers.size + this.receipts.size >= this.maxReceipts)
      return Promise.resolve(errorResponse(new BridgeError('E_ASSET_LIMIT', 'Too many pending uploads')));
    const task = this.handleUpload(request);
    this.handlers.add(task);
    const settle = () => this.handlers.delete(task);
    task.then(settle, settle);
    return task;
  }

  async handleUpload(request) {
    let ownedTarget = null;
    try {
      if (this.available === false) fail('E_CONFIGURATION', 'The asset inbox is not configured', 'asset');
      const projectId = request.headers.get('x-dsh-project-id') || '';
      if (PROJECT_ID.test(projectId) === false) fail('E_PARAMS', 'Invalid project id', 'asset');
      if (this.isTrustedProject !== null && this.isTrustedProject(projectId) !== true) {
        fail('E_PROJECT_NOT_FOUND', 'Project is not registered for this Host bridge', 'asset');
      }
      const {
        sourceName,
        extension,
        mediaType: declared,
      } = safeSourceName(request.headers.get('x-dsh-file-name') || '');
      await this.sweep();
      this.requireAccepting();
      if (this.receipts.size >= this.maxReceipts) {
        fail('E_ASSET_LIMIT', 'Too many pending asset uploads; import or let them expire', 'asset');
      }
      let root;
      try {
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        root = await realpath(this.root);
      } catch (_error) {
        fail('E_ASSET_UPLOAD', 'The asset inbox is not available', 'asset');
      }
      this.requireAccepting();
      const capacity = await statfs(root);
      if (
        capacity.bavail * capacity.bsize <
        this.minFreeBytes + Math.max(0, Number(request.headers.get('content-length')) || 0)
      )
        fail('E_ASSET_LIMIT', 'Not enough free space');
      const generated = `upload-${randomUUID()}-${SAFE_NAME.test(sourceName) && !sourceName.includes('..') ? sourceName : 'media' + extension}`;
      const target = join(root, generated);
      this.ownedFiles.add(target);
      ownedTarget = target;
      const uploaded = await this.readBody(request, this.maxBytes, target);
      this.requireAccepting();
      if (!uploaded.size) fail('E_PARAMS', 'Upload body is empty');
      const sniffed = sniff(uploaded.prefix);
      if (declared.startsWith('image/') && sniffed !== declared)
        fail('E_ASSET_UNSUPPORTED', 'Image signature does not match extension');
      const receipt = {
        receiptId: randomUUID(),
        projectId,
        sourceName: basename(target),
        originalName: sourceName,
        extension,
        mediaType: declared,
        size: uploaded.size,
        sha256: uploaded.sha256,
        target,
        createdAt: Date.now(),
      };
      this.receipts.set(receipt.receiptId, receipt);
      ownedTarget = null;
      return new Response(
        JSON.stringify({
          receiptId: receipt.receiptId,
          projectId: receipt.projectId,
          fileName: receipt.originalName,
          mediaType: receipt.mediaType,
          size: receipt.size,
          sha256: receipt.sha256,
          expiresAt: new Date(receipt.createdAt + RECEIPT_TTL_MS).toISOString(),
        }),
        { status: 200, headers: JSON_HEADERS },
      );
    } catch (error) {
      if (ownedTarget !== null) {
        this.ownedFiles.delete(ownedTarget);
        await unlinkQuietly(ownedTarget);
      }
      return errorResponse(error);
    }
  }

  take(projectId, receiptId) {
    this.requireAccepting();
    this.sweep().catch(() => {});
    const receipt = this.receipts.get(receiptId);
    if (receipt === undefined || receipt.projectId !== projectId) {
      fail('E_ASSET_RECEIPT', 'The upload receipt is unknown or expired', 'asset');
    }
    return receipt;
  }

  /** Whether an exact canonical file is a live inbox copy issued to this project. */
  ownsFile(projectId, canonicalPath) {
    if (typeof projectId !== 'string' || typeof canonicalPath !== 'string') return false;
    for (const receipt of this.receipts.values()) {
      if (receipt.projectId === projectId && receipt.target === canonicalPath) return true;
    }
    return false;
  }

  /** The worker already copied the bytes: drop the receipt and its inbox copy only. */
  async finish(receipt) {
    this.receipts.delete(receipt.receiptId);
    this.ownedFiles.delete(receipt.target);
    await unlinkQuietly(receipt.target);
  }

  dispose() {
    if (this.disposePromise !== null) return this.disposePromise;
    this.closing = true;
    this.disposed = true;
    clearInterval(this.sweepTimer);
    const pending = [...this.handlers];
    for (const reader of this.activeReaders) {
      try {
        const cancellation = reader.cancel();
        if (cancellation !== null && typeof cancellation === 'object' && typeof cancellation.catch === 'function') {
          cancellation.catch(() => {});
        }
      } catch (_error) {
        /* teardown continues */
      }
    }
    this.disposePromise = (async () => {
      // The route is gone and late responses are refused; wait for accepted
      // handlers so no write/receipt can appear after dispose resolves.
      await Promise.allSettled(pending);
      const owned = [...this.ownedFiles];
      this.ownedFiles.clear();
      for (const target of owned) await unlinkQuietly(target);
      const receipts = [...this.receipts.values()];
      this.receipts.clear();
      for (const receipt of receipts) await unlinkQuietly(receipt.target);
      for (const dispose of this.routes.splice(0).reverse()) {
        try {
          dispose();
        } catch (_error) {
          /* teardown continues */
        }
      }
    })();
    return this.disposePromise;
  }
}

export const ASSET_UPLOAD_ROUTE = ASSET_UPLOAD_PATH;
