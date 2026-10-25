import test from 'node:test';
import assert from 'node:assert/strict';
import {versions} from '../packages/video-engine-worker/src/jobs.mjs';

test('engine doctor resolves runtime dependencies from the installed bundle root',()=>{
  const result=versions({});
  assert.equal(result.hyperframes,'0.8.167');
  assert.equal(result.sdk,'0.8.167');
  assert.equal(result.gsap,'3.15.0');
});
