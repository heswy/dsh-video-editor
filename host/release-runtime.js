/** Release-only portable defaults. Explicit deployment configuration remains authoritative. */
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {homedir} from 'node:os';
import {resolveDataRoot,dataRootLayout} from './data-root.js';
export function releaseConfig(raw={},baseUrl=import.meta.url){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.workerNode)return raw;
  const root=dirname(dirname(fileURLToPath(baseUrl)));
  let workerEntry;
  if(existsSync(join(root,'RELEASE.json')))workerEntry=join(root,'runtime/engine-worker/src/worker.mjs');
  else {
    // Git/npm sources ship plain JavaScript and engine sources with pinned runtime dependencies.
    let manifest;
    try{manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));}catch{return raw;}
    if(manifest.name!=='dsh-video-editor'||!existsSync(join(root,'packages/video-engine-worker/src/worker.mjs'))||!existsSync(join(root,'packages/video-engine-client/src/index.mjs')))return raw;
    workerEntry=join(root,'packages/video-engine-worker/src/worker.mjs');
  }
  const {root:dataRoot}=resolveDataRoot(raw,process.env),paths=dataRootLayout(dataRoot);
  return {workerNode:'node',workerEntry,workerCwd:homedir(),registryPath:paths.registryPath,artifactRoot:paths.outputRoot,allowedProjects:['managed'],dataRoot,requestTimeoutMs:120000,...raw};
}
