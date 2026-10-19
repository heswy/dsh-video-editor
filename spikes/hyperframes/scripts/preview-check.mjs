import puppeteer from 'puppeteer-core';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { browserPath, artifacts } from './paths.mjs';
const profile = await mkdtemp(resolve(artifacts, 'preview-browser-'));
const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, userDataDir: profile,
  args: ['--disable-gpu', '--disable-background-networking', '--no-first-run'], defaultViewport: { width: 1440, height: 1000 } });
try {
  const page = await browser.newPage();
  const errors = [];
  const blockedRequests = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setRequestInterception(true);
  page.on('request', request => {
    const u = request.url();
    if (u.startsWith('http://localhost:4567/') || u.startsWith('data:') || u.startsWith('blob:')) request.continue();
    else { blockedRequests.push(u); request.abort(); }
  });
  await page.goto('http://localhost:4567/#project/project', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.body.innerText.includes('Timeline'), { timeout: 30000 }).catch(() => {});
  const frame = await page.waitForFrame(f => f.url().includes('/preview?'), { timeout: 60000 });
  await frame.waitForFunction(() => window.__renderReady && window.__player, { timeout: 60000 });
  const preview = await frame.evaluate(async () => {
    const samples = [];
    for (const t of [0.5, 1, 2.5, 4.5]) {
      window.__player.renderSeek(t, { exact: true });
      await window.__hfWaitForSeekCompletion?.({ videoFrames: true });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const el = document.querySelector('#title');
      const r = document.createRange(); r.selectNodeContents(el);
      const box = r.getBoundingClientRect();
      const style = getComputedStyle(el);
      samples.push({ time: t, text: el.textContent, display: style.display, visibility: style.visibility,
        opacity: style.opacity, box: { x: box.x, y: box.y, width: box.width, height: box.height },
        fontLoaded: document.fonts.check('72px SpikeHeiti') });
    }
    window.__player.renderSeek(0, { exact: true });
    const orb = document.querySelector('#orb');
    const initial = getComputedStyle(orb).transform;
    window.__player.play();
    await new Promise(r => setTimeout(r, 450));
    window.__player.pause();
    const advanced = getComputedStyle(orb).transform !== initial;
    window.__player.renderSeek(2.5, { exact: true });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { duration: window.__hf?.duration, samples, playback: { advanced } };
  });
  console.log(JSON.stringify(preview));
  await page.screenshot({ path: resolve(artifacts, 'studio-preview.png') });
  const report = { title: await page.title(), text: (await page.$eval('body', el=>el.innerText)).slice(0,12000),
    blockedRequests, preview, frames: page.frames().map(f => ({ url: f.url(), name: f.name() })), errors };
  await writeFile(resolve(artifacts, 'preview-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); await rm(profile, { recursive: true, force: true }); }
