import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, access, readFile, mkdir, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openComposition } from '@hyperframes/sdk';
import { runOwned } from '../scripts/process.mjs';
import { cli, project, artifacts } from '../scripts/paths.mjs';
for (const mode of ['cancel', 'timeout']) {
  test(`real upstream rendering ${mode} leaves no owned processes or temp directory`, async () => {
    await mkdir(artifacts, { recursive: true });
    const temp = await mkdtemp(resolve(artifacts, `render-${mode}-`));
    const controller = new AbortController();
    let source = project;
    if (mode === 'timeout') {
      source = resolve(temp, 'project');
      await mkdir(source);
      await cp(resolve(project, 'assets'), resolve(source, 'assets'), { recursive: true });
      const comp = await openComposition(await readFile(resolve(project, 'index.html'), 'utf8'));
      comp.setTiming('hf-scene', { duration: 60 });
      await writeFile(resolve(source, 'index.html'), comp.serialize());
      comp.dispose();
    }
    const result = await runOwned([process.execPath, cli, 'render', source, '-o', `${temp}/partial.mp4`,
      '--fps', '30', '--workers', '1', '--quality', 'standard', '--no-browser-gpu'], {
      temp, signal: controller.signal, timeoutMs: mode === 'timeout' ? 20000 : 60000,
      onOutput(s) { if (mode === 'cancel' && s.includes('Streaming frame')) controller.abort(); }
    });
    await writeFile(resolve(artifacts, `render-${mode}.log`), result.output);
    const summary = { ...result, output: undefined };
    await writeFile(resolve(artifacts, `render-${mode}.json`), JSON.stringify(summary, null, 2));
    assert.match(result.output, /Streaming frame/);
    assert.equal(result.status, mode === 'cancel' ? 'cancelled' : 'timed_out');
    assert.ok(result.ownedPids.length >= 3, 'should own CLI, Chromium and FFmpeg descendants');
    assert.deepEqual(result.survivors, []);
    await assert.rejects(access(temp), { code: 'ENOENT' });
    console.log(JSON.stringify(summary));
  });
}
