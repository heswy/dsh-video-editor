/** Release-only portable defaults. Explicit deployment configuration remains authoritative. */
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {homedir} from 'node:os';
import {resolveDataRoot,dataRootLayout} from './data-root.js';
export function releaseConfig(raw={},baseUrl=import.meta.url){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.workerNode)return raw;
  const root=dirname(dirname(fileURLToPath(baseUrl)));
  if(!existsSync(join(root,'RELEASE.json')))return raw;
  const {root:dataRoot}=resolveDataRoot(raw,process.env),paths=dataRootLayout(dataRoot);
  return {workerNode:'node',workerEntry:join(root,'runtime/engine-worker/src/worker.mjs'),workerCwd:homedir(),registryPath:paths.registryPath,artifactRoot:paths.outputRoot,allowedProjects:['managed'],dataRoot,requestTimeoutMs:120000,...raw};
}
