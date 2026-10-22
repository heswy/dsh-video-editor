/** Regress the real failed project on a private disposable copy, never in place. */
import assert from 'node:assert/strict';
import {cp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fixture,client,waitJob} from '../packages/video-engine-worker/test/helpers.mjs';
const source=resolve(process.argv[2]),out=resolve(process.argv[3]||'/tmp/dsh-user-film');await mkdir(out,{recursive:true});
const f=await fixture();let c;const projectId='demo';
try{await cp(source,f.project,{recursive:true,force:true});const timeline=JSON.parse(await readFile(join(f.project,'timeline.json'),'utf8'));timeline.projectId=projectId;for(const h of timeline._history??[])for(const t of [h.before,h.after])t.projectId=projectId;await writeFile(join(f.project,'timeline.json'),JSON.stringify(timeline));c=client(f.registry);
 const call=async(method,p={})=>{const r=await c.call(method,{projectId,...p});assert(r.ok,JSON.stringify(r));return r.result;};
 await call('open');const t=await call('timeline.inspect');const inspected=await call('inspect');assert.equal(inspected.duration,20);const rename=await call('project.rename',{title:'Recovered film (test copy)'});assert.equal(rename.revision,t.revision);await call('inspect');
 const frame=await call('frame',{revision:t.revision,times:[2,8,16]});const fr=await waitJob(c,frame.jobId);assert.equal(fr.state,'succeeded',JSON.stringify(fr));await cp(join(f.config.outputRoot,fr.artifact.name),join(out,'contact-sheet.png'));
 const render=await call('render',{revision:t.revision});const r=await waitJob(c,render.jobId);assert.equal(r.state,'succeeded',JSON.stringify(r));assert.equal(r.artifact.metadata.nb_read_frames,'600');await cp(join(f.config.outputRoot,r.artifact.name),join(out,'recovered-film.mp4'));await writeFile(join(out,'render.json'),JSON.stringify(r,null,2));console.log(JSON.stringify({ok:true,frames:600,duration:20,previewFrames:3,out}));
}finally{if(c)await c.stop();await f.cleanup();}
