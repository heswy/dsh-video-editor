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
test("close gates a project lifecycle before draining and permits reopen only after completion", async () => {
  const sentinel = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"]);
  const f = await fixture(),
    c = client(f.registry);
  try {
    const revision = await opened(c);
    const retained = (
      await c.call("frame", { projectId: "demo", revision, time: 2.5 })
    ).result;
    const retainedDone = await waitJob(c, retained.jobId);
    assert.equal(retainedDone.state, "succeeded", JSON.stringify(retainedDone));

    const running = (await c.call("render", { projectId: "demo", revision }))
      .result;
    await waitJob(c, running.jobId, (j) => j.state === "running");

    // The requests are written after close in the same stdin turn. They must
    // see the close gate, rather than relying on a short render timing window.
    const closeOne = c.call("close", { projectId: "demo" });
    const closeTwo = c.call("close", { projectId: "demo" });
    const [lateRender, lateFrame, lateEdit, concurrentOpen] = await Promise.all(
      [
        c.call("render", { projectId: "demo", revision }),
        c.call("frame", { projectId: "demo", revision, time: 2.5 }),
        c.call("edit", {
          projectId: "demo",
          expectedRevision: revision,
          operationId: "after-close",
          ops: [{ type: "text", target: "hf-title", text: "must not save" }],
        }),
        c.call("open", { projectId: "demo" }),
      ],
    );
    for (const response of [lateRender, lateFrame, lateEdit, concurrentOpen]) {
      assert.equal(response.ok, false, JSON.stringify(response));
      assert.equal(response.error.code, "E_PROJECT_CLOSING");
    }

    const [closedOne, closedTwo] = await Promise.all([closeOne, closeTwo]);
    assert.deepEqual(closedOne.result, { projectId: "demo", closed: true });
    assert.deepEqual(closedTwo.result, closedOne.result);
    const stopped = (await c.call("status", { jobId: running.jobId })).result;
    assert.equal(stopped.state, "cancelled", JSON.stringify(stopped));
    assert.equal(stopped.cleaned, true);
    assert.deepEqual(stopped.survivors, []);
    assert.deepEqual((await readdir(f.config.outputRoot)).sort(), [
      retainedDone.artifact.name,
    ]);
    assert.doesNotThrow(() => process.kill(sentinel.pid, 0));

    const reopened = await c.call("open", { projectId: "demo" });
    assert.equal(reopened.ok, true, JSON.stringify(reopened));
    assert.equal(reopened.result.revision, revision);
    const finalClose = await c.call("close", { projectId: "demo" });
    assert.deepEqual(finalClose.result, { projectId: "demo", closed: true });
    await evidence("close-gate", {
      retained: retainedDone,
      stopped,
      closed: closedOne.result,
      reopenRevision: reopened.result.revision,
    });
  } finally {
    await c.stop();
    await f.cleanup();
    sentinel.kill();
  }
});
