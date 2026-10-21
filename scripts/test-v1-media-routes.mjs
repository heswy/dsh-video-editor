import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMediaRoute } from '../host/media-routes.js';
const root = await mkdtemp(join(tmpdir(), 'media-route-'));
try {
  const path = join(root, 'media');
  await writeFile(path, '0123456789');
  const bridge = {
    resolveMedia: async (p) => {
      assert.equal(p.projectId, 'demo');
      assert.equal(p.assetId, 'as_12345678');
      return { path, size: 10, mediaType: 'video/mp4' };
    },
  };
  const route = createMediaRoute(bridge);
  async function get(range, method = 'GET') {
    return route.fetch(
      new Request('http://localhost/api/dsh-video/media?projectId=demo&assetId=as_12345678', {
        method,
        headers: range ? { range } : {},
      }),
    );
  }
  let r = await get('bytes=2-4');
  assert.equal(r.status, 206);
  assert.equal(await r.text(), '234');
  assert.equal(r.headers.get('content-range'), 'bytes 2-4/10');
  r = await get('bytes=-2');
  assert.equal(await r.text(), '89');
  r = await get('bytes=9-');
  assert.equal(await r.text(), '9');
  r = await get('bytes=11-');
  assert.equal(r.status, 416);
  assert.equal(r.headers.get('content-range'), 'bytes */10');
  r = await get('bytes=0-1,4-5');
  assert.equal(r.status, 416);
  r = await get(null, 'HEAD');
  assert.equal(r.headers.get('content-length'), '10');
  assert.equal(await r.text(), '');
  r = await route.fetch(
    new Request('http://localhost/api/dsh-video/media?projectId=demo&assetId=as_12345678&path=/etc/passwd'),
  );
  assert.equal(r.status, 400);
  bridge.closing=true; r=await get();assert.equal(r.status,503);
  console.log('PASS Range, suffix, open range, 416, HEAD, extra query rejection');
} finally {
  await rm(root, { recursive: true, force: true });
}
