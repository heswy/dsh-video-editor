#!/usr/bin/env node
/**
 * Real controlled-subprocess integration through the Host business object.
 *
 * This is NOT a DSH activation test: it builds a minimal fake Host context, uses
 * the same VideoBridge/dispatcher and package resolution, and exercises the real
 * staged engine worker/client end to end:
 *   doctor -> open -> inspect -> text+timing edit -> inspect -> frame/status/bytes
 *   -> render/status/succeeded artifact -> second render/cancel -> close -> dispose.
 *
 * It refuses to run until a fixed staging directory (INTEGRITY.json/config.json)
 * prepared by scripts/stage-dev.mjs exists. The staging snapshot must be built
 * from the reviewed P2-003 engine commit; this script never stages on its own.
 *
 * Usage: node scripts/test-host-engine.mjs --staging <dir>
 */

import { spawnSync } from 'node:child_process';
import { access, mkdir, realpath, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { loadStagedHost, sha256 } from './lib/staged-host.mjs';
import { assertRealDataRootUnchanged, disposeIsolatedBase, isolateStagedConfig, prepareIsolatedBase, snapshotRealDataRoot } from './lib/data-root-isolation.mjs';

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);

function usage(message) {
  if (message) console.error(message);
  console.error('usage: node scripts/test-host-engine.mjs --staging <staging directory>');
  process.exit(2);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--staging') {
      args.staging = argv[index + 1];
      index += 1;
    } else usage(`unknown argument ${argv[index]}`);
  }
  if (!args.staging || isAbsolute(args.staging) === false) usage('--staging must be an absolute directory');
  return args;
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function resolveExecutable(command, env) {
  if (isAbsolute(command)) {
    await access(command, constants.X_OK);
    return realpath(command);
  }
  const path = (env && env.PATH) || process.env.PATH || '';
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const directory of path.split(delimiter)) {
    if (directory === '') continue;
    for (const extension of extensions) {
      const candidate = join(directory, command + extension);
      try {
        await access(candidate, constants.X_OK);
        return realpath(candidate);
      } catch (_error) {
        /* continue searching */
      }
    }
  }
  throw new Error(`executable not found: ${command}`);
}

function fakeCtx() {
  const routes = [];
  const tools = [];
  const warnings = [];
  const ctx = {
    logger: {
      warn(...args) {
        warnings.push(args.map((value) => String(value)).join(' ').slice(0, 500));
      },
    },
    subprocess: { resolveExecutable },
    connection: {
      fetch: {
        register(route) {
          routes.push(route);
          return () => {};
        },
      },
    },
    tools: {
      register(definition) {
        tools.push(definition);
        return () => {};
      },
    },
  };
  return { ctx, routes, tools, warnings };
}

async function waitJob(bridge, jobId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await bridge.invoke('status', { jobId });
    if (TERMINAL.has(last.state)) return last;
    await sleep(500);
  }
  throw new Error(`job ${jobId} did not settle within ${timeoutMs}ms; last state ${last && last.state}`);
}

async function writeEvidence(evidenceDirectory, evidence) {
  await mkdir(evidenceDirectory, { recursive: true });
  const file = join(evidenceDirectory, `engine-run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(file, JSON.stringify(evidence, null, 2) + '\n');
  return file;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const staging = resolve(args.staging);
  const evidenceDirectory = join(dirname(staging), 'evidence');
  // R3: execute the staged Host implementation, after reproducing the recorded
  // snapshot digests. The development worktree Host is never imported here.
  const staged = await loadStagedHost(staging);
  // M1+: never let a staged bridge fall back to the real ~/Movies/DSH Video.
  // Pre-M1 staging configs are returned unchanged by isolateStagedConfig.
  const realDataRootBaseline = await snapshotRealDataRoot();
  const isolatedBase = await prepareIsolatedBase('dsh-host-engine-');
  const isolation = isolateStagedConfig(staged.config, { stagingRoot: staging, base: isolatedBase });
  const config = isolation.config;
  const integrity = staged.integrity;
  const worktreeHead = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const worktreeStatus = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout.trim();

  const host = fakeCtx();
  const bridge = new staged.VideoBridge({
    ctx: host.ctx,
    rawConfig: config,
  });
  const evidence = {
    kind: 'host-bridge-real-engine-run',
    startedAt: new Date().toISOString(),
    staging,
    rootCommit: integrity.rootCommit,
    engineCommit: integrity.engineCommit,
    versions: integrity.versions,
    node: integrity.node,
    executedHost: staged.evidence,
    worktree: { head: worktreeHead, dirty: worktreeStatus.length > 0, note: 'recorded only; the run imports the staged Host bytes above' },
    hostWarnings: host.warnings,
    dataRootIsolated: isolation.supported === true,
  };

  try {
    const doctor = await bridge.invoke('doctor', {});
    evidence.doctor = doctor;
    evidence.resolvedEngine = bridge.runtime === null
      ? null
      : { clientVersion: bridge.runtime.clientVersion, workerVersion: bridge.runtime.workerVersion, workerEntry: bridge.runtime.workerEntry };
    assert(doctor && doctor.node, 'doctor did not return a Node version');
    assert(doctor.ffmpeg && doctor.ffmpeg !== 'unavailable', 'ffmpeg is unavailable');
    assert(doctor.browser && doctor.browser !== 'unavailable', 'Chrome is unavailable; stage with --browser (registry.browserPath)');

    const opened = await bridge.invoke('open', { projectId: 'demo' });
    evidence.open = opened;
    const inspected = await bridge.invoke('inspect', { projectId: 'demo' });
    evidence.inspect = inspected;
    const elements = Array.isArray(inspected.elements) ? inspected.elements : [];
    const capabilities = (element) => (Array.isArray(element.capabilities) ? element.capabilities : []);
    // The controlled fixture's explicit title contract. The real fixture has a
    // text-only eyebrow before the title, so never select the two fields with
    // independent first-capability scans. Fall back only to an element that
    // supports both operations.
    const title =
      elements.find((element) => element.stableId === 'hf-title' && capabilities(element).includes('text') && capabilities(element).includes('timing')) ||
      elements.find((element) => capabilities(element).includes('text') && capabilities(element).includes('timing'));
    assert(title !== undefined, 'controlled fixture has no text+timing title target');
    assert(title.stableId !== 'hf-eyebrow', 'controlled fixture title selection picked the eyebrow');
    evidence.editTarget = {
      stableId: title.stableId,
      text: title.text,
      timing: title.timing,
      capabilities: capabilities(title),
    };

    const editedText = typeof title.text === 'string' && title.text.length > 0 ? `${title.text} · Host` : 'Host 编辑';
    const duration = Number(inspected.duration);
    const start = title.timing ? Number(title.timing.start) : 0;
    const oldDuration = title.timing ? Number(title.timing.duration) : duration;
    const nextStart = Number.isFinite(start) ? start : 0;
    const nextDuration = Math.max(1 / 240, Math.min(oldDuration > 0 ? oldDuration : duration, Math.max(1 / 240, duration - nextStart)));
    const edit = await bridge.invoke('edit', {
      projectId: 'demo',
      expectedRevision: inspected.revision,
      operationId: 'host-engine-' + Date.now(),
      ops: [
        { type: 'text', target: title.stableId, text: editedText },
        { type: 'timing', target: title.stableId, start: nextStart, duration: nextDuration },
      ],
    });
    evidence.edit = edit;

    const inspectedAfter = await bridge.invoke('inspect', { projectId: 'demo' });
    evidence.inspectAfter = inspectedAfter;
    assert(inspectedAfter.revision !== inspected.revision, 'edit did not change the revision');
    const editedTarget = (Array.isArray(inspectedAfter.elements) ? inspectedAfter.elements : []).find((element) => element.stableId === title.stableId);
    assert(editedTarget !== undefined, 'edited title target disappeared after inspect');
    assert(editedTarget.text === editedText, 'text edit did not apply to the selected title target');

    const frameJob = await bridge.invoke('frame', {
      projectId: 'demo',
      revision: inspectedAfter.revision,
      time: Math.min(2.5, Math.max(0, Number(inspectedAfter.duration) - 1 / 30)),
    });
    evidence.frameJob = frameJob;
    const frameStatus = await waitJob(bridge, frameJob.jobId, 120000);
    evidence.frameStatus = frameStatus;
    assert(frameStatus.state === 'succeeded', `frame ended ${frameStatus.state}`);
    const frameArtifact = await bridge.readArtifact(frameJob.jobId);
    evidence.frameArtifact = {
      mediaType: frameArtifact.mediaType,
      size: frameArtifact.size,
      hash: frameArtifact.hash,
      sha256: sha256(frameArtifact.bytes),
    };
    assert(frameArtifact.mediaType === 'image/png', 'frame artifact is not PNG');
    assert(frameArtifact.bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'frame PNG signature mismatch');
    assert(sha256(frameArtifact.bytes) === frameStatus.artifact.hash, 'frame hash mismatch');

    const renderJob = await bridge.invoke('render', { projectId: 'demo', revision: inspectedAfter.revision });
    evidence.renderJob = renderJob;
    const renderStatus = await waitJob(bridge, renderJob.jobId, 180000);
    evidence.renderStatus = renderStatus;
    assert(renderStatus.state === 'succeeded', `render ended ${renderStatus.state}`);
    const renderArtifact = await bridge.readArtifact(renderJob.jobId);
    evidence.renderArtifact = {
      mediaType: renderArtifact.mediaType,
      size: renderArtifact.size,
      hash: renderArtifact.hash,
      sha256: sha256(renderArtifact.bytes),
    };
    assert(renderArtifact.mediaType === 'video/mp4', 'render artifact is not MP4');
    assert(renderArtifact.bytes.subarray(4, 8).toString('ascii') === 'ftyp', 'render MP4 signature mismatch');
    assert(sha256(renderArtifact.bytes) === renderStatus.artifact.hash, 'render hash mismatch');

    const cancelJob = await bridge.invoke('render', { projectId: 'demo', revision: inspectedAfter.revision });
    evidence.cancelJob = cancelJob;
    const cancelAck = await bridge.invoke('cancel', { jobId: cancelJob.jobId });
    evidence.cancelAck = cancelAck;
    const cancelStatus = await waitJob(bridge, cancelJob.jobId, 30000);
    evidence.cancelStatus = cancelStatus;
    assert(['cancelled', 'succeeded'].includes(cancelStatus.state), `unexpected cancel terminal state ${cancelStatus.state}`);

    const closed = await bridge.invoke('close', { projectId: 'demo' });
    evidence.close = closed;
    assert(closed && closed.closed === true, 'close did not report closed');
    evidence.ok = true;
  } catch (error) {
    evidence.ok = false;
    evidence.error = {
      code: error && error.code,
      message: error instanceof Error ? error.message : String(error),
      stage: error && error.stage,
      uncertain: error && error.uncertain === true,
      jobUnknown: error && error.jobUnknown === true,
    };
    throw error;
  } finally {
    try {
      await bridge.dispose();
      evidence.disposed = true;
    } catch (error) {
      evidence.disposed = false;
      evidence.disposeError = error instanceof Error ? error.message : String(error);
    }
    try {
      await disposeIsolatedBase(isolatedBase);
      await assertRealDataRootUnchanged(realDataRootBaseline);
    } catch (isolationError) {
      evidence.isolationError = isolationError instanceof Error ? isolationError.message : String(isolationError);
      console.error('data-root isolation check failed: ' + evidence.isolationError);
      process.exitCode = 1;
    }
    evidence.finishedAt = new Date().toISOString();
    evidence.hostWarnings = host.warnings.slice(-20);
    const file = await writeEvidence(evidenceDirectory, evidence);
    console.log(JSON.stringify({ evidence: file, ok: evidence.ok === true, engineCommit: evidence.engineCommit, rootCommit: evidence.rootCommit }, null, 2));
  }
}

main().catch((error) => {
  console.error(`test-host-engine failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
