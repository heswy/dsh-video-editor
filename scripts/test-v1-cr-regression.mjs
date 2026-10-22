import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import {
  fixture,
  client,
} from "../packages/video-engine-worker/test/helpers.mjs";
import { ensureDataRoot, migrateLegacyRoots } from "../host/data-root.js";
let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log("PASS", name);
  } catch (e) {
    failures++;
    console.error("FAIL", name, e);
  }
}
await check(
  "history receipts, redo and deleted unused media remain correct",
  async () => {
    const f = await fixture(),
      c = client(f.registry);
    const call = async (method, p = {}) => {
      const r = await c.call(method, { projectId: "demo", ...p });
      if (!r.ok) throw Object.assign(new Error(r.error.message), r.error);
      return r.result;
    };
    try {
      await call("open");
      const bytes = Buffer.from("unused asset"),
        sha256 = createHash("sha256").update(bytes).digest("hex");
      await mkdir(join(f.project, "media"), { recursive: true });
      const media = join(f.project, `media/${sha256.slice(0, 8)}.png`);
      await writeFile(media, bytes);
      await writeFile(
        join(f.project, "asset-index.json"),
        JSON.stringify({
          version: 1,
          assets: [
            {
              assetId: "as_12345678",
              name: "unused",
              kind: "image",
              sha256,
              ext: "png",
              bytes: bytes.length,
            },
          ],
        }),
      );
      let t = await call("timeline.inspect");
      const clip = t.tracks[0].clips[0].clipId;
      for (let i = 0; i < 52; i++) {
        const r = await call("timeline.apply", {
          expectedRevision: t.revision,
          operationId: `cr-${i}`,
          ops: [
            { op: "clip.set", clipId: clip, patch: { label: `edit ${i}` } },
          ],
        });
        t = await call("timeline.inspect");
        assert.equal(r.undoHint.historyCursor, t.historyCursor);
      }
      await rm(media);
      await writeFile(
        join(f.project, "asset-index.json"),
        JSON.stringify({ version: 1, assets: [] }),
      );
      await call("inspect"); // Deleted unused metadata must not break the film.
      await call("timeline.undo", {
        expectedRevision: t.revision,
        expectedHistoryCursor: t.historyCursor,
        expectedOperationId: "cr-51",
        operationId: "cr-undo",
      });
      t = await call("timeline.inspect");
      const r = await call("timeline.apply", {
        expectedRevision: t.revision,
        operationId: "cr-noop",
        ops: [{ op: "clip.set", clipId: clip, patch: { label: "edit 50" } }],
      });
      assert.equal(r.written, false);
      assert.equal(r.undoHint.canRedo, true);
      await call("timeline.redo", {
        expectedRevision: t.revision,
        operationId: "cr-redo",
      });
    } finally {
      await c.stop();
      await f.cleanup();
    }
  },
);
await check(
  "migration publishes only complete copies and retries safely",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-cr-")),
      legacy = join(root, "legacy"),
      source = join(legacy, "projects/demo");
    let server;
    try {
      await mkdir(source, { recursive: true });
      await mkdir(join(legacy, "managed"));
      await writeFile(join(source, "index.html"), "original");
      await writeFile(join(source, "project.json"), "{}");
      await writeFile(
        join(legacy, "managed/projects.json"),
        JSON.stringify({ projects: { demo: source } }),
      );
      await writeFile(
        join(legacy, "managed/registry.json"),
        JSON.stringify({
          projectsRoot: join(legacy, "projects"),
          registryPath: join(legacy, "managed/projects.json"),
          outputRoot: join(legacy, "output"),
        }),
      );
      const { paths } = await ensureDataRoot(join(root, "stable"));
      const existing = join(paths.projectsRoot, "occupied");
      await mkdir(existing);
      await writeFile(join(existing, "sentinel"), "user content");
      const occupiedSource = join(legacy, "projects/occupied");
      await mkdir(occupiedSource);
      await writeFile(join(occupiedSource, "extra"), "legacy");
      await writeFile(
        join(legacy, "managed/projects.json"),
        JSON.stringify({
          projects: { demo: source, occupied: occupiedSource },
        }),
      );
      server = createServer();
      await new Promise((res, rej) => {
        server.once("error", rej);
        server.listen(join(source, "blocked.sock"), res);
      });
      const run = () =>
        migrateLegacyRoots({
          paths,
          legacyRoots: [{ root: legacy, source: "test" }],
          logger: { warn() {} },
        });
      await run();
      const migration=JSON.parse(await readFile(paths.migrationPath,"utf8"));
      assert.equal(migration.sources[0].completed,false);
      assert(migration.sources[0].errors.some(e=>e.code==="E_PROJECT_TARGET_EXISTS"));
      assert(migration.sources[0].errors.some(e=>e.code==="E_PROJECT_COPY"));
      assert.equal(
        await readFile(join(existing, "sentinel"), "utf8"),
        "user content",
      );
      await assert.rejects(stat(join(existing, "extra")), { code: "ENOENT" });
      const registry = JSON.parse(
        await readFile(paths.projectsRegistryPath, "utf8"),
      );
      assert.equal(registry.projects.occupied, undefined);
      await assert.rejects(stat(join(paths.projectsRoot, "demo")), {
        code: "ENOENT",
      });
      await new Promise((res) => server.close(res));
      server = null;
      await run();
      assert.equal(
        await readFile(join(paths.projectsRoot, "demo/index.html"), "utf8"),
        "original",
      );
    } finally {
      if (server) await new Promise((res) => server.close(res));
      await rm(root, { recursive: true, force: true });
    }
  },
);
if (failures) process.exitCode = 1;
