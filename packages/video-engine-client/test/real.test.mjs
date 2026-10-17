import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fixture } from "../../video-engine-worker/test/helpers.mjs";
import { WorkerClient } from "../src/index.mjs";

const workerRoot = resolve(import.meta.dirname, "../../video-engine-worker");

function options(registry) {
  return {
    nodeExecutable: process.execPath,
    workerEntry: resolve(workerRoot, "src/worker.mjs"),
    registryPath: registry,
    startupTimeoutMs: 10000,
    requestTimeoutMs: 10000,
    shutdownTimeoutMs: 10000,
    forceKillTimeoutMs: 1000,
    maxPending: 32,
    maxLineBytes: 65536,
    maxStderrBytes: 16384,
  };
}

// A Host is expected to pass the complete child environment it built itself,
// without Electron/IPC/Node injection variables. These variables are enough for
// the worker to find ffmpeg/ffprobe and run Chrome.
function sanitizedEnv() {
  const env = {};
  for (const name of [
    "PATH",
    "HOME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "USER",
    "SHELL",
    "TZ",
  ])
    if (process.env[name] !== undefined) env[name] = process.env[name];
  return env;
}

test("real worker client starts only when asked and completes doctor/open/dispose", async () => {
  const f = await fixture();
  const client = new WorkerClient(options(f.registry));
  try {
    assert.equal(client.debug().state, "new");
    const doctor = await client.start();
    assert.equal(doctor.hyperframes, "0.8.167");
    const opened = await client.open("demo");
    assert.equal(opened.projectId, "demo");
    await client.dispose();
    assert.equal(client.debug().state, "disposed");
    assert.equal(client.debug().pending, 0);
  } finally {
    await client.dispose();
    await f.cleanup();
  }
});

async function waitStatus(client, jobId) {
  for (let i = 0; i < 100; i++) {
    const status = await client.status(jobId);
    if (
      ["succeeded", "failed", "cancelled", "timed_out"].includes(status.state)
    )
      return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("job did not finish");
}

test("real worker client preserves conflicts and manages async jobs without owning content", async () => {
  const sentinel = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
  const f = await fixture();
  const client = new WorkerClient(options(f.registry));
  try {
    await client.start();
    const opened = await client.open("demo");
    const edited = await client.edit({
      projectId: "demo",
      expectedRevision: opened.revision,
      operationId: "client-title",
      ops: [{ type: "text", target: "hf-title", text: "父进程通信" }],
    });
    await assert.rejects(
      client.edit({
        projectId: "demo",
        expectedRevision: opened.revision,
        operationId: "stale-client-title",
        ops: [{ type: "text", target: "hf-title", text: "不能覆盖" }],
      }),
      (error) => error.code === "E_REVISION_CONFLICT",
    );
    const frame = await client.frame({
      projectId: "demo",
      revision: edited.revision,
      time: 2.5,
    });
    const finishedFrame = await waitStatus(client, frame.jobId);
    assert.equal(
      finishedFrame.state,
      "succeeded",
      JSON.stringify(finishedFrame),
    );
    assert.equal(finishedFrame.artifact.metadata.width, 1280);

    const render = await client.render({
      projectId: "demo",
      revision: edited.revision,
    });
    const inspected = await client.inspect("demo");
    assert.equal(inspected.revision, edited.revision);
    assert.equal((await client.cancel(render.jobId)).state, "cancelling");
    assert.equal((await waitStatus(client, render.jobId)).state, "cancelled");
    assert.deepEqual(await client.close("demo"), {
      projectId: "demo",
      closed: true,
    });
    await client.dispose();
    await client.dispose();
    assert.equal(client.debug().pending, 0);
    assert.doesNotThrow(() => process.kill(sentinel.pid, 0));
  } finally {
    await client.dispose();
    await f.cleanup();
    sentinel.kill();
  }
});

test("real worker runs with an explicit sanitized env and cwd", async () => {
  const f = await fixture();
  const client = new WorkerClient({
    ...options(f.registry),
    env: sanitizedEnv(),
    cwd: f.dir,
  });
  try {
    const doctor = await client.start();
    assert.equal(doctor.node, process.version);
    const opened = await client.open("demo");
    assert.equal(opened.projectId, "demo");
    const inspected = await client.inspect("demo");
    assert.equal(inspected.revision, opened.revision);

    const finished = await waitStatus(
      client,
      (
        await client.frame({
          projectId: "demo",
          revision: inspected.revision,
          time: 2.5,
        })
      ).jobId,
    );
    assert.equal(finished.state, "succeeded", JSON.stringify(finished));
    assert.equal(finished.artifact.metadata.width, 1280);

    const render = await client.render({
      projectId: "demo",
      revision: inspected.revision,
    });
    assert.equal((await client.cancel(render.jobId)).state, "cancelling");
    assert.equal((await waitStatus(client, render.jobId)).state, "cancelled");
    await client.dispose();
    assert.equal(client.debug().pending, 0);
  } finally {
    await client.dispose();
    await f.cleanup();
  }
});

// Opt-in evidence for the Desktop primary-runtime Node. The path is only test
// configuration: run with DSH_ENGINE_TEST_NODE=<absolute node executable>.
const desktopRuntimeNode = process.env.DSH_ENGINE_TEST_NODE;
test(
  "real worker controlled chain runs on the configured Desktop runtime Node",
  { skip: !desktopRuntimeNode },
  async () => {
    const f = await fixture();
    const client = new WorkerClient({
      ...options(f.registry),
      nodeExecutable: desktopRuntimeNode,
      env: sanitizedEnv(),
      cwd: f.dir,
    });
    try {
      const doctor = await client.start();
      assert.equal(
        doctor.node,
        execFileSync(desktopRuntimeNode, ["--version"], {
          encoding: "utf8",
        }).trim(),
      );
      const opened = await client.open("demo");
      const inspected = await client.inspect("demo");
      assert.equal(inspected.revision, opened.revision);
      const finished = await waitStatus(
        client,
        (
          await client.frame({
            projectId: "demo",
            revision: inspected.revision,
            time: 2.5,
          })
        ).jobId,
      );
      assert.equal(finished.state, "succeeded", JSON.stringify(finished));
    } finally {
      await client.dispose();
      await f.cleanup();
    }
  },
);
