#!/usr/bin/env node
/**
 * Local, zero-dependency pre-install checks for the dsh-video bundle.
 *
 * Verifies that package.json, cordis.patch.yml, the two plugin halves and the
 * shipped files agree with each other and with the browser module format. This is
 * a static check only: it does not install, enable or execute anything inside DSH.
 *
 * Run: node scripts/check.mjs   (or npm run check)
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const passes = [];

function check(name, fn) {
  try {
    const detail = fn();
    passes.push([name, detail === undefined ? 'ok' : String(detail)]);
  } catch (error) {
    failures.push([name, error instanceof Error ? error.message : String(error)]);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
  return existsSync(join(ROOT, relativePath));
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

/** Match a package.json `files` entry, which may contain one simple `*` glob. */
function listMatchingFiles(pattern) {
  if (!pattern.includes('*')) return exists(pattern) ? [pattern] : [];
  const star = pattern.indexOf('*');
  const directory = pattern.slice(0, star).replace(/\/$/, '');
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (directory === '' || !exists(directory) || !statSync(join(ROOT, directory)).isDirectory()) return [];
  return readdirSync(join(ROOT, directory))
    .map((name) => `${directory}/${name}`)
    .filter((candidate) => candidate.startsWith(prefix) && candidate.endsWith(suffix) && exists(candidate));
}

const pkg = readJson('package.json');
const clientSource = read('client.js');
const hostSource = read('index.js');
const patchSource = read('cordis.patch.yml');
const readme = read('README.md');

const moduleIdMatch = clientSource.match(/__ModuleLoader__\.load\(\{\s*\n?\s*id:\s*['"]([^'"]+)['"]/);
const moduleId = moduleIdMatch === null ? undefined : moduleIdMatch[1];

check('package name identifies one unique bundle', () => {
  assert(typeof pkg.name === 'string' && /^[a-z0-9][a-z0-9._-]*$/.test(pkg.name), 'package name is missing or not a plain lowercase package id');
  assert(pkg.private === true, 'expected "private": true for a locally delivered bundle');
  return pkg.name;
});

check('client module id equals package name', () => {
  assert(moduleId !== undefined, 'window.__ModuleLoader__.load({ id: ... }) id not found in client.js');
  assert(moduleId === pkg.name, `client id "${moduleId}" !== package name "${pkg.name}"`);
  return moduleId;
});

check('client half uses the browser module format', () => {
  assert(/window\.__ModuleLoader__\.load\(\{/.test(clientSource), 'missing window.__ModuleLoader__.load registration');
  assert(/factory\s*(?:\(\s*require\s*\)|:\s*\(?\s*require\s*\)?\s*=>)/.test(clientSource), 'factory(require) not found');
  assert(/^\s*import\s+/m.test(clientSource) === false, 'client bundle must not use ESM import');
  assert(/^\s*export\s+/m.test(clientSource) === false, 'client bundle must not use ESM export');
  return 'load/factory present, no ESM syntax';
});

check('client half imports only the platform seed module', () => {
  const allowed = new Set(['react']);
  const specifiers = [...clientSource.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]);
  assert(specifiers.length > 0, 'client.js never requires react');
  for (const specifier of specifiers) {
    assert(allowed.has(specifier), `unexpected external require("${specifier}"); allowlist: ${[...allowed].join(', ')}`);
  }
  return [...new Set(specifiers)].join(', ');
});

check('client half avoids forbidden host surfaces', () => {
  const forbidden = [
    ['document.body', 'must not touch document.body'],
    ['querySelector', 'must not read host DOM geometry'],
    ['@deepseek-ai/', 'must not import internal DSH client packages'],
    ['session/event', 'must not publish session events'],
  ];
  for (const [needle, reason] of forbidden) {
    assert(clientSource.includes(needle) === false, `client.js contains "${needle}": ${reason}`);
  }
  return 'no document.body / host DOM reads / internal imports / session events';
});

check('host half exports a Cordis plugin body', () => {
  assert(/export\s+function\s+apply\s*\(/.test(hostSource), 'index.js must export function apply()');
  assert(/@deepseek-ai\//.test(hostSource) === false, 'index.js must not import @deepseek-ai/* (profile path packages cannot resolve them)');
  return 'apply() present, node builtins only';
});

check('bundle manifest declares patch and client', () => {
  assert(pkg.dsh && typeof pkg.dsh === 'object', 'missing dsh manifest block');
  assert(pkg.dsh.manifestVersion === 1, 'dsh.manifestVersion must be 1');
  assert(pkg.dsh.bundle && pkg.dsh.bundle.patch === './cordis.patch.yml', 'dsh.bundle.patch must point at ./cordis.patch.yml');
  assert(pkg.dsh.client && pkg.dsh.client.platform === 'web', 'dsh.client.platform must be "web"');
  assert(pkg.dsh.client.immediately === true, 'dsh.client.immediately should be true so the capsule exists before first navigation');
  assert(Array.isArray(pkg.dsh.client.inject), 'dsh.client.inject must be an array');
  for (const entry of pkg.dsh.client.inject) assert(typeof entry === 'string', 'dsh.client.inject entries must be package names');
  return `platform=web, inject=[${pkg.dsh.client.inject.join(', ')}]`;
});

check('patch inserts exactly one dsh-video row', () => {
  assert(/^-\s*insert:\s*$/m.test(patchSource), 'cordis.patch.yml must contain an "insert:" list');
  const rowIds = [...patchSource.matchAll(/^\s*-\s*id:\s*['"]?([^'"\s#]+)['"]?\s*$/gm)].map((match) => match[1]);
  assert(rowIds.length === 1, `expected exactly one row id, found ${rowIds.length}`);
  assert(rowIds[0] === pkg.name, `row id "${rowIds[0]}" !== package name "${pkg.name}"`);
  const names = [...patchSource.matchAll(/^\s+name:\s*['"]?([^'"\s#]+)['"]?\s*$/gm)].map((match) => match[1]);
  assert(names.length === 1 && names[0] === pkg.name, `row name must be "${pkg.name}", found [${names.join(', ')}]`);
  return `row id=${rowIds[0]}, name=${names[0]}`;
});

check('entrypoints and exports resolve to shipped files', () => {
  const rawTargets = [pkg.main];
  for (const value of Object.values(pkg.exports || {})) {
    rawTargets.push(typeof value === 'string' ? value : value && value.default);
  }
  const checked = new Set();
  for (const rawTarget of rawTargets) {
    assert(typeof rawTarget === 'string' && rawTarget.length > 0, `bad export target: ${String(rawTarget)}`);
    const target = rawTarget.startsWith('./') ? rawTarget : `./${rawTarget}`;
    if (target.includes('*')) {
      const matches = listMatchingFiles(target.slice(2));
      assert(matches.length > 0, `export wildcard "${target}" matches no file`);
      checked.add(`${target} -> ${matches.length} file(s)`);
    } else {
      assert(exists(target.slice(2)), `export target "${target}" does not exist`);
      checked.add(target);
    }
  }
  assert(exists('index.js'), 'index.js missing');
  assert(exists('client.js'), 'client.js missing');
  return `${checked.size} export target(s)`;
});

check('package files list covers every shipped artifact', () => {
  assert(Array.isArray(pkg.files) && pkg.files.length > 0, 'package.json needs a files list for a reproducible install');
  const required = ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'locale/en.json', 'locale/zh.json', 'README.md'];
  for (const artifact of required) {
    const covered = pkg.files.some((pattern) => listMatchingFiles(pattern).includes(artifact));
    assert(covered, `files list does not cover required artifact "${artifact}"`);
  }
  const extra = ['scripts/check.mjs', 'scripts/smoke-client.mjs'];
  for (const tool of extra) {
    assert(exists(tool), `local check tool "${tool}" is missing from the workspace`);
    const packaged = pkg.files.some((pattern) => listMatchingFiles(pattern).includes(tool));
    assert(packaged === false, `"${tool}" must not be packaged into the installable bundle`);
  }
  return `${pkg.files.length} pattern(s)`;
});

check('icon is a local file within the size limit', () => {
  assert(pkg.icon === './icon.svg', 'package.json icon must be "./icon.svg"');
  assert(exists('icon.svg'), 'icon.svg missing');
  const size = statSync(join(ROOT, 'icon.svg')).size;
  assert(size <= 256 * 1024, `icon is ${size} bytes, limit is 262144`);
  assert(/<svg[\s>]/.test(read('icon.svg')), 'icon.svg is not an SVG document');
  return `${size} bytes`;
});

check('locale files carry display metadata', () => {
  for (const locale of ['en', 'zh']) {
    const document = readJson(`locale/${locale}.json`);
    assert(document.meta && typeof document.meta === 'object', `locale/${locale}.json needs a meta object`);
    assert(typeof document.meta.title === 'string' && document.meta.title.length > 0, `locale/${locale}.json meta.title missing`);
    assert(typeof document.meta.description === 'string' && document.meta.description.length > 0, `locale/${locale}.json meta.description missing`);
    assert(Object.keys(document).length === 1, `locale/${locale}.json should only contain display metadata (UI strings live in client.js)`);
  }
  return 'en + zh';
});

check('README documents install, disable and rollback', () => {
  for (const needle of ['安装', '停用', '回滚']) {
    assert(readme.includes(needle), `README must document ${needle} steps`);
  }
  assert(readme.includes('dsh-video'), 'README must name the bundle');
  return 'install / disable / rollback sections present';
});

check('locale dictionaries and used keys agree', () => {
  function dictionaryKeys(declaration) {
    const start = clientSource.indexOf(`const ${declaration} = {`);
    const end = clientSource.indexOf('\n    };', start);
    assert(start >= 0 && end > start, `${declaration} dictionary block not found`);
    const block = clientSource.slice(start, end);
    return new Set([...block.matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1]));
  }
  const zh = dictionaryKeys('ZH');
  const en = dictionaryKeys('EN');
  assert(zh.size > 0 && en.size > 0, 'locale dictionaries are empty');
  const missingEn = [...zh].filter((key) => en.has(key) === false);
  const missingZh = [...en].filter((key) => zh.has(key) === false);
  assert(missingEn.length === 0, `EN is missing keys: ${missingEn.join(', ')}`);
  assert(missingZh.length === 0, `ZH is missing keys: ${missingZh.join(', ')}`);
  const used = new Set([...clientSource.matchAll(/\bt\('([^']+)'\)/g)].map((match) => match[1]));
  const missing = [...used].filter((key) => zh.has(key) === false);
  assert(missing.length === 0, `t() keys missing from dictionaries: ${missing.join(', ')}`);
  return `${zh.size} keys used in both languages (${used.size} referenced)`;
});

check('component class names exist in the stylesheet', () => {
  const declared = new Set([...clientSource.matchAll(/\.(dv-[a-z0-9-]+)/g)].map((match) => match[1]));
  const used = new Set([...clientSource.matchAll(/className:\s*'([^']+)'/g)].map((match) => match[1]));
  assert(used.size > 0, 'no className strings found');
  const missing = [...used].filter((name) => declared.has(name) === false);
  assert(missing.length === 0, `class names without CSS rules: ${missing.join(', ')}`);
  return `${used.size} class names, ${declared.size} styled`;
});

check('inline stylesheet is structurally sane', () => {
  const start = clientSource.indexOf('const CSS = `');
  const end = clientSource.indexOf('`;\n\n    /** One style element', start);
  assert(start >= 0 && end > start, 'CSS template literal not found');
  const css = clientSource.slice(start, end);
  assert(css.includes('${') === false, 'CSS template literal contains ${} interpolation');
  let depth = 0;
  for (const character of css) {
    if (character === '{') depth += 1;
    else if (character === '}') depth -= 1;
    assert(depth >= 0, 'unbalanced CSS closing brace');
  }
  assert(depth === 0, `unbalanced CSS braces (depth ${depth})`);
  for (const token of ['--dsw-alias-', '--dsh-frame-leading-clearance', 'prefers-reduced-motion']) {
    assert(css.includes(token), `stylesheet is missing expected token/guard "${token}"`);
  }
  return `${Math.round(css.length / 1024)} KiB CSS, balanced braces`;
});

check('R3: capsule text and space scale with the host content font size', () => {
  assert(
    /\.dv-mode\{[^}]*font-size:var\(--dsh-content-font-size/.test(clientSource),
    '.dv-mode must derive its font size from --dsh-content-font-size'
  );
  assert(
    /\.dv-mode-btn\{[^}]*font-size:\.93em/.test(clientSource),
    '.dv-mode-btn must size text relative to the capsule (em), not a fixed px value'
  );
  assert(clientSource.includes('font-size:13px') === false, 'mode text must not be pinned to 13px');
  assert(clientSource.includes('font-size:12.5px') === false, 'narrow layout must not shrink navigation text');
  assert(
    clientSource.includes('--dv-mode-width:clamp(176px, 13.5em, 248px)'),
    'capsule width must scale with the host font size within clamps'
  );
  assert(
    clientSource.includes('--dv-mode-height:clamp(40px, 2.86em, 56px)'),
    'capsule height must scale with the host font size within clamps'
  );
  return 'host-font-derived text, em-based capsule, clamped bounds';
});

check('R2: slide motion is a consumable hint, not a second mode source', () => {
  assert(clientSource.includes('thumbOrigin'), 'missing short-lived presentation hint');
  assert(clientSource.includes("'data-thumb': thumbAt"), 'capsule must expose the visual thumb position separately');
  assert(clientSource.includes('.dv-mode[data-thumb="video"] .dv-mode-thumb'), 'thumb transform must key on the visual position');
  assert(clientSource.includes('motionAllowed()'), 'motion must be gated by simplified effects / reduced motion');
  assert(clientSource.includes('animation:dv-fade-in 140ms') === false, 'repeat intro must not hard-code 140ms');
  assert(
    clientSource.includes('animation:dv-fade-in var(--dv-dur-med)') || clientSource.includes('animation:dv-fade-in var('),
    'repeat intro must use the motion tokens'
  );
  assert(clientSource.includes('transition:color var(--dv-dur-fast)'), 'button transitions must use the motion tokens');
  return 'consumable origin hint, token-based timing';
});

check('R1: entry availability is chained to the main declaration lifetime', () => {
  const applyStart = clientSource.indexOf('function apply(ctx)');
  const applyEnd = clientSource.indexOf('return { inject: inject, apply: apply }');
  assert(applyStart >= 0 && applyEnd > applyStart, 'apply body not found');
  const applyBody = clientSource.slice(applyStart, applyEnd);
  assert(applyBody.includes("ctx.slots.inject('main'"), 'main registration not found');
  const entryStart = applyBody.indexOf('function registerMainAndEntry()');
  assert(entryStart >= 0, 'missing declaration-scoped registration entry point');
  const entryEnd = applyBody.indexOf('mainController = ctx.slots.inject', entryStart);
  assert(entryEnd > entryStart, 'main registration call site not found');
  const entryBody = applyBody.slice(entryStart, entryEnd);
  assert(
    entryBody.includes("ctx.slots.inject('conversation.header.leading'"),
    'leading registration must be chained inside the main registration path'
  );
  assert(entryBody.includes('ctx.slots.register('), 'main entry registration missing from the declaration path');
  assert(applyBody.includes('leadingRegistered'), 'missing registration-success tracking for the entry');
  assert(applyBody.includes('leading-entry-unavailable'), 'missing unreachable-panel guard');
  return 'main -> leading chained per declaration';
});

check('mode wiring matches P0-002 contract', () => {
  assert(clientSource.includes("const PANEL_ID = 'dsh-video'"), 'main-panel key must be dsh-video');
  assert(clientSource.includes("'conversation.header.leading'"), 'normal-mode capsule must mount in conversation.header.leading');
  assert(clientSource.includes('selectPanel'), 'navigation must go through ctx.layout.selectPanel');
  assert(/activePanelId/.test(clientSource), 'selected mode must be derived from usePanelInfo.activePanelId');
  assert(clientSource.includes('sidebar.panellist') === false, 'P0-B must not add a sidebar entry');
  assert(clientSource.includes('shell.overlay') === false, 'P0-B must not use the overlay');
  return 'panel key, leading seat, host-derived selection, no sidebar/overlay';
});

for (const [name, detail] of passes) console.log(`PASS  ${name}${detail === 'ok' ? '' : `  [${detail}]`}`);
for (const [name, message] of failures) console.error(`FAIL  ${name}: ${message}`);

console.log(`\n${passes.length} passed, ${failures.length} failed`);
if (failures.length > 0) process.exitCode = 1;
