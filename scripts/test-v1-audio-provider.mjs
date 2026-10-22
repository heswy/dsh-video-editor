import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  writeFile,
  chmod,
  stat,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AudioService, QianwenProvider } from '../host/audio.js';
const root = await mkdtemp(join(tmpdir(), 'm4-provider-'));
let calls = 0;
const provider = {
  id: 'fake',
  capabilities: () => ({ tts: true, sfx: true, music: false }),
  generate: async (r, { signal }) => {
    calls++;
    await new Promise((res, rej) => {
      const t = setTimeout(res, 40);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          rej(new Error('abort'));
        },
        { once: true },
      );
    });
    return {
      bytes: Buffer.from('audio'),
      extension: 'wav',
      usage: { duration: 1 },
    };
  },
};
const opts = {
  root,
  providers: [provider],
  importAudio: async (p, file) => ({
    asset: { assetId: 'as_12345678', kind: 'audio' },
  }),
};
try {
  const s = new AudioService(opts);
  await s.configure({ apiKey: 'sk-test-private' });
  assert.equal(
    (await stat(join(root, 'audio-secrets.json'))).mode & 0o777,
    0o600,
  );
  assert.doesNotMatch(JSON.stringify(await s.settings()), /sk-test-private/);
  const req = {
    projectId: 'demo',
    operationId: 'op_one',
    provider: 'fake',
    kind: 'tts',
    text: '你好',
  };
  let j = await s.generate(req);
  assert.equal((await s.generate(req)).jobId, j.jobId);
  await assert.rejects(
    () => s.generate({ ...req, text: '不同' }),
    (e) => e.code === 'E_OPERATION_REUSED',
  );
  while (
    !['succeeded', 'failed'].includes(
      (j = await s.status('demo', j.jobId)).state,
    )
  )
    await new Promise((r) => setTimeout(r, 20));
  assert.equal(j.state, 'succeeded');
  assert.equal(calls, 1);
  await assert.rejects(
    () => s.status('other', j.jobId),
    (e) => e.code === 'E_JOB_NOT_FOUND',
  );
  const again = new AudioService(opts);
  assert.equal((await again.generate(req)).jobId, j.jobId);
  assert.equal(calls, 1);
  let cancel = await s.generate({ ...req, operationId: 'op_cancel' });
  await s.cancel('demo', cancel.jobId);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal((await s.status('demo', cancel.jobId)).state, 'cancelled');
  const q = new QianwenProvider({
    getKey: async () => 'secret',
    fetch: async () =>
      new Response(
        JSON.stringify({ code: 'AccessDenied', message: 'secret raw' }),
        { status: 403 },
      ),
  });
  await assert.rejects(
    () =>
      q.generate(
        { kind: 'music', text: 'piano' },
        { signal: new AbortController().signal },
      ),
    (e) => e.code === 'E_AUDIO_ENTITLEMENT' && !e.message.includes('secret'),
  );
  const q2 = new QianwenProvider({
    getKey: async () => 'secret',
    fetch: async () =>
      new Response(
        JSON.stringify({ output: { audio: { url: 'http://127.0.0.1/a' } } }),
        { status: 200 },
      ),
  });
  await assert.rejects(
    () =>
      q2.generate(
        { kind: 'tts', text: 'hi' },
        { signal: new AbortController().signal },
      ),
    (e) => e.code === 'E_AUDIO_DOWNLOAD',
  );
  let upgraded = false;
  const q3 = new QianwenProvider({
    getKey: async () => 'secret',
    fetch: async (url) => {
      if (String(url).includes('SpeechSynthesizer'))
        return new Response(
          JSON.stringify({
            output: {
              audio: {
                url: 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.wav',
              },
            },
          }),
        );
      upgraded = String(url).startsWith('https:');
      return new Response('wave');
    },
  });
  await q3.generate(
    { kind: 'tts', text: 'hi' },
    { signal: new AbortController().signal },
  );
  assert.equal(upgraded, true);
  // Recovery never submits an ambiguous paid request again.
  const recoveryRoot = join(root, 'recovery');
  const recovery = new AudioService({ ...opts, root: recoveryRoot });
  await recovery.prepare();
  await writeFile(
    join(recoveryRoot, 'audio-jobs.json'),
    JSON.stringify({ jobs: [{ ...j, state: 'running', hash: 'ignored' }] }),
  );
  const interrupted = await recovery.status('demo', j.jobId);
  assert.equal(interrupted.state, 'interrupted');
  assert.equal(interrupted.error.uncertain, true);
  assert.equal(calls, 2);
  const deniedRoot = join(root, 'denied');
  let deniedCalls = 0;
  const denied = new AudioService({
    ...opts,
    root: deniedRoot,
    providers: [
      {
        id: 'qianwen',
        capabilities: () => ({ music: 'invitation' }),
        generate: async () => {
          deniedCalls++;
          throw Object.assign(new Error('denied'), {
            code: 'E_AUDIO_ENTITLEMENT',
          });
        },
      },
    ],
  });
  let deniedJob = await denied.generate({
    ...req,
    operationId: 'op_music',
    provider: 'qianwen',
    kind: 'music',
  });
  while (
    ['queued', 'running'].includes(
      (deniedJob = await denied.status('demo', deniedJob.jobId)).state,
    )
  )
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    (await denied.settings()).providers[0].capabilities.music,
    false,
  );
  await assert.rejects(
    () =>
      denied.generate({
        ...req,
        operationId: 'op_music_retry',
        provider: 'qianwen',
        kind: 'music',
      }),
    (e) => e.code === 'E_AUDIO_ENTITLEMENT',
  );
  assert.equal(deniedCalls, 1);
  await chmod(join(root, 'audio-secrets.json'), 0o644);
  await assert.rejects(
    () => s.settings(),
    (e) => e.code === 'E_AUDIO_AUTH',
  );
  await chmod(join(root, 'audio-secrets.json'), 0o600);
  const timed = new AudioService({
    ...opts,
    root: join(root, 'timeout'),
    timeoutMs: 5,
  });
  let tj = await timed.generate({ ...req, operationId: 'op_timeout' });
  while (
    ['queued', 'running'].includes(
      (tj = await timed.status('demo', tj.jobId)).state,
    )
  )
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(tj.state, 'timed_out');
  assert.equal(tj.error.code, 'E_AUDIO_TIMEOUT');
  assert.equal(tj.error.uncertain, true);
  await timed.dispose();
  await recovery.dispose();
  await denied.dispose();
  await s.dispose();
  await again.dispose();
  console.log(
    'audio provider: secure settings, idempotency, restart, ownership, cancellation, error redaction and URL fence passed',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
