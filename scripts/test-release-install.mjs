/** Real DSH CLI installation in a disposable profile; no real user profile or projects touched. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const artifact=resolve(process.argv[2]);const temp=await mkdtemp(join(tmpdir(),'video-release-install-'));let bridge;
const env={...process.env,DSH_HOME:join(temp,'dsh-home')};
try{
 const profile=join(env.DSH_HOME,'profiles/release-test');await mkdir(profile,{recursive:true});
 await writeFile(join(profile,'package.json'),JSON.stringify({name:'release-test',private:true,dsh:{profile:{bundles:[]}}}));await writeFile(join(profile,'cordis.patch.yml'),'[]\n');
 const oldRoot=join(temp,'old');await mkdir(oldRoot);execFileSync('tar',['-xzf',artifact,'-C',oldRoot]);
 const manifest=JSON.parse(await readFile(join(oldRoot,'package/package.json'),'utf8'));manifest.version='0.9.9';await writeFile(join(oldRoot,'package/package.json'),JSON.stringify(manifest));
 const old=join(temp,'old.tgz');execFileSync('tar',['-czf',old,'-C',oldRoot,'package']);
 const install=p=>execFileSync('dsh',['plugin','--profile','release-test','add',p,'--ignore-scripts'],{env,timeout:180000,encoding:'utf8',maxBuffer:1048576});
 install(old);
 const installed=join(profile,'node_modules',manifest.name);assert.equal(JSON.parse(await readFile(join(installed,'package.json'),'utf8')).version,'0.9.9');
 const dataRoot=join(temp,'data');
 async function openBridge(tag){const {VideoBridge}=await import(pathToFileURL(join(installed,'host/bridge.js')).href+'?'+tag);const {releaseConfig}=await import(pathToFileURL(join(installed,'host/release-runtime.js')).href+'?'+tag);const {loadEngine}=await import(pathToFileURL(join(installed,'host/engine.js')).href);const config=releaseConfig({dataRoot},pathToFileURL(join(installed,'host/release-runtime.js')));const b=new VideoBridge({engineLoader:async options=>{const engine=await loadEngine(options);return {...engine,WorkerClient:class extends engine.WorkerClient{async start(){try{return await super.start();}catch(error){console.error(this.stderr.toString('utf8'));throw error;}}}};},rawConfig:config,baseUrl:pathToFileURL(join(installed,'host/engine.js')).href,ctx:{logger:{warn(){}},subprocess:{resolveExecutable:async name=>name==='node'?process.execPath:name},connection:{fetch:{register:()=>()=>{}}}}});await b.invoke('project.list',{});return b;}
 bridge=await openBridge('old');const project=await bridge.invoke('project.create',{templateId:'product-launch-v1',title:'Upgrade preservation fixture'});const before=await bridge.invoke('timeline.inspect',{projectId:project.projectId});await bridge.dispose();bridge=null;
 install(artifact);assert.equal(JSON.parse(await readFile(join(installed,'package.json'),'utf8')).version,'1.0.0');
 const engineDirectory=(await stat(join(installed,'runtime/engine-worker')).catch(()=>null))?'runtime/engine-worker':'packages/video-engine-worker';const {dependencyFile}=await import(pathToFileURL(join(installed,engineDirectory,'src/dependencies.mjs')).href);assert.ok((await stat(dependencyFile('hyperframes','dist/cli.js'))).size>0);
 bridge=await openBridge('new');await bridge.invoke('open',{projectId:project.projectId});const after=await bridge.invoke('timeline.inspect',{projectId:project.projectId});assert.equal(after.revision,before.revision);
 const job=await bridge.invoke('frame',{projectId:project.projectId,revision:after.revision,time:0});let result;
 for(let i=0;i<240;i++){result=await bridge.invoke('status',{jobId:job.jobId});if(['succeeded','failed','cancelled','timed_out'].includes(result.state))break;await new Promise(yes=>setTimeout(yes,250));}
 assert.equal(result.state,'succeeded',JSON.stringify(result));
 console.log(JSON.stringify({ok:true,checks:7,version:'1.0.0',upgradeFrom:'0.9.9',projectRevisionPreserved:true,realFrame:true,artifact}));
}finally{await bridge?.dispose();await rm(temp,{recursive:true,force:true});}
