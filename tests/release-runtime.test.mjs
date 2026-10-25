import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {releaseConfig} from '../host/release-runtime.js';
test('development config is preserved; only release marker enables portable defaults',async()=>{const dir=await mkdtemp(join(tmpdir(),'video-release-config-'));try{await mkdir(join(dir,'host'));const base=pathToFileURL(join(dir,'host/index.js'));assert.deepEqual(releaseConfig({},base),{});await writeFile(join(dir,'RELEASE.json'),'{}');const config=releaseConfig({},base);assert.equal(config.workerNode,'node');assert.ok(config.registryPath.endsWith('registry.json'));assert.equal(config.workerEntry,join(dir,'runtime/engine-worker/src/worker.mjs'));const explicit={workerNode:'/trusted/node'};assert.equal(releaseConfig(explicit,base),explicit);}finally{await rm(dir,{recursive:true,force:true});}});

test('Git and npm installations resolve their own engine dependency without a release marker', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'video-source-install-'));
  try {
    await mkdir(join(dir, 'host'));
    await writeFile(join(dir, 'package.json'), JSON.stringify({name:'dsh-video-editor', dependencies:{'dsh-video-engine-client':'file:packages/video-engine-client','dsh-video-engine-worker':'file:packages/video-engine-worker'}}));
    const worker = join(dir, 'packages/video-engine-worker');
    await mkdir(join(dir,'packages/video-engine-client/src'),{recursive:true});
    await writeFile(join(dir,'packages/video-engine-client/src/index.mjs'),'');
    await mkdir(join(worker, 'src'), {recursive:true});
    await writeFile(join(worker,'package.json'), JSON.stringify({name:'dsh-video-engine-worker',exports:{'./worker':'./src/worker.mjs'}}));
    await writeFile(join(worker,'src/worker.mjs'), '');
    const config = releaseConfig({}, pathToFileURL(join(dir,'host/release-runtime.js')));
    assert.equal(config.workerNode, 'node');
    assert.equal(config.workerEntry, join(worker,'src/worker.mjs'));
    assert.equal(config.allowedProjects[0], 'managed');
    const explicit = {workerNode:'/custom/node',dataRoot:join(dir,'custom')};
    assert.equal(releaseConfig(explicit, pathToFileURL(join(dir,'host/release-runtime.js'))), explicit);
  } finally {await rm(dir,{recursive:true,force:true});}
});
