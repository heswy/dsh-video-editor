import test from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  writeFile,
  readdir,
  copyFile,
  mkdir,
} from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { fixture, client, waitJob, base } from "./helpers.mjs";
async function opened(c) {
  const r = await c.call("open", { projectId: "demo" });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result.revision;
}
async function evidence(name, data) {
  await mkdir(resolve(base, "artifacts/evidence"), { recursive: true });
  await writeFile(
    resolve(base, "artifacts/evidence", name + ".json"),
    JSON.stringify(data, null, 2),
  );
}
test("real frame and H264 render bind snapshots, edits stay responsive and artifacts validate", async () => {
  const f = await fixture(),
    c = client(f.registry);
  try {
    const revision = await opened(c);
    const frame = (
      await c.call("frame", { projectId: "demo", revision, time: 2.5 })
    ).result;
    const renderedFrame = await waitJob(c, frame.jobId);
    assert.equal(
      renderedFrame.state,
      "succeeded",
      JSON.stringify(renderedFrame),
    );
    const render = (await c.call("render", { projectId: "demo", revision }))
      .result;
    await waitJob(c, render.jobId, (j) => j.state === "running");
    const edited = await c.call("edit", {
      projectId: "demo",
      expectedRevision: revision,
      operationId: "during-render",
      ops: [{ type: "text", target: "hf-title", text: "快照之后的新标题" }],
    });
    assert.equal(edited.ok, true);
    // Break live source after the immutable snapshot was taken. The old revision must still render.
    await writeFile(
      resolve(f.project, "assets/gsap.min.js"),
      'throw new Error("live source changed")',
    );
    const result = await waitJob(c, render.jobId);
    assert.equal(result.state, "succeeded", JSON.stringify(result));
    assert.equal(result.revision, revision);
    assert.equal(result.artifact.metadata.nb_read_frames, "150");
    assert.equal(result.artifact.metadata.duration, 5);
    assert.ok(c.lines.every((line) => JSON.parse(line).v === 1));
    assert.ok(c.stderr.length <= 16384);
    assert.ok(
      !(await readdir(f.config.outputRoot)).some((x) => x.startsWith(".job-")),
    );
    for (const j of [renderedFrame, result])
      await copyFile(
        resolve(f.config.outputRoot, j.artifact.name),
        resolve(
          base,
          "artifacts",
          j.kind === "render" ? "worker.mp4" : "worker.png",
        ),
      );
    const liveRevision = (await c.call("inspect", { projectId: "demo" })).result
      .revision;
    const preserved = await readFile(
      resolve(f.config.outputRoot, result.artifact.name),
    );
    const cancelled = (
      await c.call("render", { projectId: "demo", revision: liveRevision })
    ).result;
    await c.call("cancel", { jobId: cancelled.jobId });
    assert.equal((await waitJob(c, cancelled.jobId)).state, "cancelled");
    const failed = (
      await c.call("frame", {
        projectId: "demo",
        revision: liveRevision,
        time: 5,
      })
    ).result;
    assert.equal((await waitJob(c, failed.jobId)).state, "failed");
    assert.deepEqual(
      await readFile(resolve(f.config.outputRoot, result.artifact.name)),
      preserved,
    );
    assert.equal((await readdir(f.config.outputRoot)).length, 2);
    await evidence("real-success", {
      doctor: (await c.call("doctor")).result,
      frame: renderedFrame,
      render: result,
      edit: edited.result,
      sourceRevisionAfter: (await c.call("inspect", { projectId: "demo" }))
        .result.revision,
    });
  } finally {
    await c.stop();
    await f.cleanup();
  }
});
test("real rendering cancel, timeout, stdin EOF and shutdown clean owned processes only", async () => {
  const sentinel = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
  try {
    for (const mode of ["cancel", "timeout", "eof", "shutdown", "sigterm"]) {
      const f = await fixture(),
        c = client(f.registry);
      try {
        const revision = await opened(c);
        const job = (
          await c.call("render", {
            projectId: "demo",
            revision,
            timeoutMs: mode === "timeout" ? 2000 : 120000,
          })
        ).result;
        if (mode === "timeout") {
          const done = await waitJob(c, job.jobId);
          assert.equal(done.state, "timed_out");
          await evidence(mode, done);
        } else {
          await waitJob(c, job.jobId, (j) => j.stage === "capture");
          if (mode === "cancel") {
            const started = performance.now();
            const ack = await c.call("cancel", { jobId: job.jobId });
            assert.equal(ack.result.state, "cancelling");
            assert.ok(
              performance.now() - started < 1500,
              "cancel ack must stay responsive",
            );
            const done = await waitJob(c, job.jobId);
            assert.equal(done.state, "cancelled");
            assert.equal(done.cleaned, true);
            assert.deepEqual(done.survivors, []);
            assert.equal(
              (await c.call("cancel", { jobId: job.jobId })).result.state,
              "cancelled",
            );
            await evidence(mode, done);
          } else if (mode === "eof") {
            c.child.stdin.end();
            await c.exited;
          } else if (mode === "sigterm") {
            c.child.kill("SIGTERM");
            await c.exited;
          } else {
            await c.stop();
          }
        }
        assert.doesNotThrow(() => process.kill(sentinel.pid, 0));
        assert.deepEqual(await readdir(f.config.outputRoot), []);
      } finally {
        await c.stop();
        await f.cleanup();
      }
    }
  } finally {
    sentinel.kill();
  }
});
