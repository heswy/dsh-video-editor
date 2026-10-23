/** Data-only, deterministic score contract; DSP runs outside the Host event loop. */
import { Worker } from 'node:worker_threads';
import { BridgeError } from './errors.js';
export const SOUNDS = Object.freeze(['sine','pluck','bell','pad','bass','kick','snare','hat','click','whoosh','riser','rain']);
const fail = message => { throw new BridgeError('E_AUDIO_SCORE',message,{stage:'audio'}); };
const number=(v,min,max,name)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)fail(`${name} must be ${min}–${max}`);return v;};
function keys(v,allowed){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))fail('Score contains an unsupported field; use audio.guide for the schema');}
export function validateScore(score){
 keys(score,['duration','seed','masterDb','events']);
 const duration=number(score.duration,0.1,180,'duration'),seed=score.seed??1,masterDb=score.masterDb??-3;
 number(seed,0,4294967295,'seed');if(!Number.isInteger(seed))fail('seed must be an integer');number(masterDb,-30,0,'masterDb');
 if(!Array.isArray(score.events)||!score.events.length||score.events.length>512)fail('Provide 1–512 sound events');
 const events=[];let work=0;
 for(const e of score.events){
  keys(e,['sound','at','duration','note','gainDb','pan','repeat','every']);
  if(!SOUNDS.includes(e.sound))fail('Unknown sound: '+String(e.sound).slice(0,32));
  const at=number(e.at,0,duration,'at'),d=number(e.duration,0.005,30,'event duration'),note=number(e.note??60,24,108,'MIDI note'),gainDb=number(e.gainDb??-12,-60,0,'gainDb'),pan=number(e.pan??0,-1,1,'pan'),repeat=number(e.repeat??1,1,128,'repeat');
  if(!Number.isInteger(repeat))fail('repeat must be an integer');
  const every=e.every===undefined?(repeat>1?fail('Repeated events require every in seconds'):0):number(e.every,0.005,180,'every');
  for(let i=0;i<repeat;i++){
   const start=at+i*every;
   if(start+d>duration+1e-8)fail('An event extends beyond score duration');
   if(events.length>=512||(work+=d)>900)fail('Score exceeds the 512-event / 900 event-second render limit');
   events.push({sound:e.sound,at:start,duration:d,note,gainDb,pan});
  }
 }
 return {duration,seed,masterDb,events};
}
export class ProceduralProvider {
 constructor(){this.id='procedural';}
 capabilities(){return {tts:false,sfx:true,music:true,offline:true,score:true,maxDuration:180,sounds:SOUNDS};}
 async generate(req,{signal}){
  const score=validateScore(req.score);
  if(signal.aborted)throw new BridgeError('E_AUDIO_CANCELLED','已取消本地合成',{stage:'audio'});
  return new Promise((resolve,reject)=>{
   const worker=new Worker(new URL('./audio-synth-worker.js',import.meta.url),{workerData:score,resourceLimits:{maxOldGenerationSizeMb:128}});
   let done=false;
   const finish=(e,value)=>{if(done)return;done=true;signal.removeEventListener('abort',abort);clearTimeout(timer);void worker.terminate();e?reject(e):resolve(value);};
   const abort=()=>finish(new BridgeError('E_AUDIO_CANCELLED','已取消本地合成',{stage:'audio'}));
   const timer=setTimeout(()=>finish(new BridgeError('E_AUDIO_TIMEOUT','本地合成超过 30 秒，请简化事件表',{stage:'audio'})),30000);
   signal.addEventListener('abort',abort,{once:true});
   if(signal.aborted){abort();return;}
   worker.once('message',value=>value.error?finish(new BridgeError('E_AUDIO_SCORE',value.error,{stage:'audio'})):finish(null,{...value,bytes:Buffer.from(value.bytes),extension:'wav',model:'procedural-v1'}));
   worker.once('error',()=>finish(new BridgeError('E_AUDIO_SYNTH','本地声音合成失败，请简化事件表',{stage:'audio'})));
   worker.once('exit',code=>{if(!done)finish(new BridgeError('E_AUDIO_SYNTH','本地合成进程提前退出',{stage:'audio'}));});
  });
 }
}
