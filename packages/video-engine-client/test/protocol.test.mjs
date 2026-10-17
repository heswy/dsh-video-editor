import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { WorkerClient } from "../src/index.mjs";

const fakeWorker = resolve(import.meta.dirname, "fixtures/protocol-worker.mjs");

async function fake(mode) {
  const dir = await mkdtemp(resolve(tmpdir(), "dsh-engine-client-"));
  const registry = resolve(dir, "registry.json");
  await writeFile(registry, JSON.stringify({ mode }));
  return {
    client: new WorkerClient({
      nodeExecutable: process.execPath,
      workerEntry: fakeWorker,
      registryPath: registry,
      startupTimeoutMs: 200,
      requestTimeoutMs: 200,
      shutdownTimeoutMs: 200,
      forceKillTimeoutMs: 200,
      maxPending: 8,
      maxLineBytes: 1024,
      maxStderrBytes: 128,
    }),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test("malformed worker stdout fails startup as a protocol error", async () => {
  const f = await fake("malformed");
  try {
    await assert.rejects(
      f.client.start(),
      (error) => error.code === "E_PROTOCOL" && error.stage === "protocol",
    );
  } finally {
    await f.client.dispose();
    await f.cleanup();
  }
});

test("client validates framing, response envelopes, limits and late writes", async () => {
  for (const mode of [
    "framing",
    "invalid",
    "oversize",
    "late",
    "exit",
    "stderr",
  ]) {
    const f = await fake(mode);
    try {
      if (["invalid", "oversize"].includes(mode)) {
        await f.client.start();
        await assert.rejects(
          f.client.inspect("demo"),
          (error) =>
            error.code ===
            (mode === "oversize" ? "E_LINE_LIMIT" : "E_PROTOCOL"),
        );
      } else {
        await f.client.start();
        if (mode === "framing") {
          assert.deepEqual(
            await Promise.all([
              f.client.request("first", {}),
              f.client.request("second", {}),
            ]),
            [{ method: "first" }, { method: "second" }],
          );
        } else if (mode === "late") {
          await assert.rejects(
            f.client.edit({ projectId: "demo" }),
            (error) =>
              error.code === "E_REQUEST_TIMEOUT" && error.uncertain === true,
          );
          await new Promise((resolve) => setTimeout(resolve, 350));
          assert.deepEqual(await f.client.inspect("demo"), {
            method: "inspect",
          });
        } else if (mode === "exit") {
          await assert.rejects(
            f.client.inspect("demo"),
            (error) => error.code === "E_PROCESS_EXIT",
          );
          assert.equal(f.client.debug().state, "failed");
        } else {
          assert.deepEqual(await f.client.inspect("demo"), {
            method: "inspect",
          });
          assert.equal(f.client.debug().stderrBytes, 128);
          assert.equal(f.client.debug().stderrTruncated, true);
        }
      }
    } finally {
      await f.client.dispose();
      await f.cleanup();
    }
  }
});

test("dispose bounds an unresponsive worker shutdown and rejects new requests", async () => {
  const f = await fake("stall");
  try {
    await f.client.start();
    const started = performance.now();
    const disposing = f.client.dispose();
    await assert.rejects(
      f.client.inspect("demo"),
      (error) => error.code === "E_CLIENT_STATE",
    );
    await disposing;
    assert.ok(
      performance.now() - started < 550,
      "dispose must force only its own worker promptly",
    );
    assert.equal(f.client.debug().pending, 0);
    assert.equal(f.client.debug().state, "disposed");
  } finally {
    await f.client.dispose();
    await f.cleanup();
  }
});

test("invalid executable returns a structured startup failure", async () => {
  const f = await fake("framing");
  f.client.options.nodeExecutable = "/definitely/not/a/node-executable";
  try {
    await assert.rejects(
      f.client.start(),
      (error) => error.code === "E_STARTUP",
    );
  } finally {
    await f.client.dispose();
    await f.cleanup();
  }
});

test("byte-framed UTF-8 preserves split Chinese and emoji", async () => {
  const f = await fake("unicode");
  try {
    await f.client.start();
    assert.deepEqual(await f.client.inspect("demo"), { text: "你好😀" });
  } finally {
    await f.client.dispose();
    await f.cleanup();
  }
});

test("unanswered edits remain uncertain on exit and protocol failure", async () => {
  for (const mode of ["edit-exit", "edit-bad"]) {
    const f = await fake(mode);
    try {
      await f.client.start();
      await assert.rejects(
        f.client.edit({ projectId: "demo" }),
        (error) =>
          error.uncertain === true &&
          ["E_PROCESS_EXIT", "E_PROTOCOL"].includes(error.code),
      );
      assert.equal(f.client.debug().pending, 0);
    } finally {
      await f.client.dispose();
      await f.cleanup();
    }
  }
});

test("normal dispose lets an isolated parent exit before its shutdown deadline", async () => {
  const f = await fake("framing");
  const parent = resolve(import.meta.dirname, "fixtures/dispose-parent.mjs");
  const started = performance.now();
  try {
    const child = spawn(process.execPath, [
      parent,
      fakeWorker,
      f.client.options.registryPath,
    ]);
    const exited = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("parent did not exit")),
        1000,
      );
      child.once("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    assert.equal(exited, 0);
    assert.ok(
      performance.now() - started < 800,
      "must not retain shutdown timer",
    );
  } finally {
    await f.cleanup();
  }
});
