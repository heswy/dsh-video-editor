/**
 * Dev-only controlled-snapshot preview server for the P2-005 A spike.
 * NOT production: it serves one fixed fixture directory and one runtime file,
 * only for local Chrome evidence. Product integration would need a Host-owned
 * snapshot route with projectId+revision scoping.
 */
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ttc': 'font/collection',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

function inside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (rel.startsWith('..') === false && isAbsolute(rel) === false);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function parentHtml() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>P2-005 isolated preview spike</title>
<style>
html,body{margin:0;background:#15171a;color:#e8edf1;font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;}
main{display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px;}
header{display:flex;gap:8px;align-items:center;}
button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid #44515c;background:#232a30;color:inherit;cursor:pointer;}
button:hover{background:#2d363f;}
#stage{width:1280px;height:720px;border:1px solid #3a444e;border-radius:8px;overflow:hidden;background:#000;}
iframe{display:block;width:1280px;height:720px;border:0;}
#log{width:1280px;max-height:160px;overflow:auto;background:#0f1113;border:1px solid #2b333a;border-radius:6px;padding:8px;font:12px/1.45 ui-monospace,monospace;white-space:pre-wrap;}
</style></head><body><main>
<header><button id="play">Play</button><button id="pause">Pause</button><button id="seek05">Seek 0.5s</button><button id="seek25">Seek 2.5s</button><button id="seek45">Seek 4.5s</button><span id="status">loading</span></header>
<div id="stage"><iframe id="preview" title="isolated video preview" sandbox="allow-scripts" referrerpolicy="no-referrer" src="/snapshot/"></iframe></div>
<div id="log"></div>
<script>
(() => {
  const frame = document.getElementById('preview');
  const logElement = document.getElementById('log');
  const spike = {
    ready: false,
    assetsReady: false,
    iframeSandbox: frame.getAttribute('sandbox'),
    iframeSrc: frame.getAttribute('src'),
    logs: [],
    states: [],
    diagnostics: [],
    send(message) {
      frame.contentWindow.postMessage(Object.assign({ source: 'hf-parent', type: 'control' }, message), '*');
    },
  };
  window.spike = spike;
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== 'hf-preview') return;
    const copy = {};
    for (const key of ['source', 'type', 'code', 'currentTime', 'isPlaying', 'ended', 'durationSeconds', 'timedOut', 'message']) {
      if (data[key] !== undefined) copy[key] = data[key];
    }
    spike.logs.push(copy);
    if (data.type === 'ready') { spike.ready = true; document.getElementById('status').textContent = 'ready'; }
    if (data.type === 'assets-ready') spike.assetsReady = true;
    if (data.type === 'state') { spike.states.push(copy); document.getElementById('status').textContent = 't=' + copy.currentTime.toFixed(2) + (copy.isPlaying ? ' playing' : ' paused'); }
    if (data.type === 'diagnostic') spike.diagnostics.push(copy);
    logElement.textContent = JSON.stringify(spike.logs.slice(-12), null, 2);
  });
  document.getElementById('play').addEventListener('click', () => spike.send({ action: 'play' }));
  document.getElementById('pause').addEventListener('click', () => spike.send({ action: 'pause' }));
  document.getElementById('seek05').addEventListener('click', () => spike.send({ action: 'seek', timeSeconds: 0.5, seekMode: 'commit' }));
  document.getElementById('seek25').addEventListener('click', () => spike.send({ action: 'seek', timeSeconds: 2.5, seekMode: 'commit' }));
  document.getElementById('seek45').addEventListener('click', () => spike.send({ action: 'seek', timeSeconds: 4.5, seekMode: 'commit' }));
})();
</script>
</main></body></html>`;
}

export async function startPreviewServer(options) {
  const fixture = await realpath(options.fixture);
  const runtime = await realpath(options.runtime);
  const fixtureInfo = await stat(fixture);
  if (fixtureInfo.isDirectory() === false) throw new Error('fixture must be a directory');
  const project = JSON.parse(await readFile(join(fixture, 'project.json'), 'utf8'));
  if (project.entry !== 'index.html') throw new Error('spike only supports the controlled index.html entry');
  if (Array.isArray(project.assets) === false) throw new Error('fixture project.json needs an assets list');
  const allowed = new Set(['index.html', 'project.json', ...project.assets]);
  const entry = await readFile(join(fixture, project.entry), 'utf8');
  const serverRequests = [];

  let port = options.port || 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    const add = (status, type, bytes, extraHeaders) => {
      serverRequests.push({ path: pathname, status, type });
      response.writeHead(status, Object.assign({
        'content-type': type,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'access-control-allow-origin': '*',
        'cross-origin-resource-policy': 'cross-origin',
      }, extraHeaders || {}));
      response.end(bytes);
    };
    if (pathname === '/' || pathname === '/index.html') {
      const bytes = Buffer.from(parentHtml());
      add(200, MIME['.html'], bytes);
      return;
    }
    if (pathname === '/runtime/hyperframe.runtime.iife.js') {
      readFile(runtime).then((bytes) => add(200, MIME['.js'], bytes)).catch(() => add(404, 'text/plain', Buffer.from('not found')));
      return;
    }
    if (pathname === '/snapshot/' || pathname === '/snapshot/index.html') {
      const injected = entry.replace('</body>', '<script>window.__spikePreviewErrors = []; window.addEventListener("error", (event) => window.__spikePreviewErrors.push(String(event.message || event.error))); window.addEventListener("unhandledrejection", (event) => window.__spikePreviewErrors.push(String(event.reason)));</script><script src="/runtime/hyperframe.runtime.iife.js"></script></body>');
      const csp = [
        "default-src 'none'",
        `script-src 'unsafe-inline' http://127.0.0.1:${port}`,
        `style-src 'unsafe-inline' http://127.0.0.1:${port}`,
        `font-src http://127.0.0.1:${port}`,
        `img-src http://127.0.0.1:${port} data: blob:`,
        `media-src http://127.0.0.1:${port} blob:`,
        "connect-src 'none'",
        "frame-ancestors 'self'",
      ].join('; ');
      add(200, MIME['.html'], Buffer.from(injected), { 'content-security-policy': csp });
      return;
    }
    if (pathname.startsWith('/snapshot/')) {
      const rel = pathname.slice('/snapshot/'.length);
      const normalized = normalize(rel).split(sep).join('/');
      if (allowed.has(normalized) === false) {
        add(404, 'text/plain', Buffer.from('not found'));
        return;
      }
      const target = resolve(fixture, normalized);
      if (inside(fixture, target) === false) {
        add(403, 'text/plain', Buffer.from('forbidden'));
        return;
      }
      const type = MIME[extname(normalized).toLowerCase()] || 'application/octet-stream';
      readFile(target).then((bytes) => add(200, type, bytes)).catch(() => add(404, 'text/plain', Buffer.from('not found')));
      return;
    }
    add(404, 'text/plain', Buffer.from('not found'));
  });
  await new Promise((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));
  port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    fixture,
    runtime,
    project,
    serverRequests,
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  };
}
