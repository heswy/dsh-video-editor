import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { VideoBridge } from '../host/bridge.js';
import { WorkerClient } from '../packages/video-engine-client/src/index.mjs';
const root = await mkdtemp(join(tmpdir(), 'm4-host-'));
let bridge;
try {
  const config = {
    workerNode: process.execPath,
    workerEntry: resolve('packages/video-engine-worker/src/worker.mjs'),
    workerCwd: root,
    registryPath: join(root, 'old-registry.json'),
    artifactRoot: join(root, 'old-output'),
    allowedProjects: ['demo'],
    dataRoot: join(root, 'data'),
    legacyDataRoots: [],
    requestTimeoutMs: 120000,
  };
  bridge = new VideoBridge({
    ctx: {
      logger: { warn: () => {} },
      subprocess: { resolveExecutable: async (c) => c },
    },
    rawConfig: config,
    engineLoader: async () => ({
      WorkerClient,
      workerEntry: config.workerEntry,
      clientVersion: '0.7.0',
      workerVersion: '0.7.0',
    }),
  });
  const a = await bridge.invoke('project.create', {
      templateId: 'product-launch-v1',
      title: 'audio A',
    }),
    b = await bridge.invoke('project.create', {
      templateId: 'product-launch-v1',
      title: 'audio B',
    });
  await assert.rejects(
    () =>
      bridge.invoke(
        'audio.generate',
        {
          projectId: a.projectId,
          operationId: 'scope',
          provider: 'local',
          kind: 'tts',
          text: '不应生成',
        },
        { source: 'tool' },
      ),
    (e) => e.code === 'E_AGENT_REQUIRED',
  );
  bridge.sessions.projectForSession = async (id) =>
    id === 'trusted-agent' ? a.projectId : null;
  await assert.rejects(
    () =>
      bridge.invoke(
        'audio.generate',
        {
          projectId: b.projectId,
          operationId: 'scope',
          provider: 'local',
          kind: 'tts',
          text: '不应生成',
        },
        { source: 'tool', agentSessionId: 'trusted-agent' },
      ),
    (e) => e.code === 'E_PROJECT_SCOPE',
  );
  const caps = await bridge.invoke(
    'audio.providers',
    { projectId: a.projectId },
    { source: 'tool', agentSessionId: 'trusted-agent' },
  );
  assert.ok(caps.providers.some((p) => p.id === 'qianwen'));
  assert.equal('configured' in caps, false);
  await assert.rejects(
    () =>
      bridge.invoke(
        'audio.configure',
        { apiKey: 'not-a-real-key' },
        { source: 'tool', agentSessionId: 'trusted-agent' },
      ),
    (e) => e.code === 'E_METHOD',
  );
  let j = await bridge.invoke(
    'audio.generate',
    {
      projectId: a.projectId,
      operationId: 'local_success',
      provider: 'local',
      kind: 'tts',
      text: '音频服务测试。',
    },
    { source: 'tool', agentSessionId: 'trusted-agent' },
  );
  while (
    ['queued', 'running', 'downloading'].includes(
      (j = await bridge.invoke(
        'audio.status',
        { projectId: a.projectId, jobId: j.jobId },
        { source: 'tool', agentSessionId: 'trusted-agent' },
      )).state,
    )
  )
    await new Promise((r) => setTimeout(r, 50));
  assert.equal(j.state, 'succeeded', JSON.stringify(j));
  assert.equal(j.asset.kind, 'audio');
  await assert.rejects(
    () =>
      bridge.invoke('audio.status', { projectId: b.projectId, jobId: j.jobId }),
    (e) => e.code === 'E_JOB_NOT_FOUND',
  );
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        'trusted Agent required',
        'cross-project denied before generation',
        'capabilities without credentials',
        'credential actions UI-only',
        'real local generation -> managed audio asset',
        'job ownership',
      ],
    }),
  );
} finally {
  if (bridge) await bridge.dispose();
  await rm(root, { recursive: true, force: true });
}
