import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AudioService} from '../host/audio.js';
import {ProceduralProvider} from '../host/audio-synth.js';
const root=await mkdtemp(join(tmpdir(),'synth-jobs-'));let imported=0;
const options={root,providers:[new ProceduralProvider()],importAudio:async()=>{imported++;return {asset:{assetId:'as_test',kind:'audio'}};}};
let service=new AudioService(options),checks=0;
const params={projectId:'demo',operationId:'song-1',provider:'procedural',kind:'music',text:'本地测试配乐',score:{duration:0.3,events:[{sound:'bell',at:0,duration:0.3}]}};
const wait=async job=>{for(let i=0;i<500;i++){job=await service.status('demo',job.jobId);if(!['queued','running','downloading'].includes(job.state))return job;await new Promise(r=>setTimeout(r,10));}throw Error('job deadline');};
try{
 let j=await wait(await service.generate(params));assert.equal(j.state,'succeeded');assert.equal(j.estimate.cny,0);checks++;
 assert.equal((await service.generate(params)).jobId,j.jobId);assert.equal(imported,1);checks++;
 await assert.rejects(()=>service.generate({...params,score:{...params.score,seed:2}}),e=>e.code==='E_OPERATION_REUSED');checks++;
 const recipe=await service.recipe('demo',j.jobId);assert.equal(recipe.score.events[0].sound,'bell');assert(!JSON.stringify(recipe).includes('apiKey'));checks++;
 await assert.rejects(()=>service.recipe('foreign',j.jobId),e=>e.code==='E_JOB_NOT_FOUND');checks++;
 await service.dispose();service=new AudioService(options);assert.deepEqual(await service.recipe('demo',j.jobId),recipe);assert.equal((await service.generate(params)).jobId,j.jobId);checks++;
 const cancelled=await service.generate({...params,operationId:'cancel-local'});await service.cancel('demo',cancelled.jobId);const final=await wait(cancelled);assert.equal(final.state,'cancelled');assert.equal(final.error.uncertain,false);assert.equal(imported,1);checks++;
 // Full cloud budget must not block free local synthesis.
 const history=JSON.parse(await readFile(join(root,'audio-jobs.json'),'utf8'));
 for(let i=0;i<20;i++)history.jobs.push({...j,hash:'a'.repeat(64),provider:'qianwen',operationId:'cloud-'+i,jobId:'audio_'+String(i).padStart(36,'0')});
 await writeFile(join(root,'audio-jobs.json'),JSON.stringify(history));
 const free=await wait(await service.generate({...params,operationId:'after-cloud-budget'}));assert.equal(free.state,'succeeded');checks++;
 await assert.rejects(()=>service.generate({...params,operationId:'bad',provider:'local'}),e=>e.code==='E_PARAMS');checks++;
 console.log(JSON.stringify({ok:true,checks}));
}finally{await service.dispose();await rm(root,{recursive:true,force:true});}
