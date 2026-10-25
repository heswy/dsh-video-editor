import test from 'node:test';
import assert from 'node:assert/strict';
import { peakPyramid, sourceSeconds, displayAmplitude } from '../src/visuals.mjs';
test('peak buckets preserve anti-phase stereo and silence',()=>{
 const levels=peakPyramid([new Float32Array([0,.5,0,-.5]),new Float32Array([0,-.5,0,.5])],2);
 assert.deepEqual(levels[0].peaks,[.5,.5]); assert.deepEqual(levels[1].peaks,[.5]);
 assert.equal(peakPyramid([new Float32Array(8)],2)[0].peaks.every(x=>x===0),true);
});
test('source mapping separates source fps from timeline fps',()=>{
 assert.equal(sourceSeconds({sourceInFrame:120,startFrame:90,speed:2},150,60),6);
});
test('display gain is bounded and never invents silence',()=>{
 assert.equal(displayAmplitude(0,.001),0);
 assert.ok(displayAmplitude(.01,.1)>.01);
 assert.ok(displayAmplitude(1,1)<=1);
});
test('visual request limits reject excessive sampling and bad time ranges',async()=>{
 const {validateVisualRequest}=await import('../src/timeline-visuals.mjs');
 assert.throws(()=>validateVisualRequest({clipId:'cl_a',startFrame:0,endFrame:30,count:25}),{code:'E_PARAMS'});
 assert.throws(()=>validateVisualRequest({clipId:'cl_a',startFrame:30,endFrame:0,count:4}),{code:'E_PARAMS'});
 assert.equal(validateVisualRequest({clipId:'cl_a',startFrame:0,endFrame:30,count:4}).count,4);
});
