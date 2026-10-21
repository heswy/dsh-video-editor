import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { client } from '../packages/video-engine-worker/test/helpers.mjs';
import { validate } from '../packages/video-engine-worker/test/schema-validator.mjs';
import { MediaLibrary } from '../packages/video-engine-worker/src/assets.mjs';
import { AssetInbox } from '../host/asset-inbox.js';
const root = await mkdtemp(join(tmpdir(), 'v1-media-'));
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log('PASS', name);
}
try {
  const project = join(root, 'demo'),
    inbox = join(root, 'inbox');
  await mkdir(project);
  await mkdir(inbox);
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:s=64x64:d=1',
    '-frames:v',
    '1',
    join(inbox, 'image.png'),
  ]);
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=1',
    join(inbox, 'sound.wav'),
  ]);
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=64x64:r=30:d=1',
    '-c:v',
    'libx264',
    join(inbox, 'movie.mp4'),
  ]);
  const config = { root, projects: { demo: project }, assetInboxRoot: inbox, outputRoot: join(root, 'output') };
  const lib = new MediaLibrary({ config });
  let asset;
  await test('imports media, probes and deduplicates without composition writes', async () => {
    const a = await lib.importMedia({ projectId: 'demo', sourceName: 'movie.mp4', operationId: 'one' });
    asset = a.asset;
    assert.equal(asset.kind, 'video');
    assert.equal(asset.media.width, 64);
    assert.equal((await lib.importMedia({ projectId: 'demo', sourceName: 'movie.mp4' })).deduped, true);
    assert.equal((await lib.list({ projectId: 'demo' })).total, 1);
  });
  await test('index revision stays stable across import, reopen and metadata key order', async () => {
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=64x64:r=30:d=0.2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.2',
      '-c:v',
      'libx264',
      '-c:a',
      'aac',
      '-shortest',
      join(inbox, 'av.mp4'),
    ]);
    const fresh = await lib.importMedia({ projectId: 'demo', sourceName: 'av.mp4', operationId: 'av' });
    const reopened = await lib.list({ projectId: 'demo' });
    assert.equal(reopened.indexRevision, fresh.indexRevision);
    const path = join(project, 'asset-index.json');
    const index = JSON.parse(await readFile(path, 'utf8'));
    index.assets[0].media = Object.fromEntries(Object.entries(index.assets[0].media).reverse());
    await writeFile(path, JSON.stringify(index));
    assert.equal((await lib.list({ projectId: 'demo' })).indexRevision, fresh.indexRevision);
    await lib.remove({ projectId: 'demo', assetId: fresh.asset.assetId });
  });
  await test('derived thumbnail persists and media path is scoped', async () => {
    const file = await lib.resolveFile({ projectId: 'demo', assetId: asset.assetId });
    assert.equal(file.size, asset.bytes);
    const derived = await lib.derive({ projectId: 'demo', assetId: asset.assetId, kind: 'thumb' });
    assert.ok(derived.ready);
    assert.ok((await lib.resolveFile({ projectId: 'demo', assetId: asset.assetId, kind: 'thumb' })).size > 0);
    await assert.rejects(() => lib.resolveFile({ projectId: 'other', assetId: asset.assetId }));
  });
  await test('compatibility proxy preserves the original media and index', async () => {
    const before = (await lib.list({ projectId: 'demo' })).indexRevision;
    await lib.derive({ projectId: 'demo', assetId: asset.assetId, kind: 'proxy' });
    const file = await lib.resolveFile({ projectId: 'demo', assetId: asset.assetId, kind: 'proxy' });
    assert.equal(file.mediaType, 'video/mp4');
    assert.ok(file.size > 0);
    assert.equal((await lib.list({ projectId: 'demo' })).indexRevision, before);
  });
  await test('audio waveform, search, pagination and restart', async () => {
    const a = await lib.importMedia({ projectId: 'demo', sourceName: 'sound.wav' });
    await lib.derive({ projectId: 'demo', assetId: a.asset.assetId, kind: 'waveform' });
    await lib.importMedia({ projectId: 'demo', sourceName: 'image.png' });
    const restarted = new MediaLibrary({ config });
    assert.equal((await restarted.list({ projectId: 'demo' })).total, 3);
    assert.equal((await restarted.list({ projectId: 'demo', kind: 'audio' })).assets[0].assetId, a.asset.assetId);
    assert.ok((await restarted.list({ projectId: 'demo', limit: 1 })).nextCursor);
  });
  await test('real worker JSONL media dispatch serializes import and conforms to schema', async () => {
    const registry = join(root, 'registry.json'),
      workerConfig = join(root, 'worker-config.json');
    await writeFile(registry, JSON.stringify({ projects: { demo: project } }));
    await writeFile(
      workerConfig,
      JSON.stringify({
        projectsRoot: root,
        registryPath: registry,
        outputRoot: join(root, 'output'),
        assetInboxRoot: inbox,
      }),
    );
    const c = client(workerConfig);
    const schema = JSON.parse(
      await readFile(new URL('../packages/video-engine-worker/protocol.schema.json', import.meta.url), 'utf8'),
    );
    try {
      for (const [method, params] of [
        ['asset.list', { projectId: 'demo', limit: 1 }],
        ['asset.importMedia', { projectId: 'demo', sourceName: 'image.png', operationId: 'jsonl' }],
        ['asset.derive', { projectId: 'demo', assetId: asset.assetId, kind: 'thumb' }],
      ]) {
        const result = await c.call(method, params);
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.deepEqual(validate(result.result, { $ref: schema['x-methods'][method].result }, schema), []);
      }
      const bad = await c.call('asset.remove', { projectId: 'demo', assetId: '../../etc/passwd' });
      assert.equal(bad.ok, false);
    } finally {
      await c.stop();
    }
  });
  await test('referenced media cannot be deleted', async () => {
    await writeFile(
      join(project, 'timeline.json'),
      JSON.stringify({ tracks: [{ clips: [{ id: 'cl_test', assetId: asset.assetId }] }] }),
    );
    await assert.rejects(
      () => lib.remove({ projectId: 'demo', assetId: asset.assetId }),
      (e) => e.code === 'E_ASSET_REFERENCED' && e.message.includes('cl_test'),
    );
    await rm(join(project, 'timeline.json'));
  });
  await test('media directory symlink rejected', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    const bad = join(root, 'bad');
    await mkdir(bad);
    await symlink(outside, join(bad, 'media'));
    config.projects.bad = bad;
    await assert.rejects(
      () => lib.importMedia({ projectId: 'bad', sourceName: 'image.png' }),
      (e) => e.code === 'E_PATH',
    );
  });
  await test('derived cache symlink is rejected before creating outside directories', async () => {
    const dir = join(root, 'cache-project'),
      outside = join(root, 'cache-outside');
    await mkdir(dir);
    await mkdir(outside);
    config.projects.cache = dir;
    const a = await lib.importMedia({ projectId: 'cache', sourceName: 'image.png' });
    await symlink(outside, join(dir, '.dsh-video'));
    await assert.rejects(
      () => lib.derive({ projectId: 'cache', assetId: a.asset.assetId, kind: 'thumb' }),
      (e) => e.code === 'E_PATH',
    );
    assert.deepEqual(await readdir(outside), []);
  });
  await test('short-hash collision rejects import without changing the index', async () => {
    const dir = join(root, 'collision');
    await mkdir(dir);
    config.projects.collision = dir;
    const conflicting = { ...asset, sha256: asset.sha256.slice(0, 8) + '0'.repeat(56) };
    await lib.writeIndex(dir, [conflicting]);
    const before = await readFile(join(dir, 'asset-index.json'), 'utf8');
    await assert.rejects(
      () => lib.importMedia({ projectId: 'collision', sourceName: 'movie.mp4' }),
      (e) => e.code === 'E_ASSET_CONFLICT',
    );
    assert.equal(await readFile(join(dir, 'asset-index.json'), 'utf8'), before);
  });
  await test('truncated image and renamed audio container are rejected', async () => {
    await writeFile(join(inbox, 'truncated.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await assert.rejects(() => lib.importMedia({ projectId: 'demo', sourceName: 'truncated.png' }));
    await writeFile(join(inbox, 'renamed.mp4'), await readFile(join(inbox, 'sound.wav')));
    // Use a new project so full-byte dedupe cannot hide the type check.
    const wrong = join(root, 'wrong');
    await mkdir(wrong);
    config.projects.wrong = wrong;
    await assert.rejects(() => lib.importMedia({ projectId: 'wrong', sourceName: 'renamed.mp4' }));
  });
  await test('streaming inbox accepts video, unicode name and cleans receipts', async () => {
    const box = new AssetInbox({ root: inbox, isTrustedProject: (id) => id === 'demo', minFreeBytes: 0 });
    const bytes = await readFile(join(inbox, 'movie.mp4'));
    const r = await box.handle(
      new Request('http://localhost/api/dsh-video/asset-upload', {
        method: 'POST',
        headers: {
          'x-dsh-project-id': 'demo',
          'x-dsh-file-name': encodeURIComponent('视频.mp4'),
          'content-type': 'video/mp4',
        },
        body: bytes,
      }),
    );
    assert.equal(r.status, 200);
    const receipt = await r.json();
    assert.equal(receipt.fileName, '视频.mp4');
    await box.finish(box.take('demo', receipt.receiptId));
    await box.dispose();
  });
  await test('format matrix imports supported containers and derives their media', async () => {
    for (const ext of ['mov', 'm4v', 'webm', 'mp3', 'm4a', 'aac', 'flac', 'jpg']) {
      const sourceName = 'matrix.' + ext;
      const video = ['mov', 'm4v', 'webm'].includes(ext),
        image = ext === 'jpg';
      const args = [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        video || image ? 'color=c=green:s=64x64:r=30:d=0.2' : 'sine=frequency=600:duration=0.2',
      ];
      if (image) args.push('-frames:v', '1');
      if (video) args.push('-c:v', ext === 'webm' ? 'libvpx-vp9' : 'libx264');
      args.push(join(inbox, sourceName));
      execFileSync('ffmpeg', args);
      const result = await lib.importMedia({ projectId: 'demo', sourceName });
      assert.equal(result.asset.kind, video ? 'video' : image ? 'image' : 'audio');
      await lib.derive({
        projectId: 'demo',
        assetId: result.asset.assetId,
        kind: video || image ? 'thumb' : 'waveform',
      });
    }
  });
  await test('streaming limits, cancellation and failed imports leave no upload files', async () => {
    const isolated = join(root, 'limits');
    await mkdir(isolated);
    const box = new AssetInbox({
      root: isolated,
      maxBytes: 32,
      minFreeBytes: 0,
      isTrustedProject: (id) => id === 'demo',
    });
    const request = (body) =>
      new Request('http://localhost/api/dsh-video/asset-upload', {
        method: 'POST',
        duplex: 'half',
        headers: { 'x-dsh-project-id': 'demo', 'x-dsh-file-name': 'test.mp4' },
        body,
      });
    const over = await box.handle(
      request(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(64));
            c.close();
          },
        }),
      ),
    );
    assert.equal(over.status, 413);
    assert.deepEqual(await readdir(isolated), []);
    let controller;
    const slow = new ReadableStream({
      start(c) {
        controller = c;
      },
    });
    const pending = box.handle(request(slow));
    await new Promise((resolve) => setTimeout(resolve, 10));
    box.close();
    const cancelled = await pending;
    assert.equal(cancelled.status, 503);
    await box.dispose();
    assert.deepEqual(await readdir(isolated), []);
  });
  await test('expiry sweep keeps an in-flight receipt without revisiting it',async()=>{
    const box=new AssetInbox({root:inbox,minFreeBytes:0});
    let iterations=0;
    class BoundedMap extends Map {
      *[Symbol.iterator](){for(const entry of super[Symbol.iterator]()){if(++iterations>2)throw new Error('Receipt sweep revisited an active import');yield entry;}}
    }
    box.receipts=new BoundedMap([['pending',{receiptId:'pending',importing:true,createdAt:Date.now()-11*60*1000,target:join(inbox,'owned-unused.mp4')}]]);
    try{assert.equal(await box.sweep(),0);assert.equal(box.receipts.size,1);}finally{await box.dispose();}
  });
  console.log(JSON.stringify({ ok: true, passed }));
} finally {
  await rm(root, { recursive: true, force: true });
}
