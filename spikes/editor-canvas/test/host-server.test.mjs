import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CanvasHostServer,
  inlineScriptHashes,
  injectRuntime,
} from "../scripts/lib/host-server.mjs";

const SPIKE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = resolve(SPIKE_ROOT, "public");
const RUNTIME_PATH = resolve(PUBLIC_DIR, "preview-runtime.js");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const SNAPSHOT_ID = "b".repeat(32);
const INSTANCE = "inst-test-1234";
const NONCE = "a".repeat(32);

const ENTRY = `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0}</style>
<script src="./assets/gsap.min.js"></script></head>
<body><div id="main" data-composition-id="main" data-width="1280" data-height="720"><h1 data-hf-id="scene-1-title">标题</h1></div>
<script>const tl = { paused: true }; window.__timelines = { main: tl };</script></body></html>`;

async function fixture() {
  const dir = await mkdtemp(resolve(tmpdir(), "p3005b-host-"));
  const previews = resolve(dir, "previews");
  const snapshotDir = resolve(previews, SNAPSHOT_ID);
  await mkdir(resolve(snapshotDir, "assets"), { recursive: true });
  await writeFile(resolve(snapshotDir, "index.html"), ENTRY);
  await writeFile(resolve(snapshotDir, "assets/gsap.min.js"), "window.gsap = { timeline: () => ({}) };\n");
  const files = [
    {
      path: "index.html",
      bytes: Buffer.byteLength(ENTRY),
      sha256: sha256(Buffer.from(ENTRY)),
    },
    {
      path: "assets/gsap.min.js",
      bytes: null,
      sha256: null,
    },
  ];
  const gsapBytes = await readFile(resolve(snapshotDir, "assets/gsap.min.js"));
  files[1].bytes = gsapBytes.length;
  files[1].sha256 = sha256(gsapBytes);
  const project = {
    projectId: "proj-test",
    revision: "c".repeat(64),
    width: 1280,
    height: 720,
    duration: 5,
  };
  const snapshot = {
    snapshotId: SNAPSHOT_ID,
    entry: "index.html",
    files,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
  const server = new CanvasHostServer({ publicDir: PUBLIC_DIR, runtimePath: RUNTIME_PATH });
  const started = await server.start();
  return {
    dir,
    previews,
    snapshotDir,
    project,
    snapshot,
    server,
    origin: started.origin,
    async register() {
      return server.registerSnapshot({ project, snapshot, previewRoot: previews });
    },
    async cleanup() {
      await server.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("host verifies snapshot bytes at registration and serves only manifest paths", async () => {
  const f = await fixture();
  try {
    const session = await f.register();
    assert.equal(session.snapshot.snapshotId, SNAPSHOT_ID);

    const page = await fetch(`${f.origin}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /frame-src 'self'/);
    const html = await page.text();
    assert.match(html, /P3-005-B/);

    const sessionResponse = await fetch(`${f.origin}/session`);
    assert.equal(sessionResponse.status, 200);
    const view = await sessionResponse.json();
    assert.equal(view.projectId, "proj-test");
    assert.equal(view.revision, "c".repeat(64));
    assert.deepEqual(Object.keys(view.snapshot).sort(), [
      "entry",
      "expiresAt",
      "files",
      "snapshotId",
    ]);
    assert.equal(view.entryUrl, `/preview/${SNAPSHOT_ID}/index.html`);
    // No absolute disk path or raw URL in the Host JSON.
    assert.ok(!JSON.stringify(view).includes(f.previews));

    // The entry document is composed from verified snapshot bytes + runtime.
    const entry = await fetch(
      `${f.origin}/preview/${SNAPSHOT_ID}/index.html?instance=${INSTANCE}&nonce=${NONCE}`,
    );
    assert.equal(entry.status, 200);
    const csp = entry.headers.get("content-security-policy");
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /connect-src 'none'/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.equal(inlineScriptHashes(ENTRY).length, 1);
    assert.ok(csp.includes(inlineScriptHashes(ENTRY)[0]));
    const composed = await entry.text();
    assert.ok(composed.includes("标题"));
    assert.ok(
      composed.includes(
        `<script src="/runtime.js?v=1&instance=${INSTANCE}&nonce=${NONCE}"></script>`,
      ),
    );
    const logged = f.server.requests.find((entryLog) => entryLog.category === "snapshot-entry");
    assert.equal(logged.entrySha256, sha256(Buffer.from(ENTRY)));
    assert.equal(logged.inlineScriptHashes, 1);

    // Declared assets are served byte-for-byte.
    const asset = await fetch(`${f.origin}/preview/${SNAPSHOT_ID}/assets/gsap.min.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type"), /javascript/);
    assert.deepEqual(
      Buffer.from(await asset.arrayBuffer()),
      await readFile(resolve(f.snapshotDir, "assets/gsap.min.js")),
    );

    // Unlisted files, unknown snapshots, traversal and missing instance params.
    for (const [url, status] of [
      [`${f.origin}/preview/${SNAPSHOT_ID}/project.json`, 404],
      [`${f.origin}/preview/${"d".repeat(32)}/index.html`, 404],
      [`${f.origin}/preview/${SNAPSHOT_ID}/%2e%2e/%2e%2e/etc/passwd`, 404],
      [`${f.origin}/preview/${SNAPSHOT_ID}/index.html`, 400],
      [`${f.origin}/package.json`, 404],
    ]) {
      const response = await fetch(url);
      assert.equal(response.status, status, url);
      await response.arrayBuffer();
    }

    // Revoking a snapshot makes every route unavailable.
    assert.equal(f.server.revokeSnapshot(SNAPSHOT_ID), true);
    const revoked = await fetch(`${f.origin}/preview/${SNAPSHOT_ID}/index.html?instance=${INSTANCE}&nonce=${NONCE}`);
    assert.equal(revoked.status, 404);
    await revoked.arrayBuffer();
    assert.equal((await fetch(`${f.origin}/session`)).status, 404);
  } finally {
    await f.cleanup();
  }
});

test("host rejects corrupted snapshots at registration and after on-disk tampering", async () => {
  const f = await fixture();
  try {
    await f.register();
    // Tampering after registration is detected on the next request.
    await writeFile(resolve(f.snapshotDir, "assets/gsap.min.js"), "tampered");
    const asset = await fetch(`${f.origin}/preview/${SNAPSHOT_ID}/assets/gsap.min.js`);
    assert.equal(asset.status, 409);
    assert.deepEqual(await asset.json(), { code: "E_SNAPSHOT_CORRUPT" });
    await writeFile(resolve(f.snapshotDir, "index.html"), "tampered entry");
    const entry = await fetch(
      `${f.origin}/preview/${SNAPSHOT_ID}/index.html?instance=${INSTANCE}&nonce=${NONCE}`,
    );
    assert.equal(entry.status, 409);
    await entry.arrayBuffer();

    // A snapshot that is already corrupt cannot be registered at all.
    const broken = JSON.parse(JSON.stringify(f.snapshot));
    broken.snapshotId = "e".repeat(32);
    const brokenDir = resolve(f.previews, broken.snapshotId);
    await mkdir(brokenDir, { recursive: true });
    await writeFile(resolve(brokenDir, "index.html"), "short");
    await assert.rejects(
      f.server.registerSnapshot({ project: f.project, snapshot: broken, previewRoot: f.previews }),
      /failed verification/,
    );
  } finally {
    await f.cleanup();
  }
});

test("runtime injection and inline hash extraction stay byte-explicit", () => {
  const hashes = inlineScriptHashes(ENTRY);
  assert.equal(hashes.length, 1);
  assert.match(hashes[0], /^'sha256-[A-Za-z0-9+/=]+'$/);
  const composed = injectRuntime(ENTRY, "/runtime.js?v=1");
  assert.ok(composed.includes("<script>const tl ="));
  assert.ok(composed.indexOf("/runtime.js") > composed.indexOf("window.__timelines"));
  assert.ok(!inlineScriptHashes(ENTRY).some((hash) => hash === "sha256-empty"));
});
