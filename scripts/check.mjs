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

check('host half exports a Cordis plugin body and declares required services', () => {
  assert(/export\s+function\s+apply\s*\(/.test(hostSource), 'index.js must export function apply()');
  assert(/export\s+const\s+inject\s*=\s*\[\s*'connection'\s*,\s*'tools'\s*,\s*'subprocess'\s*\]/.test(hostSource), 'index.js must declare connection/tools/subprocess injection');
  assert(/@deepseek-ai\//.test(hostSource) === false, 'index.js must not import @deepseek-ai/* (profile path packages cannot resolve them)');
  for (const module of ['host/bridge.js', 'host/routes.js', 'host/tool.js', 'host/config.js', 'host/env.js', 'host/errors.js', 'host/engine.js', 'host/limits.js']) {
    assert(exists(module), `missing Host module ${module}`);
  }
  return 'apply(), inject, seven Host modules';
});

check('bundle manifest declares patch and client', () => {
  assert(pkg.dsh && typeof pkg.dsh === 'object', 'missing dsh manifest block');
  assert(pkg.dsh.manifestVersion === 1, 'dsh.manifestVersion must be 1');
  assert(pkg.dsh.bundle && pkg.dsh.bundle.patch === './cordis.patch.yml', 'dsh.bundle.patch must point at ./cordis.patch.yml');
  assert(pkg.dsh.client && pkg.dsh.client.platform === 'web', 'dsh.client.platform must be "web"');
  assert(pkg.dsh.client.immediately === true, 'dsh.client.immediately should be true so the sidebar entry registers before first navigation');
  assert(Array.isArray(pkg.dsh.client.inject), 'dsh.client.inject must be an array');
  for (const entry of pkg.dsh.client.inject) assert(typeof entry === 'string', 'dsh.client.inject entries must be package names');
  assert(
    pkg.dsh.client.inject.indexOf('@deepseek-ai/dsh-client-ui-conversation') === -1,
    'P0-005 no longer registers into the conversation header; drop the ui-conversation activation dependency'
  );
  return `platform=web, inject=[${pkg.dsh.client.inject.join(', ')}]`;
});

check('package version advanced for the P2-002-B fixed package', () => {
  assert(pkg.version === '0.2.0', `expected version 0.2.0, found "${pkg.version}"`);
  return pkg.version;
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
  const required = ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'locale/en.json', 'locale/zh.json', 'README.md', 'host/bridge.js', 'host/routes.js', 'host/tool.js', 'host/config.js', 'host/env.js', 'host/errors.js', 'host/engine.js', 'host/limits.js'];
  for (const artifact of required) {
    const covered = pkg.files.some((pattern) => listMatchingFiles(pattern).includes(artifact));
    assert(covered, `files list does not cover required artifact "${artifact}"`);
  }
  const extra = ['scripts/check.mjs', 'scripts/smoke-client.mjs', 'scripts/check-host.mjs', 'scripts/stage-dev.mjs', 'scripts/test-host-engine.mjs', 'scripts/lib/staged-host.mjs'];
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
  const used = new Set();
  for (const match of clientSource.matchAll(/className:\s*'([^']+)'/g)) {
    for (const name of match[1].split(/\s+/)) if (name.length > 0) used.add(name);
  }
  assert(used.size > 0, 'no className strings found');
  const missing = [...used].filter((name) => declared.has(name) === false);
  assert(missing.length === 0, `class names without CSS rules: ${missing.join(', ')}`);
  return `${used.size} class names, ${declared.size} styled`;
});

check('inline stylesheet is structurally sane', () => {
  const start = clientSource.indexOf('const CSS = `');
  const end = clientSource.indexOf('`;\n    //#endregion', start);
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

check('P0-005: sidebar entry registration matches the verified list contract', () => {
  assert(clientSource.includes("name: 'sidebar.panellist'"), 'sidebar entry registration not found');
  assert(clientSource.includes('id: PANEL_ID'), 'sidebar entry must address the same id as the main panel');
  assert(clientSource.includes('order: SIDEBAR_ORDER'), 'sidebar entry must declare its native order');
  assert(clientSource.includes('label: sidebarLabel'), 'sidebar entry must declare the locale-aware label thunk');
  assert(clientSource.includes('const SIDEBAR_ORDER = 30'), 'sidebar order should sit after the shipped panel rows (0/10/20)');
  assert(clientSource.includes("ctx.slots.inject('sidebar.panellist'"), 'sidebar entry must follow declaration lifetimes through slots.inject');
  assert(clientSource.includes("ctx.slots.inject('main'"), 'main panel declaration hook missing');
  assert(clientSource.includes("name: 'main', key: PANEL_ID"), 'main panel key must stay dsh-video');
  assert(clientSource.includes("'nav.label': 'Vedio Editor'"), 'exact user-requested label spelling missing from locale dictionaries');
  assert(clientSource.indexOf("'nav.label': 'Vedio Editor'") !== clientSource.lastIndexOf("'nav.label': 'Vedio Editor'"), 'label must exist in both shipped dictionaries');
  return 'native sidebar.panellist id/order/label + main key';
});

check('P0-005: the video panel and sidebar entry form one atomic pair', () => {
  const applyStart = clientSource.indexOf('function apply(ctx)');
  const applyEnd = clientSource.indexOf('return { inject: inject, apply: apply }');
  assert(applyStart >= 0 && applyEnd > applyStart, 'apply body not found');
  const applyBody = clientSource.slice(applyStart, applyEnd);
  const entryStart = applyBody.indexOf('function registerPanelAndEntry()');
  assert(entryStart >= 0, 'missing declaration-scoped registration entry point');
  const entryEnd = applyBody.indexOf('mainController = ctx.slots.inject', entryStart);
  assert(entryEnd > entryStart, 'main registration call site not found');
  const entryBody = applyBody.slice(entryStart, entryEnd);
  const panelIndex = entryBody.indexOf("name: 'main'");
  const sidebarIndex = entryBody.indexOf("name: 'sidebar.panellist'");
  assert(panelIndex >= 0, 'main panel registration missing from the declaration path');
  assert(sidebarIndex > panelIndex, 'the sidebar entry must only be registered after the video panel');
  assert(entryBody.includes('releaseCycle'), 'missing atomic pair release path');
  const sidebarRelease = entryBody.indexOf('target.sidebarDispose');
  const panelRelease = entryBody.indexOf('target.mainDispose');
  assert(sidebarRelease >= 0 && panelRelease > sidebarRelease, 'the sidebar entry must be released before the video panel');
  assert(entryBody.includes('settleSelection'), 'missing conversation fallback when the entry is lost');
  assert(entryBody.includes('sidebar-entry-unavailable'), 'missing unreachable-panel guard');
  assert(entryBody.includes('sidebar-register-failed'), 'missing sidebar registration failure containment');
  return 'panel -> entry pair, entry released first, retried per declaration';
});

check('P0-005: the old top capsule and its presentation machinery are gone', () => {
  const removed = ['dv-mode', 'thumbOrigin', 'conversation.header.leading', 'LeadingModeSwitch', 'dv-simplify'];
  for (const needle of removed) assert(clientSource.includes(needle) === false, `client.js still contains removed capsule code "${needle}"`);
  return 'no mode capsule / thumb origin / leading seat / stage framing code';
});

check('P0-005: panel transition is short and honours both reductions', () => {
  assert(clientSource.includes('animation:dv-panel-in var(--dv-dur-med)'), 'panel entry must use the short motion token');
  assert(clientSource.includes('--dv-dur-med:160ms'), 'panel transition should stay within the 120-180ms range');
  assert(clientSource.includes('@media (prefers-reduced-motion: reduce)'), 'reduced-motion media query missing');
  assert(clientSource.includes('.dv-root[data-simplified="true"]'), 'simplified-effects gate missing');
  assert(clientSource.includes("'data-simplified': ui.simplifiedEffects ? 'true' : 'false'"), 'root must expose the simplified-effects state');
  return '160ms panel fade; simplified / reduced-motion disable it';
});

check('P0-005: empty state is one exact sentence with no future-feature copy', () => {
  assert(clientSource.includes("'video.empty': '尚无工程'"), 'the empty state must be exactly 尚无工程');
  assert(clientSource.includes("'video.empty': 'No project yet'"), 'English empty state missing');
  const forbidden = ['空工作区', '从一个想法', '视频工作区已经接入', '当前阶段只验证', '工程创建将在后续阶段开放', '尚未包含工程', 'DSH Video · 原生工作区'];
  for (const needle of forbidden) assert(clientSource.includes(needle) === false, `client.js still contains removed copy "${needle}"`);
  return 'one empty-state sentence; old explanatory copy removed';
});

check('P0-005: the display preference lives in one accessible menu', () => {
  assert(clientSource.includes('aria-haspopup'), 'display menu trigger must expose aria-haspopup');
  assert(clientSource.includes('aria-expanded'), 'display menu trigger must expose aria-expanded');
  assert(clientSource.includes("role: 'menuitemcheckbox'"), 'display option must expose checkbox menu semantics');
  assert(clientSource.includes("'aria-checked': ui.simplifiedEffects ? 'true' : 'false'"), 'display option must expose its checked state');
  assert(clientSource.includes("t('video.display.label')"), 'display menu needs an accessible name from locale');
  return 'single labelled display-options menu with checkbox semantics';
});

check('R1: the display menu moves focus in and returns it on close', () => {
  assert(clientSource.includes('React.useRef('), 'menu needs trigger/item refs for focus management');
  assert(clientSource.includes('triggerRef') && clientSource.includes('itemRef'), 'menu refs missing');
  assert(clientSource.includes('focusOpenItem'), 'opening the menu must move focus onto the item');
  assert(clientSource.includes("event.key === 'ArrowDown'"), 'ArrowDown opening is not handled');
  assert(clientSource.includes("event.key === 'Escape'"), 'Escape close is not handled in the menu');
  assert(clientSource.includes("event.key === 'Tab'"), 'Tab close must be handled so focus cannot stay on the removed item');
  assert(clientSource.includes('focusTrigger'), 'closing must restore focus to the trigger');
  assert(clientSource.includes('tabIndex: -1'), 'menu items should be programmatically focused, not tab stops');
  assert(
    clientSource.includes('document.addEventListener') === false && clientSource.includes('window.addEventListener') === false,
    'the menu must not install global listeners (nothing may leak on unmount)'
  );
  return 'open focuses item; Escape/Tab close and refocus trigger; no global listeners';
});

check('P0-005: sidebar icon follows the host owner props and native stroke', () => {
  assert(clientSource.includes('function SidebarVideoIcon(props)'), 'sidebar icon component missing');
  assert(clientSource.includes('props.size'), 'sidebar icon must honour the host-provided square edge');
  assert(clientSource.includes("stroke: 'currentColor'"), 'sidebar icon must follow the row colour with currentColor');
  assert(clientSource.includes("viewBox: '0 0 16 16'"), 'sidebar icon should use the host 16-unit line-icon grid');
  assert(clientSource.includes("'aria-hidden': 'true'"), 'sidebar icon must be hidden from the accessible name (the host row carries the label)');
  return '16-viewBox currentColor line glyph sized by the host';
});

check('P2-002-B: committed runtime carries no development/deployment absolute paths', () => {
  const runtime = ['index.js', 'client.js'];
  for (const name of readdirSync(join(ROOT, 'host')).filter((entry) => entry.endsWith('.js'))) runtime.push('host/' + name);
  for (const name of runtime) {
    const source = read(name);
    for (const forbidden of ['/Users/', '/Applications/', 'process.execPath']) {
      assert(source.includes(forbidden) === false, `${name} hard-codes or adopts unsupported runtime detail "${forbidden}"`);
    }
  }
  assert(pkg.dependencies === undefined, 'the committed root manifest must not carry engine/dev dependencies; staging adds them only to its snapshot');
  return `${runtime.length} runtime files, no absolute dev/deployment paths`;
});

check('P2-004 R1: title and timing bind one explicit target, not two first-capability scans', () => {
  assert(clientSource.includes('function textElement(') === false, 'textElement first-capability scan is still present');
  assert(clientSource.includes('function timingElement(') === false, 'timingElement first-capability scan is still present');
  assert(clientSource.includes('function targetFor('), 'single targetFor selector missing');
  assert(clientSource.includes('const FIXTURE_TITLE_ID = \'hf-title\''), 'controlled fixture title contract missing');
  assert(clientSource.includes('dsh-video-target'), 'explicit target selector missing');
  return 'one selected stableId for title/timing; fixture contract hf-title';
});

check('P2-004 R2: Tool result budget is one raw UTF-8 byte constant without truncation', () => {
  const tool = read('host/tool.js');
  assert(read('host/limits.js').includes('TOOL_RESULT_BYTES = 64 * 1024'), 'shared UTF-8 byte budget missing');
  assert(tool.includes('TOOL_RESULT_BYTES'), 'Tool does not use the shared byte budget');
  assert(tool.includes('slice(0, 8000)') === false && tool.includes('TEXT_LIMIT') === false, 'Tool still truncates at an 8000-character limit');
  assert(tool.includes('E_RESULT_LIMIT'), 'over-budget Tool result lacks E_RESULT_LIMIT');
  return 'shared 64KiB UTF-8 budget; explicit E_RESULT_LIMIT';
});

check('P2-004 R3: real-engine runner imports staged Host and verifies integrity', () => {
  const runner = read('scripts/test-host-engine.mjs');
  assert(runner.includes("from '../host/bridge.js'") === false, 'real-engine runner still imports the development worktree Host');
  assert(runner.includes('loadStagedHost('), 'real-engine runner does not use the staged Host loader');
  assert(read('scripts/lib/staged-host.mjs').includes('hostModuleSha256'), 'staged Host verifier does not record the executed Host digest');
  return 'staged host module + INTEGRITY digest verification';
});

check('P2-004 R4: client version gate is a strict complete semver comparison', () => {
  const bridge = read('host/bridge.js');
  assert(bridge.includes('MIN_EXPLICIT_SPAWN_CLIENT'), 'minimum explicit-spawn client version missing');
  assert(bridge.includes('compareVersion(parsed, MIN_EXPLICIT_SPAWN_CLIENT)'), 'semantic version comparison missing');
  assert(bridge.includes('Number(part) || 0') === false, 'version parsing still coerces invalid parts to 0');
  return '>=0.1.1 complete semver; no coercion';
});

check('P2-002-B: Host modules do not import DSH-internal packages', () => {
  for (const name of readdirSync(join(ROOT, 'host')).filter((entry) => entry.endsWith('.js'))) {
    const source = read('host/' + name);
    assert(source.includes('@deepseek-ai/') === false, `host/${name} imports a DSH-internal package`);
  }
  return 'node builtins + explicit engine package specifiers only';
});

check('P2-002-B: the editor exposes only the real controlled-project loop', () => {
  for (const needle of ['video.open', 'openSample', 'hostRequest', 'REQUEST_ROUTE', 'E_CONFIGURATION', 'video.update', 'video.export', 'video.cancel', 'video.save']) {
    assert(clientSource.includes(needle), `client.js is missing real editor wiring "${needle}"`);
  }
  const forbidden = ['创建工程', '时间线', '预览', 'AI 生成', '演示数据', '假进度', '自动生成'];
  for (const needle of forbidden) assert(clientSource.includes(needle) === false, `client.js advertises unsupported or fake capability "${needle}"`);
  assert(clientSource.includes("const DEMO_PROJECT_ID = 'demo'"), 'the controlled example id must be a fixed configured id, not a path');
  assert(clientSource.includes("'video.empty': '尚无工程'"), 'the no-project state must stay a quiet real state');
  const dictionaries = clientSource.slice(clientSource.indexOf('const ZH = {'), clientSource.indexOf('//#endregion', clientSource.indexOf('const EN = {')));
  for (const forbiddenText of ['revision:', '路径', '版本号', '开发阶段']) assert(dictionaries.includes(forbiddenText) === false, `editor copy exposes internal detail "${forbiddenText}"`);
  return 'real open/update/edit/export/cancel wiring; no fake or unsupported affordances';
});

check('P0-005: mode wiring is host-owned and has no local mode source', () => {
  assert(clientSource.includes("const PANEL_ID = 'dsh-video'"), 'main-panel key must be dsh-video');
  assert(clientSource.includes('selectPanel'), 'navigation must go through ctx.layout.selectPanel');
  assert(clientSource.includes('usePanelInfo') === false, 'the sidebar row already owns selection; no panel-local mode hook is needed');
  assert(clientSource.includes('sidebar.panellist') === true && clientSource.includes('shell.overlay') === false, 'must use the supported sidebar list, not an overlay');
  return 'host-owned selection, native sidebar list, no local mode boolean';
});

for (const [name, detail] of passes) console.log(`PASS  ${name}${detail === 'ok' ? '' : `  [${detail}]`}`);
for (const [name, message] of failures) console.error(`FAIL  ${name}: ${message}`);

console.log(`\n${passes.length} passed, ${failures.length} failed`);
if (failures.length > 0) process.exitCode = 1;
