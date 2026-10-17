#!/usr/bin/env node
/**
 * P2-005 A-spike evidence runner.
 *
 * Serves one controlled project snapshot + the fixed HyperFrames runtime to a
 * sandboxed cross-origin iframe, then drives it with real Chrome. After the
 * snapshot has loaded the browser is put offline; every seek/play operation and
 * screenshot below is produced with the network disabled.
 *
 * This is a dev-only feasibility prototype, not the plugin implementation.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { startPreviewServer } from './server.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RUNTIME = join(ROOT, 'node_modules', '@hyperframes', 'core', 'dist', 'hyperframe.runtime.iife.js');
const DEFAULT_OUT = join(ROOT, 'evidence');

function usage(message) {
  if (message) console.error(message);
  console.error('usage: node run.mjs --fixture <controlled project dir> --chrome <chrome executable> [--runtime <iife.js>] [--out <evidence dir>]');
  process.exit(2);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--fixture' || key === '--chrome' || key === '--runtime' || key === '--out') {
      const value = argv[index + 1];
      if (value === undefined) usage(`missing value for ${key}`);
      args[key.slice(2)] = value;
      index += 1;
    } else usage(`unknown argument ${key}`);
  }
  if (!args.fixture || isAbsolute(args.fixture) === false) usage('--fixture must be absolute');
  if (!args.chrome || isAbsolute(args.chrome) === false) usage('--chrome must be absolute');
  if (args.runtime !== undefined && isAbsolute(args.runtime) === false) usage('--runtime must be absolute');
  if (args.out !== undefined && isAbsolute(args.out) === false) usage('--out must be absolute');
  return args;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixture = resolve(args.fixture);
  const chrome = args.chrome;
  const runtime = args.runtime === undefined ? DEFAULT_RUNTIME : args.runtime;
  const out = args.out === undefined ? DEFAULT_OUT : args.out;
  await mkdir(out, { recursive: true });
  const evidence = {
    kind: 'p2-005-preview-spike',
    startedAt: new Date().toISOString(),
    fixture,
    runtime,
    chrome,
    runtimeSha256: sha256(await readFile(runtime)),
    fixtureEntrySha256: sha256(await readFile(join(fixture, 'index.html'))),
    sandbox: 'allow-scripts',
    offlineAfterLoad: true,
    blockedExternalRequests: [],
    seeks: [],
    errors: [],
  };
  let server;
  let browser;
  let page;
  const loadStartedAt = Date.now();
  try {
    server = await startPreviewServer({ fixture, runtime });
    evidence.url = server.url;
    evidence.fixtureProject = server.project;
    evidence.snapshotCsp = {
      script: `'unsafe-inline' http://127.0.0.1:${server.port}`,
      font: `http://127.0.0.1:${server.port}`,
      connect: "'none'",
      intent: 'opaque-origin sandbox iframe, no host/plugin API, no arbitrary snapshot paths',
    };
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
    });
    evidence.browser = { version: await browser.version(), userAgent: await browser.userAgent() };
    page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      let hostname = '';
      try {
        hostname = new URL(request.url()).hostname;
      } catch (_error) {
        hostname = '';
      }
      if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '') request.continue();
      else {
        evidence.blockedExternalRequests.push(request.url());
        request.abort();
      }
    });
    await page.goto(server.url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.spike && window.spike.ready === true, { timeout: 30000 });
    evidence.readyElapsedMs = Date.now() - loadStartedAt;
    await page.waitForFunction(() => window.spike && window.spike.assetsReady === true, { timeout: 30000 }).catch(() => {
      evidence.errors.push('assets-ready timed out; playback/seek was still exercised');
    });
    evidence.assetsElapsedMs = Date.now() - loadStartedAt;
    evidence.readyState = await page.evaluate(() => ({
      ready: window.spike.ready,
      assetsReady: window.spike.assetsReady,
      iframeSandbox: window.spike.iframeSandbox,
      iframeSrc: window.spike.iframeSrc,
      logCount: window.spike.logs.length,
      diagnostics: window.spike.diagnostics,
    }));
    evidence.sandboxProbe = await page.evaluate(() => {
      const frame = document.getElementById('preview');
      let access = 'blocked';
      try {
        if (frame.contentDocument !== null) access = 'READABLE';
      } catch (error) {
        access = 'throws:' + (error && error.name ? error.name : 'Error');
      }
      return { access, parentOrigin: location.origin, sandbox: frame.getAttribute('sandbox'), contentWindowOrigin: (() => { try { return frame.contentWindow.origin; } catch (_error) { return 'opaque'; } })() };
    });

    const cdp = await page.target().createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await sleep(150);
    evidence.network = await page.evaluate(() => ({ online: navigator.onLine }));

    async function latestState() {
      return page.evaluate(() => {
        const states = window.spike.states;
        return states.length > 0 ? states[states.length - 1] : null;
      });
    }

    async function seek(timeSeconds, label) {
      const startedAt = Date.now();
      await page.evaluate((time) => window.spike.send({ action: 'seek', timeSeconds: time, seekMode: 'commit' }), timeSeconds);
      await page.waitForFunction((expected) => {
        const states = window.spike.states;
        const latest = states[states.length - 1];
        return latest !== undefined && Math.abs(latest.currentTime - expected) < 0.15;
      }, { timeout: 5000 }, timeSeconds).catch(() => {});
      await sleep(250);
      const state = await latestState();
      const stage = await page.$('iframe');
      const file = join(out, `seek-${label}.png`);
      await stage.screenshot({ path: file });
      const bytes = await readFile(file);
      evidence.seeks.push({ requestedTime: timeSeconds, state, elapsedMs: Date.now() - startedAt, screenshot: file, screenshotSha256: sha256(bytes), screenshotBytes: bytes.length });
      return state;
    }

    await seek(0.5, '0.5s');
    await seek(2.5, '2.5s');
    await seek(4.5, '4.5s');

    // Seek back to the start, then play for a bounded interval while offline.
    await page.evaluate(() => window.spike.send({ action: 'seek', timeSeconds: 0, seekMode: 'commit' }));
    await sleep(150);
    await page.click('#play');
    await sleep(900);
    const playingState = await latestState();
    await page.click('#pause');
    await sleep(150);
    const pausedState = await latestState();
    evidence.playback = { playingState, pausedState };
    const stage = await page.$('iframe');
    const playFile = join(out, 'playback-paused.png');
    await stage.screenshot({ path: playFile });
    const playBytes = await readFile(playFile);
    evidence.playback.screenshot = playFile;
    evidence.playback.screenshotSha256 = sha256(playBytes);
    evidence.playback.screenshotBytes = playBytes.length;

    // Observe whether the player seeks/plays while offline (state messages are
    // produced by the runtime and cannot be forged by the parent page).
    evidence.seekStateObserved = evidence.seeks.every((entry) => entry.state !== null);
    evidence.expectedTimes = [0.5, 2.5, 4.5];
    evidence.observedTimes = evidence.seeks.map((entry) => entry.state === null ? null : entry.state.currentTime);
    evidence.playAdvanced = playingState !== null && playingState.currentTime > 0;
    evidence.finalLogs = await page.evaluate(() => window.spike.logs.slice(-40));
    evidence.serverRequests = server.serverRequests.slice();
    evidence.externalRequestCount = evidence.blockedExternalRequests.length;
    evidence.ok = evidence.readyState.ready && evidence.network.online === false && evidence.sandboxProbe.access !== 'READABLE' && evidence.seekStateObserved && evidence.observedTimes.every((time, index) => time !== null && Math.abs(time - evidence.expectedTimes[index]) < 0.15);
  } catch (error) {
    evidence.errors.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    evidence.ok = false;
  } finally {
    if (page !== undefined) {
      try {
        evidence.finalLogs = await page.evaluate(() => window.spike === undefined ? null : window.spike.logs.slice(-40));
      } catch (_error) {
        /* page may already be gone */
      }
    }
    if (browser !== undefined) await browser.close().catch(() => {});
    if (server !== undefined) await server.close().catch(() => {});
    evidence.finishedAt = new Date().toISOString();
    const evidenceFile = join(out, 'offline-seek.json');
    await writeFile(evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ evidence: evidenceFile, ok: evidence.ok === true, browser: evidence.browser, url: evidence.url, seekTimes: evidence.observedTimes, externalRequestCount: evidence.externalRequestCount }, null, 2));
    if (evidence.ok !== true) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`preview spike failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
