// Dev-only toy Host for the P3-005-B canvas spike. It is deliberately NOT a
// production server: it serves one registered preview snapshot at a time, only
// from the worker-declared manifest (exact relative paths), and composes the
// sandbox document from verified snapshot bytes plus a fixed runtime script.
//
// Product-relevant behavior demonstrated here:
// - snapshot→project/revision registry; unknown/revoked snapshot IDs are 404;
// - per-file byte/sha256 verification before serving; tampering is 409;
// - path allow-list from the worker manifest (no arbitrary paths/URLs);
// - HTTP CSP with inline-script hashes, `connect-src 'none'`, opaque sandbox;
// - the only mutation of the entry document is appending the Host-owned runtime
//   script tag (original bytes are hash-verified and reported).
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const PUBLIC_FILES = new Set(["index.html", "canvas.js", "contract.js", "styles.css"]);
const INSTANCE_ID = /^[a-z0-9][a-z0-9-]{7,63}$/;
const NONCE = /^[a-f0-9]{32}$/;
const MAX_PREVIEW_BYTES = 128 * 1024 * 1024;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256Base64 = (bytes) => createHash("sha256").update(bytes).digest("base64");

function contentType(path) {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function inlineScriptHashes(html) {
  const hashes = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    if (/\bsrc\s*=/i.test(match[1])) continue;
    hashes.push(`'sha256-${sha256Base64(Buffer.from(match[2], "utf8"))}'`);
  }
  return hashes;
}

function injectRuntime(html, runtimeUrl) {
  const tag = `<script src="${runtimeUrl}"></script>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${tag}\n</body>`);
  return html + "\n" + tag;
}

export class CanvasHostServer {
  constructor({ publicDir, runtimePath }) {
    this.publicDir = resolve(publicDir);
    this.runtimePath = resolve(runtimePath);
    this.server = null;
    this.port = 0;
    this.origin = null;
    this.session = null;
    this.snapshots = new Map();
    this.requests = [];
    this.events = [];
    this.sessionUpdates = 0;
  }
  log(entry) {
    this.requests.push({ at: Date.now(), ...entry });
    if (this.requests.length > 2000) this.requests.shift();
  }
  event(value) {
    this.events.push({ at: Date.now(), ...value });
  }
  /**
   * Register the current snapshot. Reads every declared file from the worker
   * private preview directory and verifies bytes/sha256 against the manifest
   * before the Host will serve anything.
   */
  async registerSnapshot({ project, snapshot, previewRoot }) {
    if (!snapshot || typeof snapshot.snapshotId !== "string")
      throw new TypeError("snapshot manifest is required");
    if (typeof previewRoot !== "string")
      throw new TypeError("previewRoot is required");
    const dir = resolve(previewRoot, snapshot.snapshotId);
    if (!dir.startsWith(resolve(previewRoot) + "/"))
      throw new Error("snapshot directory escapes previewRoot");
    const files = new Map();
    let total = 0;
    for (const declared of snapshot.files) {
      const target = resolve(dir, declared.path);
      if (!target.startsWith(dir + "/")) throw new Error("snapshot file escapes snapshot dir");
      const info = await stat(target);
      if (!info.isFile()) throw new Error("snapshot entry is not a file");
      const bytes = await readFile(target);
      if (bytes.length !== declared.bytes || sha256(bytes) !== declared.sha256)
        throw new Error(`snapshot file failed verification: ${declared.path}`);
      total += bytes.length;
      files.set(declared.path, {
        absPath: target,
        bytes: declared.bytes,
        sha256: declared.sha256,
      });
    }
    if (total > MAX_PREVIEW_BYTES) throw new Error("snapshot exceeds preview byte limit");
    if (!files.has(snapshot.entry)) throw new Error("snapshot entry is not in the manifest");
    const registered = {
      snapshotId: snapshot.snapshotId,
      entry: snapshot.entry,
      files,
      expiresAt: snapshot.expiresAt,
      projectId: project.projectId,
      revision: project.revision,
    };
    this.snapshots.clear();
    this.snapshots.set(snapshot.snapshotId, registered);
    this.session = {
      project,
      snapshot: {
        snapshotId: snapshot.snapshotId,
        entry: snapshot.entry,
        files: snapshot.files,
        expiresAt: snapshot.expiresAt,
      },
      registered,
    };
    this.sessionUpdates += 1;
    this.event({
      kind: "snapshot-registered",
      snapshotId: snapshot.snapshotId,
      revision: project.revision,
      fileCount: snapshot.files.length,
      totalBytes: total,
    });
    return this.session;
  }
  sessionView() {
    if (!this.session) return null;
    const { project, snapshot } = this.session;
    return {
      v: 1,
      projectId: project.projectId,
      revision: project.revision,
      width: project.width,
      height: project.height,
      duration: project.duration,
      snapshot: { ...snapshot },
      entryUrl: `/preview/${snapshot.snapshotId}/${snapshot.entry}`,
    };
  }
  revokeSnapshot(snapshotId) {
    const existed = this.snapshots.delete(snapshotId);
    if (existed) {
      if (this.session?.snapshot?.snapshotId === snapshotId) this.session = null;
      this.event({ kind: "snapshot-revoked", snapshotId });
    }
    return existed;
  }
  revokeAll() {
    const ids = [...this.snapshots.keys()];
    for (const id of ids) this.revokeSnapshot(id);
    return ids;
  }
  async handleSnapshotFile(response, url, snapshotId) {
    const registered = this.snapshots.get(snapshotId);
    if (!registered) {
      this.log({ path: url.pathname, status: 404, category: "revoked-or-unknown" });
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("snapshot is not registered");
      return;
    }
    let relative;
    try {
      relative = decodeURIComponent(url.pathname.slice(`/preview/${snapshotId}/`.length));
    } catch {
      this.log({ path: url.pathname, status: 400, category: "bad-url" });
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("bad path");
      return;
    }
    if (
      !relative ||
      relative.includes("..") ||
      relative.includes("\\") ||
      relative.includes("\0") ||
      relative.startsWith("/")
    ) {
      this.log({ path: url.pathname, status: 404, category: "not-in-manifest" });
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    const declaredFile = registered.files.get(relative);
    if (!declaredFile) {
      this.log({ path: url.pathname, status: 404, category: "not-in-manifest" });
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    // Read from disk and re-verify on every request so a tampered snapshot is
    // never served (the manifest hash is the authority, not "file exists").
    let bytes;
    try {
      bytes = await readFile(declaredFile.absPath);
    } catch {
      this.log({ path: url.pathname, status: 404, category: "file-missing" });
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    if (bytes.length !== declaredFile.bytes || sha256(bytes) !== declaredFile.sha256) {
      this.log({ path: url.pathname, status: 409, category: "hash-mismatch" });
      response.writeHead(409, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ code: "E_SNAPSHOT_CORRUPT" }));
      return;
    }
    if (relative === registered.entry) {
      this.handleEntry(response, url, registered, bytes);
      return;
    }
    this.log({ path: url.pathname, status: 200, category: "snapshot-asset" });
    response.writeHead(200, {
      "content-type": contentType(relative),
      "content-length": bytes.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "access-control-allow-origin": "*",
      "cross-origin-resource-policy": "cross-origin",
      "referrer-policy": "no-referrer",
    });
    response.end(bytes);
  }
  handleEntry(response, url, registered, original) {
    const instanceId = url.searchParams.get("instance") ?? "";
    const nonce = url.searchParams.get("nonce") ?? "";
    if (!INSTANCE_ID.test(instanceId) || !NONCE.test(nonce)) {
      this.log({ path: url.pathname, status: 400, category: "bad-instance-params" });
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("invalid instance parameters");
      return;
    }
    const html = original.toString("utf8");
    const hashes = inlineScriptHashes(html);
    const runtimeUrl = `/runtime.js?v=1&instance=${instanceId}&nonce=${nonce}`;
    const composed = injectRuntime(html, runtimeUrl);
    const hostSource = this.origin;
    const csp = [
      "default-src 'none'",
      `script-src ${hostSource} ${hashes.join(" ")}`.trim(),
      `style-src ${hostSource} 'unsafe-inline'`,
      `img-src ${hostSource} data:`,
      "font-src 'none'",
      "connect-src 'none'",
      "frame-src 'none'",
      "media-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'self'",
    ].join("; ");
    this.log({
      path: url.pathname,
      status: 200,
      category: "snapshot-entry",
      entrySha256: sha256(original),
      composedSha256: sha256(Buffer.from(composed, "utf8")),
      inlineScriptHashes: hashes.length,
      injected: composed.length - original.length,
    });
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": csp,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    response.end(composed);
  }
  async handle(request, response) {
    if (request.method !== "GET") {
      this.log({ path: request.url, status: 405, category: "method" });
      response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      response.end("method not allowed");
      return;
    }
    let url;
    try {
      url = new URL(request.url, `http://127.0.0.1:${this.port}`);
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    const pathname = url.pathname;
    if (pathname === "/" || pathname === "/index.html") {
      const bytes = await readFile(join(this.publicDir, "index.html"));
      this.log({ path: pathname, status: 200, category: "host-page" });
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(bytes);
      return;
    }
    if (pathname === "/favicon.ico") {
      this.log({ path: pathname, status: 204, category: "favicon" });
      response.writeHead(204, { "cache-control": "no-store" });
      response.end();
      return;
    }
    if (pathname === "/session") {
      const view = this.sessionView();
      this.log({ path: pathname, status: view ? 200 : 404, category: "session" });
      response.writeHead(view ? 200 : 404, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(JSON.stringify(view ?? { code: "E_NO_SESSION" }));
      return;
    }
    if (pathname === "/runtime.js") {
      const bytes = await readFile(this.runtimePath);
      this.log({ path: pathname, status: 200, category: "runtime" });
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "content-length": bytes.length,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "access-control-allow-origin": "*",
        "cross-origin-resource-policy": "cross-origin",
      });
      response.end(bytes);
      return;
    }
    const publicName = pathname.slice(1);
    if (PUBLIC_FILES.has(publicName) && publicName !== "index.html") {
      const bytes = await readFile(join(this.publicDir, publicName));
      this.log({ path: pathname, status: 200, category: "host-asset" });
      response.writeHead(200, {
        "content-type": contentType(publicName),
        "content-length": bytes.length,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      response.end(bytes);
      return;
    }
    if (pathname.startsWith("/preview/")) {
      const rest = pathname.slice("/preview/".length);
      const slash = rest.indexOf("/");
      if (slash < 1) {
        response.writeHead(404);
        response.end();
        return;
      }
      await this.handleSnapshotFile(response, url, rest.slice(0, slash));
      return;
    }
    this.log({ path: pathname, status: 404, category: "unknown-route" });
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  }
  async start() {
    this.server = createServer((request, response) => {
      this.handle(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });
    await new Promise((resolveListen, rejectListen) => {
      this.server.once("error", rejectListen);
      this.server.listen(0, "127.0.0.1", resolveListen);
    });
    this.port = this.server.address().port;
    this.origin = `http://127.0.0.1:${this.port}`;
    return { url: `${this.origin}/`, port: this.port, origin: this.origin };
  }
  async close() {
    if (!this.server) return;
    await new Promise((resolveClose) => this.server.close(() => resolveClose()));
    this.server = null;
  }
}

export { inlineScriptHashes, injectRuntime };
