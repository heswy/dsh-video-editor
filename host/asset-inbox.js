/**
 * Host-side asset inbox for controlled PNG/JPEG imports (P3-008).
 *
 * The UI never hands the worker or the Host an arbitrary filesystem path. It
 * uploads bytes to this authenticated exact route; the Host validates size and
 * signature, writes a uniquely named file under the trusted inbox root, and
 * returns a receipt. The worker's asset.import receives only that inbox
 * basename through the bridge. Receipts are in-memory and short-lived.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, realpath, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute } from 'node:path';
import { BridgeError } from './errors.js';

const ASSET_UPLOAD_PATH = '/api/dsh-video/asset-upload';
const RECEIPT_TTL_MS = 10 * 60 * 1000;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const MIME = Object.freeze({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' });

function fail(code, message, stage) {
  throw new BridgeError(code, message, { stage: stage || 'asset' });
}

function safeSourceName(name) {
  const base = basename(String(name || 'image.png')).replace(/\0/g, '').slice(0, 120);
  if (SAFE_NAME.test(base) === false) fail('E_PARAMS', 'Invalid upload filename', 'asset');
  const extension = extname(base).toLowerCase();
  const mediaType = MIME[extension];
  if (mediaType === undefined) fail('E_ASSET_UNSUPPORTED', 'Only PNG and JPEG images are supported', 'asset');
  return { sourceName: base, extension, mediaType };
}

function sniff(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  return null;
}

async function readBody(request, limit) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) fail('E_ASSET_LIMIT', 'Image exceeds the size limit', 'asset');
  if (request.body === null || typeof request.body?.getReader !== 'function') fail('E_PARAMS', 'Upload body is missing', 'asset');
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      try {
        await reader.cancel();
      } catch (_error) {
        /* cancellation is best effort after the limit */
      }
      fail('E_ASSET_LIMIT', 'Image exceeds the size limit', 'asset');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export class AssetInbox {
  constructor(options) {
    const settings = options || {};
    this.connection = settings.connection;
    this.root = settings.root;
    this.maxBytes = Number.isFinite(settings.maxBytes) ? Math.floor(settings.maxBytes) : 8 * 1024 * 1024;
    this.receipts = new Map();
    this.routes = [];
    this.disposed = false;
  }

  get available() {
    return typeof this.root === 'string' && isAbsolute(this.root);
  }

  install() {
    if (this.available === false) return;
    if (this.connection === undefined || this.connection === null || this.connection.fetch === undefined) return;
    this.routes.push(
      this.connection.fetch.register({
        path: ASSET_UPLOAD_PATH,
        methods: ['POST'],
        requestBody: 'streaming',
        fetch: (request) => this.handle(request),
      })
    );
  }

  sweep() {
    const now = Date.now();
    for (const [id, receipt] of this.receipts) {
      if (now - receipt.createdAt > RECEIPT_TTL_MS) this.receipts.delete(id);
    }
  }

  async handle(request) {
    try {
      if (this.available === false) fail('E_CONFIGURATION', 'The asset inbox is not configured', 'asset');
      const projectId = request.headers.get('x-dsh-project-id') || '';
      if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(projectId) === false) fail('E_PARAMS', 'Invalid project id', 'asset');
      const { sourceName, extension, mediaType: declared } = safeSourceName(request.headers.get('x-dsh-file-name') || '');
      const bytes = await readBody(request, this.maxBytes);
      if (bytes.length === 0) fail('E_PARAMS', 'Upload body is empty', 'asset');
      const sniffed = sniff(bytes);
      if (sniffed === null) fail('E_ASSET_UNSUPPORTED', 'The upload is not a PNG or JPEG image', 'asset');
      if (sniffed !== declared) fail('E_ASSET_UNSUPPORTED', 'The image content does not match its extension', 'asset');
      this.sweep();
      const root = await realpath(this.root);
      await mkdir(root, { recursive: true });
      const generated = `upload-${randomUUID()}-${sourceName}`;
      const target = `${root}/${generated}`;
      await writeFile(target, bytes, { mode: 0o600 });
      const receipt = {
        receiptId: randomUUID(),
        projectId,
        sourceName: basename(target),
        originalName: sourceName,
        extension,
        mediaType: sniffed,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        target,
        createdAt: Date.now(),
      };
      this.receipts.set(receipt.receiptId, receipt);
      return Response.json({
        receiptId: receipt.receiptId,
        projectId: receipt.projectId,
        fileName: receipt.originalName,
        mediaType: receipt.mediaType,
        size: receipt.size,
        sha256: receipt.sha256,
        expiresAt: new Date(receipt.createdAt + RECEIPT_TTL_MS).toISOString(),
      });
    } catch (error) {
      if (error instanceof BridgeError) {
        return Response.json({ error: { code: error.code, message: error.message } }, { status: 400 });
      }
      return Response.json({ error: { code: 'E_ASSET_UPLOAD', message: 'The upload failed' } }, { status: 400 });
    }
  }

  take(projectId, receiptId) {
    this.sweep();
    const receipt = this.receipts.get(receiptId);
    if (receipt === undefined || receipt.projectId !== projectId) {
      fail('E_ASSET_RECEIPT', 'The upload receipt is unknown or expired', 'asset');
    }
    return receipt;
  }

  async finish(receipt) {
    this.receipts.delete(receipt.receiptId);
    try {
      await unlink(receipt.target);
    } catch (_error) {
      /* the worker already copied the bytes; inbox cleanup is best effort */
    }
  }

  dispose() {
    this.disposed = true;
    for (const dispose of this.routes.splice(0).reverse()) {
      try {
        dispose();
      } catch (_error) {
        /* teardown continues */
      }
    }
    this.receipts.clear();
  }
}

export const ASSET_UPLOAD_ROUTE = ASSET_UPLOAD_PATH;
