import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openComposition } from '@hyperframes/sdk';
import { createFsAdapter } from '@hyperframes/sdk/adapters/fs';
import { createHash } from 'node:crypto';
import { root, project, owned, fontPath } from './paths.mjs';
export const hash = (value) => createHash('sha256').update(value).digest('hex');
const [action, requested] = process.argv.slice(2);
const dir = owned(requested || project);
const path = resolve(dir, 'index.html');
if (action === 'create') {
  await mkdir(resolve(dir, 'assets'), { recursive: true });
  await copyFile(resolve(root, 'fixtures/index.html'), path);
  await copyFile(resolve(root, 'node_modules/gsap/dist/MotionPathPlugin.min.js'), resolve(dir, 'assets/MotionPathPlugin.min.js'));
  await copyFile(fontPath, resolve(dir, 'assets/Heiti.ttc'));
  await copyFile(resolve(root, 'node_modules/gsap/dist/gsap.min.js'), resolve(dir, 'assets/gsap.min.js'));
}
const original = await readFile(path, 'utf8');
const comp = await openComposition(original, { persist: createFsAdapter({ root: dir }), persistPath: 'index.html' });
try {
  if (action === 'edit') {
    const errors = [];
    comp.on('persist:error', ({ error }) => errors.push(error.message));
    const matches = comp.find({ text: '让创意成为影像' });
    if (!matches.includes('hf-title')) throw new Error('Expected stable title was not found');
    comp.batch(() => {
      comp.setText('hf-title', '每一帧，都可编辑');
      comp.setTiming('hf-title', { start: 1, duration: 3 });
    });
    await comp.flush();
    if (errors.length) throw new Error(errors.join('\n'));
    if (await readFile(path, 'utf8') !== comp.serialize()) throw new Error('Persistence readback mismatch');
  } else if (!['create', 'inspect'].includes(action)) throw new Error('Use create|edit|inspect');
  const saved = await readFile(path, 'utf8');
  const title = comp.getElement('hf-title');
  console.log(JSON.stringify({ revision: hash(saved), ids: comp.getElements().map(e => e.id).sort(),
    title: { id: title.id, text: title.text, start: title.start, duration: Number(title.attributes['data-duration']), sdkSnapshotDuration: title.duration } }, null, 2));
} finally { comp.dispose(); }
