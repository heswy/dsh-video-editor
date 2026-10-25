/** Install a public Git/npm spec with the real DSH CLI in an isolated profile. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const spec=process.argv[2];
if(!spec)throw new Error('Usage: node scripts/test-source-install.mjs <git-or-npm-spec>');
const temp=await mkdtemp(join(tmpdir(),'video-source-install-'));
const env={...process.env,DSH_HOME:join(temp,'dsh-home')};let bridge;
try {
  const profile=join(env.DSH_HOME,'profiles/source-test');await mkdir(profile,{recursive:true});
  await writeFile(join(profile,'package.json'),JSON.stringify({name:'source-test',private:true,dsh:{profile:{bundles:[]}}}));
  await writeFile(join(profile,'cordis.patch.yml'),'[]\n');
  execFileSync('dsh',['plugin','--profile','source-test','add',spec,'--ignore-scripts','--registry=https://registry.npmjs.org','--store-dir='+join(temp,'pnpm-store'),'--cache-dir='+join(temp,'pnpm-cache')],{env,timeout:240000,encoding:'utf8',maxBuffer:1048576});
  const installed=join(profile,'node_modules/dsh-video-editor');
  const manifest=JSON.parse(await readFile(join(installed,'package.json'),'utf8'));
  assert.equal(manifest.name,'dsh-video-editor');assert.equal(manifest.version,'1.0.0');
  const {VideoBridge}=await import(pathToFileURL(join(installed,'host/bridge.js')));
  const {releaseConfig}=await import(pathToFileURL(join(installed,'host/release-runtime.js')));
  bridge=new VideoBridge({rawConfig:releaseConfig({dataRoot:join(temp,'data')},pathToFileURL(join(installed,'host/release-runtime.js'))),baseUrl:pathToFileURL(join(installed,'host/engine.js')),ctx:{logger:{warn(){}},subprocess:{resolveExecutable:async name=>name==='node'?process.execPath:name},connection:{fetch:{register:()=>()=>{}}}}});
  await bridge.invoke('project.list',{});
  const project=await bridge.invoke('project.create',{templateId:'product-launch-v1',title:'Source installation fixture'});
  await bridge.invoke('open',{projectId:project.projectId});
  const timeline=await bridge.invoke('timeline.inspect',{projectId:project.projectId});
  const job=await bridge.invoke('frame',{projectId:project.projectId,revision:timeline.revision,time:0});let result;
  for(let i=0;i<240;i++){
    result=await bridge.invoke('status',{jobId:job.jobId});
    if(['succeeded','failed','cancelled','timed_out'].includes(result.state))break;
    await new Promise(yes=>setTimeout(yes,250));
  }
  assert.equal(result.state,'succeeded',JSON.stringify(result));
  console.log(JSON.stringify({ok:true,spec,name:manifest.name,version:manifest.version,realFrame:true,isolated:true}));
} finally {await bridge?.dispose();await rm(temp,{recursive:true,force:true});}
