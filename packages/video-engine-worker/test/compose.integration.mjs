// P3-012: real worker process tests for the complete-composition publish/read
// path (`project.compose` / `project.source`).
//
// Failure injection uses real filesystem permissions instead of test-only hooks:
// - persist failure: the project directory is chmod'ed read-only, so the atomic
//   temp-file write (and the rollback write) fail;
// - snapshot-proof failure: the private preview root is chmod'ed read-only, so
//   the internal `Previews.create` copy for the new revision fails.
// Both cases assert the last valid composition stays published. Permission
// bits are restored before cleanup.
import test from "node:test";
import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { managed } from "./helpers.mjs";

const TEMPLATE = "product-launch-v1";
const ENTRY = "index.html";

function composition({
  text = "第一版",
  duration = 5,
  width = 1280,
  height = 720,
  body,
  script,
} = {}) {
  const artwork =
    body ??
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="#0b1220"/>
<text id="title" x="120" y="240" fill="#ffffff" font-size="64">${text}</text>
</svg>`;
  const timeline =
    script ??
    `const tl = gsap.timeline({ paused: true });
tl.fromTo("#title", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 1 }, 0);
window.__timelines = { main: tl };
tl.seek(0);`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>P3-012 ${text}</title>
<style>html,body{margin:0;overflow:hidden;background:#0b1220}</style>
<script src="./assets/gsap.min.js"></script>
</head>
<body>
<div id="main" data-composition-id="main" data-width="${width}" data-height="${height}" data-fps="30" data-start="0" data-duration="${duration}">
${artwork}
<script>
${timeline}
</script>
</div>
</body>
</html>
`;
}

async function createProject(c) {
  const response = await c.call("project.create", {
    templateId: TEMPLATE,
    title: "P3-012 compose",
  });
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.result;
}

async function source(c, projectId) {
  const response = await c.call("project.source", { projectId });
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.result;
}

async function inspectRevision(c, projectId) {
  const response = await c.call("inspect", { projectId });
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.result.revision;
}

async function expectError(response, code, stage) {
  assert.equal(
    response.ok,
    false,
    `expected ${code}, got ${JSON.stringify(response)}`,
  );
  assert.equal(response.error.code, code, JSON.stringify(response.error));
  if (stage !== undefined)
    assert.equal(response.error.stage, stage, JSON.stringify(response.error));
  assert.equal(typeof response.error.message, "string");
  assert.ok(
    response.error.message.length > 0 && response.error.message.length <= 256,
    `error message must fit the protocol envelope: ${response.error.message}`,
  );
  return response.error;
}

test("project.compose publishes validated HTML; source, history, unchanged and persistence round-trip", async () => {
  const f = await managed("p3012-compose-happy");
  try {
    const c = f.c;
    const created = await createProject(c);
    const projectId = created.projectId;
    const initial = await source(c, projectId);
    assert.equal(initial.revision, created.revision);
    assert.equal(initial.entry, ENTRY);
    assert.equal(initial.bytes, Buffer.byteLength(initial.html, "utf8"));
    assert.deepEqual(initial.assets, ["assets/gsap.min.js"]);

    const firstHtml = composition({ text: "第一版" });
    const first = await c.call("project.compose", {
      projectId,
      expectedRevision: initial.revision,
      operationId: "compose-first",
      html: firstHtml,
    });
    assert.equal(first.ok, true, JSON.stringify(first));
    const result = first.result;
    assert.deepEqual(Object.keys(result).sort(), [
      "assets",
      "bytes",
      "duration",
      "elements",
      "entry",
      "files",
      "height",
      "preview",
      "projectId",
      "publishedRevision",
      "revision",
      "scenes",
      "unchanged",
      "width",
      "written",
    ]);
    assert.equal(result.projectId, projectId);
    assert.notEqual(result.revision, initial.revision);
    assert.equal(result.publishedRevision, result.revision);
    assert.equal(result.written, true);
    assert.equal(result.unchanged, false);
    assert.deepEqual(result.scenes, []);
    assert.equal(result.entry, ENTRY);
    assert.equal(result.width, 1280);
    assert.equal(result.height, 720);
    assert.equal(result.duration, 5);
    assert.equal(result.bytes, Buffer.byteLength(firstHtml, "utf8"));
    assert.deepEqual(result.assets, ["assets/gsap.min.js"]);
    assert.ok(Array.isArray(result.elements) && result.elements.length <= 40);
    for (const element of result.elements) {
      assert.equal(typeof element.stableId, "string");
      assert.ok(element.stableId.length > 0);
      assert.ok(Array.isArray(element.capabilities));
      for (const capability of element.capabilities)
        assert.ok(["text", "timing", "layout", "style"].includes(capability));
    }
    const entryFile = result.files.find((file) => file.path === ENTRY);
    assert.equal(entryFile.bytes, result.bytes);
    assert.match(entryFile.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(result.preview, {
      mode: "snapshot",
      status: "ready",
      checked: "composition+snapshot",
      revision: result.revision,
    });

    // The published revision is the real current revision and the exact bytes.
    assert.equal(await inspectRevision(c, projectId), result.revision);
    const roundTrip = await source(c, projectId);
    assert.equal(roundTrip.html, firstHtml);
    assert.equal(roundTrip.revision, result.revision);
    assert.equal(roundTrip.bytes, result.bytes);

    // History records the AI publish, not the read.
    const history = await c.call("history", { projectId });
    assert.equal(history.ok, true, JSON.stringify(history));
    const composeEntries = history.result.entries.filter(
      (entry) => entry.kind === "project.compose",
    );
    assert.equal(composeEntries.length, 1);
    assert.equal(composeEntries[0].actor, "ai");
    assert.equal(composeEntries[0].revision, result.revision);
    assert.match(composeEntries[0].summary, /^AI composition \(\d+ bytes, 5s\)$/);

    // Identical bytes: no write, same revision, explicit unchanged result.
    const unchanged = await c.call("project.compose", {
      projectId,
      expectedRevision: result.revision,
      operationId: "compose-unchanged",
      html: firstHtml,
    });
    assert.equal(unchanged.ok, true, JSON.stringify(unchanged));
    assert.equal(unchanged.result.unchanged, true);
    assert.equal(unchanged.result.written, false);
    assert.equal(unchanged.result.revision, result.revision);
    assert.equal(unchanged.result.publishedRevision, result.revision);
    assert.equal((await source(c, projectId)).html, firstHtml);
    const historyAfterUnchanged = await c.call("history", { projectId });
    assert.equal(
      historyAfterUnchanged.result.entries.length,
      history.result.entries.length,
      "unchanged submit must not append history",
    );

    // operationId idempotency: same payload returns the first result; a
    // different payload for the same operationId is refused.
    const replay = await c.call("project.compose", {
      projectId,
      expectedRevision: initial.revision,
      operationId: "compose-first",
      html: firstHtml,
    });
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.deepEqual(replay.result, result);
    const reused = await c.call("project.compose", {
      projectId,
      expectedRevision: result.revision,
      operationId: "compose-first",
      html: composition({ text: "reused" }),
    });
    await expectError(reused, "E_OPERATION_REUSED");

    // A structurally different second version (new size/duration/artwork) goes
    // through the exact same path and keeps everything else.
    const secondHtml = composition({
      text: "第二版：完全不同的构图",
      width: 1920,
      height: 1080,
      duration: 8,
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
<defs><linearGradient id="bg" x1="0" x2="1"><stop offset="0" stop-color="#312e81"/><stop offset="1" stop-color="#be123c"/></linearGradient></defs>
<rect width="1920" height="1080" fill="url(#bg)"/>
<circle id="orbit" cx="960" cy="540" r="180" fill="#f8fafc"/>
</svg>`,
      script: `const tl = gsap.timeline({ paused: true });
tl.to("#orbit", { scale: 1.2, duration: 2 }, 0);
window["__timelines"] = { main: tl };
tl.seek(0);`,
    });
    const second = await c.call("project.compose", {
      projectId,
      expectedRevision: result.revision,
      operationId: "compose-second",
      html: secondHtml,
    });
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(second.result.width, 1920);
    assert.equal(second.result.height, 1080);
    assert.equal(second.result.duration, 8);
    assert.equal((await source(c, projectId)).html, secondHtml);

    // close/reopen keeps the published revision and exact bytes...
    const closed = await c.call("close", { projectId });
    assert.equal(closed.ok, true, JSON.stringify(closed));
    const reopened = await c.call("open", { projectId });
    assert.equal(reopened.ok, true, JSON.stringify(reopened));
    assert.equal(reopened.result.revision, second.result.revision);
    assert.equal((await source(c, projectId)).html, secondHtml);

    // ...and so does a real worker restart (disk state, not memory).
    await f.restart();
    const afterRestart = await f.c.call("open", { projectId });
    assert.equal(afterRestart.ok, true, JSON.stringify(afterRestart));
    assert.equal(afterRestart.result.revision, second.result.revision);
    const sourceAfterRestart = await source(f.c, projectId);
    assert.equal(sourceAfterRestart.html, secondHtml);
    assert.equal(sourceAfterRestart.revision, second.result.revision);
  } finally {
    await f.cleanup();
  }
});

test("project.compose rejects stale revisions and invalid compositions without touching the entry", async () => {
  const f = await managed("p3012-compose-invalid");
  try {
    const c = f.c;
    const created = await createProject(c);
    const projectId = created.projectId;
    const baseline = await source(c, projectId);
    const current = { revision: baseline.revision, html: baseline.html };
    const assertNoChange = async (label) => {
      assert.equal(
        await inspectRevision(c, projectId),
        current.revision,
        `${label}: revision changed`,
      );
      assert.equal(
        (await source(c, projectId)).html,
        current.html,
        `${label}: entry bytes changed`,
      );
    };

    // A stale expectedRevision is reported before document validation, and no
    // write happens even when the subscription is garbage too.
    const conflict = await c.call("project.compose", {
      projectId,
      expectedRevision: "0".repeat(64),
      operationId: "compose-stale",
      html: "<div>fragment</div>",
    });
    await expectError(conflict, "E_REVISION_CONFLICT", "compose");
    await assertNoChange("stale revision");

    const valid = composition({ text: "基准" });
    const violations = [
      {
        label: "fragment",
        html: "<div>hi</div>",
        message: /complete HTML document/,
      },
      {
        label: "no closing html",
        html: valid.replace("</html>", ""),
        message: /closing <\/html>/,
      },
      {
        label: "no #main",
        html: valid.replace('id="main"', 'id="scene"'),
        message: /exactly one element with id="main"/,
      },
      {
        label: "duplicate #main",
        html: valid.replace("</body>", '<div id="main"></div></body>'),
        message: /exactly one element with id="main"/,
      },
      {
        label: "missing data-composition-id",
        html: valid.replace('data-composition-id="main"', 'data-name="main"'),
        message: /data-composition-id/,
      },
      {
        label: "non-numeric data-width",
        html: valid.replace('data-width="1280"', 'data-width="wide"'),
        message: /data-width/,
      },
      {
        label: "duration out of range",
        html: valid.replace('data-duration="5"', 'data-duration="0"'),
        message: /data-duration/,
      },
      {
        label: "missing __timelines",
        html: valid.replace(
          "window.__timelines = { main: tl };",
          "const unreferenced = true;",
        ),
        message: /window\.__timelines = \{ main: <gsap timeline> \}/,
      },
      {
        label: "external URL",
        html: valid.replace(
          "<body>",
          '<body><img src="https://example.com/a.png" alt="">',
        ),
        message: /external URLs/,
      },
      {
        label: "forbidden iframe",
        html: valid.replace(
          "<body>",
          '<body><iframe src="./index.html"></iframe>',
        ),
        message: /<iframe>/,
      },
      {
        label: "undeclared asset lists declared assets",
        html: valid.replace(
          "<body>",
          '<body><img src="./assets/missing.png" alt="">',
        ),
        message: /assets\/gsap\.min\.js/,
      },
      {
        label: "absolute asset path",
        html: valid.replace(
          "<body>",
          '<body><img src="/assets/gsap.min.js" alt="">',
        ),
        message: /not a declared project asset/,
      },
      {
        label: "NUL byte",
        html: valid.replace("<body>", "<body>\u0000"),
        message: /NUL/,
      },
      {
        label: "oversize",
        html: valid.replace("</body>", `<!-- ${"x".repeat(48 * 1024)} --></body>`),
        message: /48 KiB/,
      },
    ];
    let sequence = 0;
    for (const violation of violations) {
      sequence += 1;
      const response = await c.call("project.compose", {
        projectId,
        expectedRevision: current.revision,
        operationId: `compose-invalid-${sequence}`,
        html: violation.html,
      });
      await expectError(response, "E_COMPOSE_INVALID", "compose");
      assert.match(
        response.error.message,
        violation.message,
        `${violation.label}: unexpected message ${response.error.message}`,
      );
      await assertNoChange(violation.label);
    }

    // Uppercase doctype and the window["__timelines"] form are both accepted.
    const accepted = composition({
      text: "允许的形式",
      script: 'window["__timelines"] = { main: gsap.timeline({ paused: true }) };',
    }).replace("<!doctype html>", "<!DOCTYPE HTML>");
    const acceptedResponse = await c.call("project.compose", {
      projectId,
      expectedRevision: current.revision,
      operationId: "compose-accepted",
      html: accepted,
    });
    assert.equal(acceptedResponse.ok, true, JSON.stringify(acceptedResponse));
    current.revision = acceptedResponse.result.revision;
    current.html = accepted;

    // Malformed params are E_PARAMS before any project read/write.
    const malformedCompose = [
      { projectId, expectedRevision: current.revision, operationId: "m-missing-html" },
      {
        projectId,
        expectedRevision: current.revision,
        operationId: "m-html-type",
        html: 42,
      },
      {
        projectId,
        expectedRevision: current.revision,
        operationId: "m-extra",
        html: valid,
        extra: true,
      },
      {
        projectId,
        expectedRevision: "not-a-revision",
        operationId: "m-bad-revision",
        html: valid,
      },
      { projectId, expectedRevision: current.revision, html: valid },
      { expectedRevision: current.revision, operationId: "m-no-project", html: valid },
    ];
    for (const params of malformedCompose)
      await expectError(
        await c.call("project.compose", params),
        "E_PARAMS",
      );
    for (const params of [
      {},
      { projectId, extra: true },
      { projectId: 42 },
    ])
      await expectError(await c.call("project.source", params), "E_PARAMS");
    await assertNoChange("malformed params");

    // Closed projects are rejected before validation/read.
    await c.call("close", { projectId });
    await expectError(
      await c.call("project.source", { projectId }),
      "E_PROJECT_NOT_OPEN",
    );
    await expectError(
      await c.call("project.compose", {
        projectId,
        expectedRevision: current.revision,
        operationId: "compose-closed",
        html: valid,
      }),
      "E_PROJECT_NOT_OPEN",
    );
  } finally {
    await f.cleanup();
  }
});

test("project.compose restores the previous composition on persist and snapshot-proof failures", async () => {
  const f = await managed("p3012-compose-rollback");
  try {
    const c = f.c;
    const created = await createProject(c);
    const projectId = created.projectId;
    const projectDir = resolve(f.projectsRoot, projectId);
    const entryPath = resolve(projectDir, ENTRY);
    const initial = await source(c, projectId);

    // Persistence failure: the project directory cannot accept the atomic
    // temp file, so the publish fails and the rollback write fails too. The
    // entry stays byte-identical because rename() never replaced it.
    await chmod(projectDir, 0o555);
    let persistFailure;
    try {
      persistFailure = await c.call("project.compose", {
        projectId,
        expectedRevision: initial.revision,
        operationId: "compose-persist-fail",
        html: composition({ text: "persist" }),
      });
    } finally {
      await chmod(projectDir, 0o755);
    }
    const persistError = await expectError(persistFailure, "E_PERSIST", "persist");
    assert.equal(persistError.uncertain, true);
    const afterPersistFailure = await source(c, projectId);
    assert.equal(afterPersistFailure.revision, initial.revision);
    assert.equal(afterPersistFailure.html, initial.html);
    assert.equal((await readFile(entryPath)).toString(), initial.html);

    // Failures are not cached: the same operationId now succeeds because the
    // directory is writable again.
    const retriedHtml = composition({ text: "persist" });
    const retried = await c.call("project.compose", {
      projectId,
      expectedRevision: initial.revision,
      operationId: "compose-persist-fail",
      html: retriedHtml,
    });
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal((await source(c, projectId)).html, retriedHtml);

    // Snapshot-proof failure: the private preview root cannot be written, so
    // the newly written entry is rolled back to the previous composition.
    const previewsRoot = resolve(f.outputRoot, "previews");
    await chmod(previewsRoot, 0o555);
    let snapshotFailure;
    try {
      snapshotFailure = await c.call("project.compose", {
        projectId,
        expectedRevision: retried.result.revision,
        operationId: "compose-snapshot-fail",
        html: composition({ text: "snapshot" }),
      });
    } finally {
      await chmod(previewsRoot, 0o700);
    }
    const snapshotError = await expectError(
      snapshotFailure,
      "E_PERSIST",
      "persist",
    );
    assert.notEqual(snapshotError.uncertain, true);
    const restored = await source(c, projectId);
    assert.equal(restored.revision, retried.result.revision);
    assert.equal(restored.html, retriedHtml);
    assert.equal((await readFile(entryPath)).toString(), retriedHtml);
    const historyAfterFailures = await c.call("history", { projectId });
    assert.equal(
      historyAfterFailures.result.entries.filter(
        (entry) => entry.kind === "project.compose",
      ).length,
      1,
      "failed publishes must not append history",
    );

    // Failed operation ids stay retryable after the injected fault is cleared.
    const snapshotHtml = composition({ text: "snapshot" });
    const retriedSnapshot = await c.call("project.compose", {
      projectId,
      expectedRevision: retried.result.revision,
      operationId: "compose-snapshot-fail",
      html: snapshotHtml,
    });
    assert.equal(retriedSnapshot.ok, true, JSON.stringify(retriedSnapshot));
    assert.equal((await source(c, projectId)).html, snapshotHtml);
  } finally {
    await f.cleanup();
  }
});

test("project.source enforces the 48 KiB AI edit bound while inspect keeps reading the project", async () => {
  const f = await managed("p3012-compose-limit");
  try {
    const c = f.c;
    const created = await createProject(c);
    const projectId = created.projectId;
    const projectDir = resolve(f.projectsRoot, projectId);
    const entryPath = resolve(projectDir, ENTRY);
    const original = await source(c, projectId);
    const oversized = composition({ text: "oversized" }).replace(
      "</body>",
      `<!-- ${"x".repeat(48 * 1024)} --></body>`,
    );
    // External oversized entry (legacy/out-of-band project state) stays
    // readable by the preview pipeline but not by the Agent path.
    await writeFile(entryPath, oversized);
    const limited = await c.call("project.source", { projectId });
    await expectError(limited, "E_LIMIT", "compose");
    assert.match(limited.error.message, /48 KiB/);
    const inspected = await c.call("inspect", { projectId });
    assert.equal(inspected.ok, true, JSON.stringify(inspected));
    assert.equal((await readFile(entryPath)).toString(), oversized);
    await writeFile(entryPath, original.html);
  } finally {
    await f.cleanup();
  }
});
