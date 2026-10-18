import { WorkerClient } from "../../src/index.mjs";

const [workerEntry, registryPath] = process.argv.slice(2);
const client = new WorkerClient({
  nodeExecutable: process.execPath,
  workerEntry,
  registryPath,
  startupTimeoutMs: 1500,
  requestTimeoutMs: 1500,
  shutdownTimeoutMs: 1500,
  forceKillTimeoutMs: 100,
  maxPending: 8,
  maxLineBytes: 1024,
  maxStderrBytes: 128,
});
await client.start();
await client.dispose();
