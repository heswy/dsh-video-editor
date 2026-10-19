import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

// Separate CLI invocations prove persistence across process termination.
test('SDK changes title and timing, saves native HTML, reopens with stable IDs', async () => {
  await mkdir(resolve('artifacts'), { recursive: true });
  const root = await mkdtemp(resolve('artifacts/sdk-test-'));
  try {
    const call = (action) => {
      const p = spawnSync(process.execPath, ['scripts/project.mjs', action, root], { encoding: 'utf8' });
      assert.equal(p.status, 0, p.stderr);
      return JSON.parse(p.stdout);
    };
    const before = call('create');
    assert.equal(before.title.text, '让创意成为影像');
    assert.equal(before.title.start, 0);
    const after = call('edit');
    assert.equal(after.title.text, '每一帧，都可编辑');
    assert.equal(after.title.start, 1);
    assert.equal(after.title.duration, 3);
    const reopened = call('inspect');
    assert.deepEqual(reopened, after);
    assert.deepEqual(before.ids, after.ids);
    assert.notEqual(before.revision, after.revision);
    assert.ok((await readFile(`${root}/index.html`, 'utf8')).includes('data-hf-id="hf-title"'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
