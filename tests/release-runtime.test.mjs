import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {releaseConfig} from '../host/release-runtime.js';
test('development config is preserved; only release marker enables portable defaults',async()=>{const dir=await mkdtemp(join(tmpdir(),'video-release-config-'));try{await mkdir(join(dir,'host'));const base=pathToFileURL(join(dir,'host/index.js'));assert.deepEqual(releaseConfig({},base),{});await writeFile(join(dir,'RELEASE.json'),'{}');const config=releaseConfig({},base);assert.equal(config.workerNode,'node');assert.ok(config.registryPath.endsWith('registry.json'));assert.equal(config.workerEntry,join(dir,'runtime/engine-worker/src/worker.mjs'));const explicit={workerNode:'/trusted/node'};assert.equal(releaseConfig(explicit,base),explicit);}finally{await rm(dir,{recursive:true,force:true});}});
