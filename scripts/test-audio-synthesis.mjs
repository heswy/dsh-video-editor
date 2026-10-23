import assert from 'node:assert/strict';
import { ProceduralProvider, validateScore } from '../host/audio-synth.js';
const score={duration:2,seed:17,events:[{sound:'bell',note:72,at:0.1,duration:0.4,gainDb:-12},{sound:'kick',at:1,duration:0.3,gainDb:-9}]};
const p=new ProceduralProvider();
const a=await p.generate({score},{signal:new AbortController().signal});
assert.equal(Buffer.from(a.bytes).toString('ascii',0,4),'RIFF');
assert.equal(Buffer.from(a.bytes).readUInt32LE(24),48000);
assert.equal(a.bytes.length,44+2*48000*4);
const b=await p.generate({score},{signal:new AbortController().signal});assert(Buffer.from(a.bytes).equals(Buffer.from(b.bytes)),'seeded render is reproducible');
assert(a.analysis.peakDb<=-1 && a.analysis.rmsDb>-50);assert.equal(a.analysis.duration,2);
assert.equal(validateScore({...score,events:[{sound:'hat',at:0,duration:0.1,repeat:4,every:0.4}]}).events.length,4);
for(const bad of [{...score,code:'process.exit()'},{...score,duration:10000},{...score,events:[]},{...score,events:[{sound:'url',at:0,duration:1}]},{...score,events:[{sound:'bell',at:2,duration:1}]},{...score,events:[{sound:'bell',at:0,duration:1,repeat:10000,every:0.001}]},{...score,seed:NaN}])assert.throws(()=>validateScore(bad));
const controller=new AbortController();controller.abort();await assert.rejects(()=>p.generate({score},{signal:controller.signal}));
for(const sound of ['sine','pluck','bell','pad','bass','kick','snare','hat','click','whoosh','riser','rain']){
 const r=await p.generate({score:{duration:0.3,events:[{sound,at:0,duration:0.3,gainDb:-12}]}},{signal:new AbortController().signal});assert(r.analysis.rmsDb>-65,sound+' is audible');
}
console.log(JSON.stringify({ok:true,checks:27}));
