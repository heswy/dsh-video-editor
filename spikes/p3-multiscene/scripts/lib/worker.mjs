import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { WorkerClient } from "../../../../packages/video-engine-client/src/index.mjs";
import { sha256, writeJson } from "./util.mjs";

export const workerEntry = resolve(
  import.meta.dirname,
  "../../../../packages/video-engine-worker/src/worker.mjs",
);

// A Host is expected to construct the complete child environment itself. The
// spike intentionally removes Electron/IPC/Node injection variables.
export function sanitizedEnv(tmpDir) {
  const source = process.env;
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
    if (source[name] !== undefined) env[name] = source[name];
  env.TMPDIR = tmpDir;
  return env;
}

export async function prepareRuntime(workDir) {
  const projectsRoot = resolve(workDir, "projects");
  const outputRoot = resolve(workDir, "output");
  const tmp = resolve(workDir, "tmp");
  await mkdir(projectsRoot, { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  await mkdir(tmp, { recursive: true });
  return { workDir, projectsRoot, outputRoot, tmp };
}

export async function writeRegistry(runtime, projects) {
  const registryPath = resolve(runtime.workDir, "registry.json");
  await writeJson(registryPath, {
    root: runtime.projectsRoot,
    projects,
    outputRoot: runtime.outputRoot,
  });
  return registryPath;
}

export function createClient(runtime, registryPath) {
  return new WorkerClient({
    nodeExecutable: process.execPath,
    workerEntry,
    registryPath,
    startupTimeoutMs: 30000,
    requestTimeoutMs: 30000,
    shutdownTimeoutMs: 30000,
    forceKillTimeoutMs: 3000,
    maxPending: 32,
    maxLineBytes: 131072,
    maxStderrBytes: 16384,
    env: sanitizedEnv(runtime.tmp),
    cwd: runtime.workDir,
  });
}

export async function waitStatus(client, jobId, { timeoutMs = 180000 } = {}) {
  const started = performance.now();
  for (;;) {
    const status = await client.status(jobId);
    if (["succeeded", "failed", "cancelled", "timed_out"].includes(status.state))
      return { ...status, elapsedMs: Math.round(performance.now() - started) };
    if (performance.now() - started > timeoutMs)
      throw new Error(`job ${jobId} did not finish within ${timeoutMs}ms`);
    await new Promise((resolveTick) => setTimeout(resolveTick, 100));
  }
}

export async function copyProject(from, to) {
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true });
}

export async function stageRegistryEntry(runtime, registryPath, projectId) {
  // Simulates a Host that creates a project directory while the worker is
  // already running, then rewrites the registry file it owns.
  const projectDir = resolve(runtime.projectsRoot, projectId);
  const registry = JSON.parse(
    await (await import("node:fs/promises")).readFile(registryPath, "utf8"),
  );
  registry.projects[projectId] = projectDir;
  await writeFile(registryPath, JSON.stringify(registry, null, 2) + "\n");
  return projectDir;
}

export function digest(value) {
  return sha256(JSON.stringify(value));
}
