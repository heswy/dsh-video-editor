#!/usr/bin/env node
/** Actual client components + CSS in Chrome. Host/session APIs and native-chat
 * DOM are explicit contract fixtures, NOT a DSH installation/model acceptance.
 * Preview document uses the real fixed runtime and GSAP fixture. No profile,
 * installed staging, external network or user project is read/written.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { CANVAS_RUNTIME_SOURCE } from '../host/canvas-runtime.js';
import { genreA, genreB } from './lib/conversation-fixtures.mjs';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'packages/video-engine-worker/package.json'));
const puppeteer = require('puppeteer-core');
const out = resolve(process.argv[2] || join(ROOT, 'artifacts/ui-polish'));
await mkdir(out, { recursive: true });
const source = await readFile(join(ROOT, 'client.js'), 'utf8');
const body = source.slice(source.indexOf('    //#region constants'), source.indexOf('    //#region plugin'));
const css = source.match(/const CSS = `([\s\S]*?)`;/)[1];
const lite = (await readFile(join(ROOT, 'scripts/lib/react-dom-lite.mjs'), 'utf8')).replace('export { React, createElement, createRoot, createPortal, flushSync, pendingWork };', 'window.ReactLite = { React, createElement, createRoot };');
const gsap = await readFile(require.resolve('gsap/dist/gsap.min.js'));
let portrait = false;
const errors = [];
const checks = [];
const screenshots = [];
function check(name, pass, actual) { checks.push({ name, pass, actual }); if (!pass) throw new Error(name + ': ' + JSON.stringify(actual)); }
const fixtureCSS = `
html,body,#mount{margin:0;width:100%;height:100%;overflow:hidden;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
/* Native layout contract from 0.2.1: slot wrappers + flex content + scrollBody + sticky composer.
   Fixture styles are scoped to .native-fixture. No product layout rule is overridden. */
.native-fixture{display:flex;flex:1;min-height:0;flex-direction:column}
.native-fixture [data-conversation-content]{display:flex;flex-direction:column;flex:1;min-height:0}
.native-fixture [data-conversation-scroll]{display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto}
.native-fixture [data-slot="conversation.session"]{display:block}
.native-fixture [data-conversation-region="composer"]{position:sticky;bottom:0;padding:12px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.native-fixture textarea{box-sizing:border-box;width:100%;min-height:116px;resize:none;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:18px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;outline-offset:2px}
.native-fixture article{margin:22px;color:var(--dsw-alias-label-primary);line-height:1.8}
.native-fixture p{margin:0 0 16px}
`;
const pageSource = `(function(){
const React = Object.assign({}, ReactLite.React, {useSyncExternalStore:(subscribe,getSnapshot)=>{const pair=ReactLite.React.useState(getSnapshot);ReactLite.React.useEffect(()=>subscribe(()=>pair[1](getSnapshot())),[subscribe,getSnapshot]);return pair[0];}});
const Module = (function(require){${body}\nreturn {VideoWorkspace, ZH};})(()=>React);
const h=React.createElement;
const translate = key=>Module.ZH[key] || key;
const projectId='proj-ui-01';
const sessionId='session-ui-01';
const sessions={list:{getSnapshot:()=>({projectionsBySession:{[sessionId]:{values:{title:'夜行 · 创作 1'}}}}),subscribe:()=>()=>{}},retain:()=>({binding:{session:{getSnapshot:()=>({openState:'open'}),subscribe:()=>()=>{}}},ready:Promise.resolve({session:{getSnapshot:()=>({openState:'open'}),subscribe:()=>()=>{}}}),release(){}})};
function Provider(p){return p.children;}
function NativeFixture(){return h('div',{className:'native-fixture','data-slot':'conversation.content'},h('div',{'data-conversation-content':'','data-content-phase':'active'},h('div',{'data-conversation-scroll':''},h('div',{'data-slot':'conversation.session',id:'transcript'}),h('div',{'data-conversation-region':'composer'},h('textarea',{'aria-label':'创作指令',placeholder:'想做一支什么样的视频？'})))));}
window.uiRoot=ReactLite.createRoot(document.getElementById('mount'));
uiRoot.render(h(Module.VideoWorkspace,{t:translate,onBack(){},sessions,SessionProvider:Provider,renderFactorySlot:()=>h(NativeFixture)}));
window.longConversation=()=>{const el=document.getElementById('transcript');el.innerHTML=Array.from({length:30},(_,i)=>'<article><p>第 '+(i+1)+' 轮创作</p><p>保留原有画面，调整色彩与节奏。</p></article>').join('');};
})();`;
const theme = `
:root{--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#f7f7f5;--dsw-alias-bg-overlay:#fff;--dsw-alias-label-primary:#202124;--dsw-alias-label-secondary:#73777f;--dsw-alias-label-tertiary:#8b8e94;--dsw-alias-border-l1:#e4e5e7;--dsw-alias-interactive-bg-hover:#f0f0ef;--dsw-alias-state-error-primary:#c2383e;--dsw-focus-ring-color:#4578dd}
html[data-theme=dark]{--dsw-alias-bg-base:#19191b;--dsw-alias-bg-layer-1:#232326;--dsw-alias-bg-overlay:#27272b;--dsw-alias-label-primary:#eeeef0;--dsw-alias-label-secondary:#aaaab2;--dsw-alias-label-tertiary:#878790;--dsw-alias-border-l1:#3b3b40;--dsw-alias-interactive-bg-hover:#303035;--dsw-alias-state-error-primary:#ff9196}
`;
const server = createServer(async (req,res)=>{
  try {
    const url = new URL(req.url,'http://localhost');
    if (url.pathname==='/') { res.setHeader('content-type','text/html');res.end('<!doctype html><html><meta charset="utf-8"><style>'+theme+fixtureCSS+css+'</style><div id="mount"></div><script src="/lite.js"></script><script src="/page.js"></script></html>'); }
    else if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();}
    else if(url.pathname==='/lite.js'){res.setHeader('content-type','text/javascript');res.end(lite);}
    else if(url.pathname==='/page.js'){res.setHeader('content-type','text/javascript');res.end(pageSource);}
    else if(url.pathname==='/runtime.js'){res.setHeader('content-type','text/javascript');res.end(CANVAS_RUNTIME_SOURCE);}
    else if(url.pathname==='/preview/assets/gsap.min.js'){res.setHeader('content-type','text/javascript');res.end(gsap);}
    else if(url.pathname==='/preview/index.html'){
      const runtime='<script src="/runtime.js?v=1&'+url.searchParams.toString()+'"></script>';
      res.setHeader('content-type','text/html');res.end((portrait?genreB():genreA()).html.replace('</body>',runtime+'</body>'));
    }
    else if(url.pathname==='/case/portrait'){portrait=true;res.end('ok');}
    else if(url.pathname==='/api/dsh-video/request'){
      let raw='';for await(const c of req)raw+=c;
      const {method,params}=JSON.parse(raw);
      const revision=(portrait?'b':'a').repeat(64);
      const inspected={projectId:'proj-ui-01',revision,width:portrait?720:1280,height:portrait?1280:720,duration:portrait?5:6,scenes:[{sceneId:'scene-1',title:'夜行 · Night Line'}],elements:[],files:[]};
      let result;
      if(method==='project.list')result={projects:[{projectId:'proj-ui-01',updatedAt:2},{projectId:'proj-ui-02',updatedAt:1}],defaultProjectId:'proj-ui-01'};
      else if(method==='open'||method==='inspect')result=inspected;
      else if(method==='session.list')result={enabled:true,contract:1,projectId:params.projectId,activeSessionId:'session-ui-01',sessions:[{sessionId:'session-ui-01',status:'available'}]};
      else if(method==='session.diagnose')result={enabled:true,contract:1};
      else if(method==='preview.snapshot')result={snapshotId:(portrait?'2':'1').repeat(32),revision,entryUrl:'/preview/index.html'};
      else if(method==='preview.release')result={released:true};
      else throw new Error('Unexpected method '+method);
      res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,result}));
    } else {res.statusCode=404;res.end('not found');}
  }catch(e){res.statusCode=500;res.end(JSON.stringify({ok:false,error:{code:'E_TEST',message:e.message}}));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try {
  browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
  const page=await browser.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',msg=>{if(msg.type()==='error'||msg.text().includes('preview'))console.log('browser:',msg.text());});
  await page.setViewport({width:1440,height:960,deviceScaleFactor:1});
  await page.goto(origin,{waitUntil:'networkidle0'});
  await page.waitForSelector('.dv-canvas-shell[data-canvas-phase="ready"]',{timeout:10000}).catch(async e=>{await page.screenshot({path:join(out,'failure.png')});console.log(await page.evaluate(()=>({text:document.body.innerText,html:document.querySelector('.dv-canvas-shell')?.outerHTML,frames:[...document.querySelectorAll('iframe')].map(x=>x.src)})));for(const f of page.frames().slice(1)){console.log('frame debug',await f.evaluate(()=>({body:document.body.innerText,timeline:!!window.__timelines,script:[...document.scripts].map(s=>s.src),messages:window.__debugMessages})));}throw e;});
  async function geometry(){return page.evaluate(()=>{
    const rect=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    return {top:rect('.dv-topbar'),wrap:rect('.dv-canvas-wrap'),stage:rect('.dv-canvas-stage'),controls:rect('.dv-canvas-bar'),composer:rect('[data-conversation-region="composer"]'),ai:rect('.dv-ai'),root:rect('.dv-root'),scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth};
  });}
  async function shot(name){const path=join(out,name+'.png');await page.screenshot({path});screenshots.push(path);}
  let g=await geometry();
  check('SVG controls render in the SVG namespace',await page.$eval('.dv-play svg',e=>e.namespaceURI==='http://www.w3.org/2000/svg' && e.getAttribute('viewBox')==='0 0 24 24'),null);
  check('compact single navigation row',g.top.height<=64,g.top);
  check('transport sits below the full frame',g.controls.y>=g.stage.bottom,g);
  check('composition is centered inside its stage area',Math.abs((g.wrap.x+g.wrap.width/2)-(g.stage.x+g.stage.width/2))<2 && Math.abs((g.wrap.y+g.wrap.height/2)-(g.stage.y+g.stage.height/2))<2,g);
  check('native composer reaches the bottom with an empty transcript',Math.abs(g.ai.bottom-g.composer.bottom)<3,g);
  check('no technical ID in visible navigation',await page.$eval('.dv-project-picker select',e=>!e.selectedOptions[0].textContent.includes('proj-')),null);
  await page.$eval('.dv-seek',e=>{e.value='2.5';e.dispatchEvent(new Event('input',{bubbles:true}));});
  await new Promise(r=>setTimeout(r,100));
  await shot('01-light-landscape');
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');await shot('02-dark-landscape');
  await page.evaluate(()=>{document.documentElement.dataset.theme='light';window.longConversation();});
  g=await geometry();check('native composer remains visible with a long transcript',g.composer.bottom<=g.ai.bottom+2 && g.composer.y>g.ai.y+40,g);
  await shot('03-long-conversation');
  await page.setViewport({width:1000,height:760,deviceScaleFactor:1});await new Promise(r=>setTimeout(r,150));
  g=await geometry();check('narrow desktop fits without horizontal overflow',g.scrollWidth===g.viewport && g.controls.right<g.ai.x,g);await shot('04-narrow');
  await page.setViewport({width:600,height:900,deviceScaleFactor:1});await new Promise(r=>setTimeout(r,150));
  g=await geometry();check('small workspace stacks preview and conversation without overlap',g.controls.bottom<=g.ai.y+2 && g.composer.bottom<=900 && g.composer.height>100,g);await shot('05-small');
  await page.setViewport({width:1440,height:960,deviceScaleFactor:1});
  await page.evaluate(()=>fetch('/case/portrait'));
  await page.waitForFunction(()=>document.querySelector('.dv-canvas-shell')?.dataset.canvasRevision==='b'.repeat(64),{timeout:8000});
  g=await geometry();check('portrait preview preserves its aspect and fits',Math.abs(g.stage.width/g.stage.height-720/1280)<.002 && g.stage.height<=g.wrap.height+1,g);await shot('06-portrait');
  await page.click('.dv-play');await new Promise(r=>setTimeout(r,250));
  check('icon playback remains operable',await page.$eval('.dv-play',e=>e.getAttribute('aria-label')==='暂停'),null);
  await page.keyboard.press('Tab');check('keyboard can reach the seek control',await page.evaluate(()=>document.activeElement.classList.contains('dv-seek')),null);
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  check('reduced motion removes the loading animation',await page.evaluate(()=>{const e=document.createElement('span');e.className='dv-loader';document.querySelector('.dv-root').append(e);const a=getComputedStyle(e).animationName;e.remove();return a==='none';}),null);
  await page.click('.dv-display > button');await page.click('.dv-menu-item');
  check('simplified effects disable glass',await page.$eval('.dv-canvas-bar',e=>getComputedStyle(e).backdropFilter==='none'),null);
  check('no browser exceptions',errors.length===0,errors);
} finally {
  if(browser)await browser.close();await new Promise(r=>server.close(r));
  const evidence={kind:'ui-polish-component-browser',note:'Real product components/CSS/runtime in Chrome; Host and native Conversation DOM are contract fixtures. Not DSH/model acceptance.',clientSha256:createHash('sha256').update(source).digest('hex'),checks,errors,screenshots,ok:checks.length>0 && checks.every(c=>c.pass)};
  await writeFile(join(out,'evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({ok:evidence.ok,passed:checks.filter(c=>c.pass).length,total:checks.length,out}));
}
