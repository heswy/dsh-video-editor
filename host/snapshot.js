import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
/**
 * Host-owned preview snapshot routes (P3-008).
 *
 * The worker creates a private snapshot under `<artifactRoot>/previews/<id>/`
 * and returns only relative paths plus SHA-256/byte metadata. This module
 * validates that manifest once, keeps the entry document on the authenticated
 * Connection Fetch route, publishes the declared subresources (and the fixed
 * runtime) on exact public webserver routes because the sandboxed iframe is an
 * opaque origin that the `/api` admission fence refuses as cross-site, and
 * verifies bytes/hash again on every request. It also injects the fixed runtime
 * into the entry document and applies a strict CSP.
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
/**
 * Retained preview snapshots per project.
 *
 * The client keeps the last READY preview mounted (and playable) while a new
 * revision is fetched/preloaded; replacing the routes at registration time would
 * pull the assets out from under that still-visible frame. Retain the previous
 * snapshots until the client explicitly releases them after a successful switch
 * (or the project closes / the worker TTL expires), bounded to this many so a
 * long session cannot grow the route table without limit.
 */
export const MAX_SNAPSHOTS_PER_PROJECT = 4;
const NONCE = /^[a-f0-9]{32}$/;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MIME = Object.freeze({
  '.mp4':'video/mp4', '.mov':'video/quicktime', '.m4v':'video/mp4', '.webm':'video/webm',
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
  constructor(connection, webServer) {
    this.connection = connection;
    this.webServer = webServer !== undefined && webServer !== null ? webServer : null;
    this.records = new Map();
    this.mediaStreams=new Map();
    this.projectSnapshots = new Map();
    this.disposers = [];
  }

  /**
   * Whether the public webserver route table can carry snapshot subresources.
   *
   * Real DSH authenticates every request under the `/api` Connection fence and
   * refuses `sec-fetch-site: cross-site`. The preview iframe is sandboxed with
   * `allow-scripts` (opaque origin), so its script/img/font subresource requests
   * are cross-site, carry no SameSite=Strict cookie, and receive 403 from that
   * fence even though the entry document itself loads. Exact `webServer` routes
   * are matched before the `/api` prefix, are not subject to the Connection
   * admission fence, and are therefore the supported carrier for the
   * capability-addressed snapshot files: the path contains the random snapshotId,
   * the files are immutable and hash-verified on every request, and the entry
   * document itself stays on the authenticated Connection route.
   */
  get publicFiles() {
    return this.webServer !== null && typeof this.webServer.register === 'function';
  }

  ensureRuntimeRoute() {
    if (this.runtimeInstalled === true) return;
    const headers = {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    };
    if (this.publicFiles) {
      this.runtimeInstalled = true;
      this.disposers.push(
        this.webServer.register({
          kind: 'exact',
          path: RUNTIME_PATH,
          handler: async (request, response) => {
            if (request.method === 'HEAD') {
              response.writeHead(200, headers);
              response.end();
              return;
            }
            response.writeHead(200, headers);
            response.end(CANVAS_RUNTIME_SOURCE);
          },
        })
      );
      return;
    }
    if (this.connection === undefined || this.connection === null || this.connection.fetch === undefined) return;
    this.runtimeInstalled = true;
    this.disposers.push(
      this.connection.fetch.register({
        path: RUNTIME_PATH,
        methods: ['GET', 'HEAD'],
        requestBody: 'buffered',
        fetch: async (request) => {
          if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
          return new Response(CANVAS_RUNTIME_SOURCE, { status: 200, headers });
        },
      })
    );
  }

  /** Whether a route registry is available for the snapshot entry/serve mode. */
  get available() {
    return (this.connection !== undefined && this.connection !== null)
      || (this.webServer !== null && typeof this.webServer.register === 'function');
  }

  routePath(snapshotId, filePath) {
    return `${BASE}/${snapshotId}/${filePath}`;
  }

  /**
   * Validate one worker snapshot and publish exact authenticated routes.
   *
   * Prior snapshots for the same project stay registered (bounded by
   * MAX_SNAPSHOTS_PER_PROJECT) so the client can keep the last ready frame
   * visible until the new runtime is ready; the client releases the old
   * snapshot after a successful switch. The oldest retained snapshot is evicted
   * only when the per-project bound is exceeded.
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
      if (!Number.isSafeInteger(declared.bytes) || declared.bytes < 0 || declared.bytes > (declared.media===true?2*1024*1024*1024:MAX_FILE_BYTES)) throw new Error('invalid snapshot file size');
      if (typeof declared.sha256 !== 'string' || /^[a-f0-9]{64}$/.test(declared.sha256) === false) throw new Error('invalid snapshot file hash');
      const target = resolve(directory, filePath);
      if (inside(directory, target) === false) throw new Error('snapshot file escapes directory');
      const info = await stat(target);
      if (info.isFile() === false) throw new Error('snapshot entry is not a file');
      if(declared.media===true){if(!/^media\/[a-f0-9]{8}\.[a-z0-9]+$/.test(filePath)||info.size!==declared.bytes)throw new Error('invalid snapshot media');}
      else {const bytes=await readFile(target);if(bytes.length!==declared.bytes||sha256(bytes)!==declared.sha256)throw new Error('snapshot file failed verification');total+=bytes.length;}
      files.set(filePath, { absPath: target, bytes: declared.bytes, sha256: declared.sha256, media:declared.media===true,snapshotId:snapshot.snapshotId,mtimeMs:info.mtimeMs,ino:info.ino });
    }
    if (files.has(snapshot.entry) === false) throw new Error('snapshot entry is not in the manifest');
    if (total > 128 * 1024 * 1024) throw new Error('snapshot exceeds preview byte limit');

    const record = {
      projectId,
      snapshotId: snapshot.snapshotId,
      entry: snapshot.entry,
      files,
      revision: snapshot.revision,
      expiresAt: typeof snapshot.expiresAt === 'string' ? snapshot.expiresAt : null,
      disposers: [],
    };
    try {
    for (const [filePath, declared] of files) {
      const route = this.routePath(snapshot.snapshotId, filePath);
      let disposer;
      if (filePath !== record.entry && this.publicFiles) {
        // Subresources must bypass the authenticated /api admission fence: the
        // sandboxed iframe is an opaque origin, so its cross-site script/img/font
        // requests carry no browser cookie. The random snapshotId in the path is
        // the capability; registered paths are immutable, TTL-bounded and
        // re-verified against the manifest on every request.
        disposer = this.webServer.register({
          kind: 'exact',
          path: route,
          handler: (request, response) => this.serveFileHttp(record, filePath, declared, request, response),
        });
      } else if (this.connection !== undefined && this.connection !== null && this.connection.fetch !== undefined) {
        disposer = this.connection.fetch.register({
          path: route,
          methods: ['GET', 'HEAD'],
          requestBody: 'buffered',
          fetch: (request) => this.serveFile(record, filePath, declared, request),
        });
      } else if (this.publicFiles) {
        disposer = this.webServer.register({
          kind: 'exact',
          path: route,
          handler: (request, response) => this.serveFileHttp(record, filePath, declared, request, response),
        });
      } else {
        throw new Error('preview routes are unavailable');
      }
      record.disposers.push(disposer);
    }
    } catch(error){for(const dispose of record.disposers.splice(0).reverse()){try{dispose();}catch{}}throw error;}
    this.records.set(snapshot.snapshotId, record);
    const retained = this.projectSnapshots.get(projectId) || [];
    retained.push(snapshot.snapshotId);
    this.projectSnapshots.set(projectId, retained);
    while (retained.length > MAX_SNAPSHOTS_PER_PROJECT) {
      const oldest = retained.shift();
      if (oldest !== undefined) this.revoke(oldest);
    }
    return {
      snapshotId: snapshot.snapshotId,
      projectId,
      revision: snapshot.revision,
      entry: snapshot.entry,
      expiresAt: record.expiresAt,
      entryUrl: this.routePath(snapshot.snapshotId, snapshot.entry),
      files: snapshot.files.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256,...(file.media?{media:true}:{}) })),
    };
  }

  async serveFile(record, filePath, declared, request) {
    if (Date.now() > Date.parse(record.expiresAt || '') && record.expiresAt !== null) {
      this.revoke(record.snapshotId);
      return new Response('snapshot expired', { status: 404 });
    }
    if(declared.media)return this.serveMedia(declared,filePath,request);
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
    if(filePath.endsWith('.html'))return new Response(request.method==='HEAD'?null:bytes,{headers:{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; script-src 'self' "+inlineScriptHashes(bytes.toString()).join(' ')+"; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",'cache-control':'no-store'}});
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

  /**
   * Node-handler equivalent of `serveFile` for public exact webserver routes.
   *
   * The response headers stay identical to the authenticated Fetch route
   * (no-store, nosniff, referrer-policy, permissive ACAO/CORP for fonts/images
   * loaded from the opaque-origin sandboxed iframe), and the bytes/hash are
   * verified against the registration manifest on every request.
   */
  async serveFileHttp(record, filePath, declared, request, response) {
    if (Date.now() > Date.parse(record.expiresAt || '') && record.expiresAt !== null) {
      this.revoke(record.snapshotId);
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('snapshot expired');
      return;
    }
    if(filePath.endsWith('.html')){const res=await this.serveFile(record,filePath,declared,{method:request.method,headers:new Headers(request.headers)});response.writeHead(res.status,Object.fromEntries(res.headers));response.end(request.method==='HEAD'?undefined:Buffer.from(await res.arrayBuffer()));return;}
    if(declared.media){const res=await this.serveMedia(declared,filePath,{method:request.method,headers:new Headers(request.headers)});response.writeHead(res.status,Object.fromEntries(res.headers));if(res.body){const stream=Readable.fromWeb(res.body);response.on('close',()=>stream.destroy());stream.on('error',()=>response.destroy());stream.pipe(response);}else response.end();return;}
    let bytes;
    try {
      bytes = await readFile(declared.absPath);
    } catch (_error) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('not found');
      return;
    }
    if (bytes.length !== declared.bytes || sha256(bytes) !== declared.sha256) {
      response.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ code: 'E_SNAPSHOT_CORRUPT' }));
      return;
    }
    const headers = {
      'content-type': contentType(filePath),
      'content-length': String(bytes.length),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
    };
    if (request.method === 'HEAD') {
      response.writeHead(200, headers);
      response.end();
      return;
    }
    response.writeHead(200, headers);
    response.end(bytes);
  }

  async serveMedia(declared,filePath,request){
    const info=await stat(declared.absPath).catch(()=>null);if(!info||!info.isFile()||info.size!==declared.bytes||info.mtimeMs!==declared.mtimeMs||info.ino!==declared.ino)return new Response('media unavailable',{status:409});
    let start=0,end=info.size-1,status=200;const range=request.headers.get('range');
    const headers={'content-type':contentType(filePath),'accept-ranges':'bytes','cache-control':'no-store','access-control-allow-origin':'*','cross-origin-resource-policy':'cross-origin','x-content-type-options':'nosniff'};
    if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416,headers:{...headers,'content-range':`bytes */${info.size}`}});if(!m[1])start=Math.max(0,info.size-Number(m[2]));else{start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}if(start>end||start>=info.size||!Number.isSafeInteger(start)||!Number.isSafeInteger(end))return new Response(null,{status:416,headers:{...headers,'content-range':`bytes */${info.size}`}});status=206;headers['content-range']=`bytes ${start}-${end}/${info.size}`;}
    headers['content-length']=String(end-start+1);let body=null;if(request.method!=='HEAD'){const stream=createReadStream(declared.absPath,{start,end});const streams=this.mediaStreams.get(declared.snapshotId)||new Set();this.mediaStreams.set(declared.snapshotId,streams);streams.add(stream);stream.on('close',()=>{streams.delete(stream);if(!streams.size)this.mediaStreams.delete(declared.snapshotId);});body=Readable.toWeb(stream);}return new Response(body,{status,headers});
  }

  serveEntry(record, original, request) {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get('instance') || '';
    const nonce = url.searchParams.get('nonce') || '';
    if (INSTANCE_ID.test(instanceId) === false || NONCE.test(nonce) === false) {
      return new Response('invalid instance parameters', { status: 400 });
    }
    let html = original.toString('utf8');
    // Desktop's dsh-app proxy rejects Origin:null from opaque sandbox media.
    // Reuse our existing TTL-bounded, exact public snapshot capability routes
    // over the trusted loopback server. No cookie or global auth token is exposed.
    let mediaOrigin=null;
    try {
      const origin=new URL(this.webServer?.getOrigin?.());
      if(['http:','https:'].includes(origin.protocol)&&['127.0.0.1','[::1]','localhost'].includes(origin.hostname)&&!origin.username&&!origin.password&&origin.pathname==='/'&&!origin.search&&!origin.hash)mediaOrigin=origin.origin;
    } catch { /* toy/remote servers retain same-origin resources */ }
    if(mediaOrigin){
      html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<(?:video|audio|source)\b[^>]*>/gi,tag=>{
        if(/^<script\b/i.test(tag))return tag;
        return tag.replace(/\bsrc\s*=\s*(["'])([^"']+)\1/i,(attribute,quote,path)=>record.files.get(path)?.media?
          'src='+quote+mediaOrigin+this.routePath(record.snapshotId,path)+quote:attribute);
      });
    }
    const hashes = inlineScriptHashes(html);
    // The browser resolves 'self' against the URL it actually loaded this entry
    // document from (the DSH Web GUI origin), while `request.url` inside the
    // plugin Fetch route carries the DSH bridge's internal sentinel origin
    // (`http://dsh.internal`). Those differ in real DSH, so deriving an explicit
    // script/style/img/font origin from request.url produced a CSP that blocked
    // the declared same-origin assets (gsap.min.js) and the injected runtime.
    // 'self' is evaluated by the browser against the document origin and keeps
    // the same same-origin restriction for both development toy servers and the
    // real DSH route bridge.
    const runtimeUrl = `${RUNTIME_PATH}?v=1&instance=${encodeURIComponent(instanceId)}&nonce=${nonce}`;
    const composed = injectRuntime(html, runtimeUrl);
    const csp = [
      "default-src 'none'",
      `script-src 'self' ${hashes.join(' ')}`.trim(),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'none'",
      "frame-src 'self'",
      "media-src 'self'"+(mediaOrigin?" "+mediaOrigin:""),
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
    for(const stream of this.mediaStreams.get(snapshotId)||[])stream.destroy();
    this.mediaStreams.delete(snapshotId);
    for (const dispose of record.disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch (_error) {
        /* route disposal is best effort; the record is already gone */
      }
    }
    this.records.delete(snapshotId);
    const retained = this.projectSnapshots.get(record.projectId);
    if (retained !== undefined) {
      const index = retained.indexOf(snapshotId);
      if (index >= 0) retained.splice(index, 1);
      if (retained.length === 0) this.projectSnapshots.delete(record.projectId);
    }
    return true;
  }

  revokeProject(projectId) {
    const retained = this.projectSnapshots.get(projectId);
    const ids = retained !== undefined ? [...retained] : [];
    if (ids.length === 0) {
      for (const record of this.records.values()) {
        if (record.projectId === projectId) ids.push(record.snapshotId);
      }
    }
    for (const id of ids) this.revoke(id);
    this.projectSnapshots.delete(projectId);
    return ids;
  }

  dispose() {
    for (const id of [...this.records.keys()]) this.revoke(id);
    this.projectSnapshots.clear();
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
