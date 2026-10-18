import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runOwned } from '../scripts/process.mjs';

for (const mode of ['cancel', 'timeout']) {
  test(`${mode} terminates an owned process group and cleans its temp directory`, async () => {
    await mkdir(resolve('artifacts'), { recursive: true });
    const temp = await mkdtemp(resolve('artifacts/process-test-'));
    const controller = new AbortController();
    // Grandchild deliberately ignores TERM. Unrelated sentinel must survive.
    const { spawn } = await import('node:child_process');
    const sentinel = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
    let timer;
    const code = `const {spawn}=require('node:child_process'); const fs=require('node:fs');
      const c=spawn(process.execPath,['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
      fs.writeFileSync(process.argv[1],String(c.pid)); console.log('READY');setInterval(()=>{},1000);`;
    let childPid;
    try {
      const result = await runOwned([process.execPath, '-e', code, `${temp}/pid`], {
        temp, signal: controller.signal, timeoutMs: mode === 'timeout' ? 500 : 5000,
        onOutput(chunk) { if (mode === 'cancel' && chunk.includes('READY')) timer = setTimeout(() => controller.abort(), 100); },
        beforeCleanup: async () => { childPid = Number(await readFile(`${temp}/pid`, 'utf8')); }
      });
      assert.equal(result.status, mode === 'cancel' ? 'cancelled' : 'timed_out');
      assert.throws(() => process.kill(result.pid, 0), { code: 'ESRCH' });
      assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
      assert.doesNotThrow(() => process.kill(sentinel.pid, 0));
      await assert.rejects(access(temp), { code: 'ENOENT' });
    } finally { clearTimeout(timer); sentinel.kill(); }
  });
}
