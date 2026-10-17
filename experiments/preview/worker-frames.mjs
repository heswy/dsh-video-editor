#!/usr/bin/env node
/**
 * Dev-only consistency fixture: ask the existing staged Host/worker for real
 * PNGs at the same times as the isolated iframe screenshots. Does not edit the
 * project and does not add a Host/worker API.
 */
import { createHash } from 'node:crypto';
import { access, mkdir, realpath, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { loadStagedHost, sha256 } from '../../scripts/lib/staged-host.mjs';

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);

function usage(message) {
  if (message) console.error(message);
  console.error('usage: node worker-frames.mjs --staging <clean staging> --out <evidence dir> [--times 0.5,2.5,4.5]');
  process.exit(2);
}
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (['--staging', '--out', '--times'].includes(argv[i])) { args[argv[i].slice(2)] = argv[i + 1]; i += 1; }
    else usage(`unknown ${argv[i]}`);
  }
  if (!args.staging || isAbsolute(args.staging) === false) usage('--staging must be absolute');
  if (!args.out || isAbsolute(args.out) === false) usage('--out must be absolute');
  return args;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function resolveExecutable(command, env) {
  if (isAbsolute(command)) { await access(command, constants.X_OK); return realpath(command); }
  const path = (env && env.PATH) || process.env.PATH || '';
  for (const directory of path.split(delimiter)) {
    if (directory === '') continue;
    try { const candidate = join(directory, command); await access(candidate, constants.X_OK); return realpath(candidate); } catch (_error) {}
  }
  throw new Error(`executable not found: ${command}`);
}
function fakeCtx() {
  return {
    logger: { warn() {} },
    subprocess: { resolveExecutable },
    connection: { fetch: { register() { return () => {}; } } },
    tools: { register() { return () => {}; } },
  };
}
async function waitJob(bridge, jobId) {
  const deadline = Date.now() + 120000;
  let last;
  while (Date.now() < deadline) {
    last = await bridge.invoke('status', { jobId });
    if (TERMINAL.has(last.state)) return last;
    await sleep(400);
  }
  throw new Error(`job ${jobId} did not settle: ${last && last.state}`);
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const staged = await loadStagedHost(args.staging);
  const times = (args.times || '0.5,2.5,4.5').split(',').map(Number);
  await mkdir(args.out, { recursive: true });
  const bridge = new staged.VideoBridge({ ctx: fakeCtx(), rawConfig: staged.config });
  const evidence = { kind: 'p2-005-frame-consistency', staging: args.staging, executedHost: staged.evidence, times, frames: [] };
  try {
    const open = await bridge.invoke('open', { projectId: 'demo' });
    const inspect = await bridge.invoke('inspect', { projectId: 'demo' });
    evidence.open = open;
    evidence.revision = inspect.revision;
    for (const time of times) {
      const startedAt = Date.now();
      const job = await bridge.invoke('frame', { projectId: 'demo', revision: inspect.revision, time });
      const status = await waitJob(bridge, job.jobId);
      if (status.state !== 'succeeded') throw new Error(`frame ${time} ended ${status.state}`);
      const artifact = await bridge.readArtifact(job.jobId);
      const file = join(args.out, `worker-${String(time).replace(/\./g, '_')}.png`);
      await writeFile(file, artifact.bytes);
      evidence.frames.push({ time, elapsedMs: Date.now() - startedAt, file, mediaType: artifact.mediaType, size: artifact.size, sha256: sha256(artifact.bytes), artifactHash: status.artifact.hash, metadata: status.artifact.metadata });
    }
    await bridge.invoke('close', { projectId: 'demo' });
    evidence.ok = true;
  } catch (error) {
    evidence.ok = false;
    evidence.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await bridge.dispose().catch(() => {});
    await writeFile(join(args.out, 'worker-frames.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ ok: evidence.ok === true, revision: evidence.revision, frames: evidence.frames, executedHost: evidence.executedHost.hostModule }, null, 2));
    if (evidence.ok !== true) process.exitCode = 1;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
