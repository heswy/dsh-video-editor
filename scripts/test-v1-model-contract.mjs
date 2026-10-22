import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {SessionService} from '../host/sessions.js';
import {BridgeError} from '../host/errors.js';
import {createVideoTool} from '../host/tool.js';
const revision='a'.repeat(64);
const fake={mappingSync:()=> 'demo',bridge:{projectFacts:()=>({mode:'timeline',revision,width:1280,height:720,duration:20})}};
const text=SessionService.prototype.contextText.call(fake,{agent:{session:{id:'trusted'}}});
assert(text.includes('clip.trim'));assert(text.includes('"expectedRevision"'));assert(text.includes('"operationId"'));assert(text.includes('data-hf-root'));assert(text.includes('durationFrames'));assert(text.includes('Last known project revision'));assert(text.length<6500);
const tool=createVideoTool({invoke:async()=>{throw new BridgeError('E_PARAMS','Invalid operationId');}});
await assert.rejects(()=>tool.execute({action:'scene.compose',projectId:'demo',html:'x'},{agent:{id:'trusted'}}),e=>e.message.includes('expectedRevision')&&e.message.includes('operationId'));
console.log(JSON.stringify({ok:true,contextChars:text.length,checks:8}));

let plugin;vm.runInNewContext(await readFile('client.js','utf8'),{window:{__ModuleLoader__:{load(m){plugin=m.factory(()=>({createElement(){}}));}}},console,URL,TextEncoder,AbortController});assert(plugin.inject.includes('sessions'),'Client must await the Session service instead of caching an early null');
