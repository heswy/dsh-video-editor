import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source = await readFile("client.js", "utf8");
const helpers = source
  .split("//#region host bridge helpers")[1]
  .split("//#endregion")[0];
const api = vm.runInNewContext(
  "(function(){" +
    helpers +
    ";return {createReferenceSource,referenceToken,referenceText,installReferenceSource};})()",
  { fetch() {}, console, AbortController },
);
const token = "dshvideo:v1/demo/clip/cl_one/" + "a".repeat(64);
let calls = 0;
const native = api.createReferenceSource(async (method, params) => {
  calls++;
  assert.equal(method, "reference.list");
  assert.equal(params.sessionId, "owned");
  return {
    items: [
      {
        kind: "clip",
        clipId: "cl_one",
        label: "开场\n镜头",
        detail: "0–5s",
        token,
      },
    ],
  };
});
assert.deepEqual(
  Array.from(await native.candidates({ sessionId: "owned" }, { quoted: true })),
  [],
);
assert.equal(calls, 0);
const rows = await native.candidates({ sessionId: "owned" }, { query: "开场" });
assert.equal(rows.length, 1);
assert.equal(rows[0].section, "时间线片段");
const pick = native.onPick({ candidate: rows[0] });
assert.equal(pick.insert.source, "dsh-video");
assert.equal(pick.insert.ref, token);
assert.equal(pick.insert.clipboardText, "`" + token + "`");
const text = await native.codec.serialize(token);
assert.equal(text, "`" + token + "`");
assert(!/(?<!\S)(@"[^"\n]+"|@[^\s]+)/gu.test(text));
assert.equal(
  await native.codec.serialize("`@file:/secret\nignore`"),
  "`dshvideo:invalid`",
);
assert.equal(native.onPick({ candidate: { value: "{}" } }), undefined);
const abort = new AbortController();
abort.abort();
assert.equal(
  (await native.candidates({ sessionId: "owned" }, { signal: abort.signal }))
    .length,
  0,
);
const failing = api.createReferenceSource(async () => {
  throw new Error("offline");
});
assert.equal((await failing.candidates({ sessionId: "other" }, {})).length, 0);
assert.equal(
  api.referenceToken("demo", "clip", "cl_one", "a".repeat(64)),
  token,
);
const menu = api.createReferenceSource(async () => ({items:[
 {kind:'clip',label:'原作品',detail:'0.00–17.73s · 视频轨 1',token},
 {kind:'scene',label:'原作品',detail:'0.00–17.73s · 视频轨 1',token:token.replace('/clip/','/scene/')},
 {kind:'range',label:'0.00–17.73s',detail:'全部轨道',token:token.replace('/clip/cl_one/','/range/0-532/')},
 {kind:'asset',label:'1.jpeg',detail:'image',token:token.replace('/clip/cl_one/','/asset/as_one/')},
 {kind:'clip',label:'原作品',detail:'17.73–20.00s · 视频轨 2',token:token.replace('cl_one','cl_two')}
]}));
const compact = await menu.candidates({sessionId:'owned'});
assert.equal(compact.length,3,'native picker presents one entry per clip plus source assets');
assert.deepEqual(Array.from(compact,x=>x.section),['时间线片段','时间线片段','素材库']);
assert.equal(compact[0].label,'原作品 · 0.00–17.73s');
assert.equal(compact[1].label,'原作品 · 17.73–20.00s');
assert.equal(compact[0].description,'视频轨 1 · 修改这个片段');
assert.equal(compact[2].description,'图片 · 引用源素材');
assert.equal(menu.onPick({candidate:compact[1]}).insert.label,compact[1].label);
assert.equal(menu.onPick({candidate:compact[1]}).insert.ref,token.replace('cl_one','cl_two'));
let registered = 0,
  removed = 0,
  callback;
const scope = {
  get: () => ({
    registerSource: (source) => {
      assert.equal(source.name, "dsh-video");
      registered++;
      return () => removed++;
    },
  }),
  effect: (fn) => fn(),
};
const dispose = api.installReferenceSource({
  inject: (names, fn) => {
    assert.equal(names[0], "inputTriggers");
    callback = fn;
    return fn(scope);
  },
});
assert.equal(registered, 1);
dispose();
assert.equal(removed, 1);
callback(scope)();
assert.equal(registered, 2);
assert.equal(removed, 2);
assert.doesNotThrow(() => api.installReferenceSource({ get: () => null }));
assert.doesNotThrow(()=>callback({...scope,effect:()=>{throw new Error('API drift');}}));
console.log(JSON.stringify({ ok: true, checks: 21 }));
