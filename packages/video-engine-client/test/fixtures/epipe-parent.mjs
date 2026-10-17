import { WorkerClient } from "../../src/index.mjs";

const [workerEntry, registryPath] = process.argv.slice(2);
const client = new WorkerClient({
  nodeExecutable: process.execPath,
  workerEntry,
  registryPath,
  startupTimeoutMs: 500,
  requestTimeoutMs: 500,
  shutdownTimeoutMs: 100,
  forceKillTimeoutMs: 100,
  maxPending: 8,
  maxLineBytes: 1024,
  maxStderrBytes: 128,
});

try {
  await client.start();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const attempts = await Promise.allSettled([
    client.edit({ projectId: "demo", ops: [] }),
    client.frame({ projectId: "demo", timeSeconds: 0 }),
    client.render({ projectId: "demo" }),
  ]);
  const [edit, frame, render] = attempts.map((attempt) => attempt.reason);
  if (
    attempts.some((attempt) => attempt.status !== "rejected") ||
    edit.code !== "E_TRANSPORT" ||
    !edit.uncertain ||
    !frame.jobUnknown ||
    !render.jobUnknown
  )
    throw new Error("pending requests did not receive transport failures");
  await client.dispose();
  const state = client.debug();
  if (state.pending !== 0 || state.state !== "disposed")
    throw new Error(`unexpected client state: ${JSON.stringify(state)}`);
  process.stdout.write(
    JSON.stringify({ caught: attempts.map((attempt) => attempt.reason.code), state }) +
      "\n",
  );
} finally {
  await client.dispose();
}
