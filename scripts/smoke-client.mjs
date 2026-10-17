#!/usr/bin/env node
/**
 * Local smoke test for the dsh-video Client half.
 *
 * Executes the real `client.js` in a Node VM with a minimal fake Slot runtime and
 * a minimal React-compatible hook shim. It checks only this plugin's own logic:
 *
 *   - module registration shape and the exact slot registrations it performs;
 *   - navigation goes through `ctx.layout.selectPanel` and failures are contained;
 *   - mode selection is derived from the host active panel, not local state;
 *   - the simplified-effects preference is versioned, corruption-safe and
 *     write-failure-safe;
 *   - occupied slots / undeclared slots leave normal mode intact (no dead entry);
 *   - every registration is reachable through a disposer.
 *
 * This is NOT host verification: no real DSH Slot runtime, no browser, no React
 * renderer and no install. Real-host acceptance stays in P0-002's post-install list.
 *
 * Run: node scripts/smoke-client.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_SOURCE = readFileSync(join(ROOT, 'client.js'), 'utf8');
const PREFS_KEY = 'dsh-video.ui.v1';
const PANEL_ID = 'dsh-video';
const LEADING_SLOT = 'conversation.header.leading';

const passes = [];
const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  try {
    fn();
    passes.push(name);
  } catch (error) {
    failures.push([name, error instanceof Error ? error.message : String(error)]);
  }
}

function translate(key) {
  return key;
}

//#region minimal React shim + renderer
function createReact() {
  let currentRuntime = null;

  function runtime() {
    if (currentRuntime === null) throw new Error('hook called outside a component render');
    return currentRuntime;
  }

  function renderNode(node, context) {
    if (node === null || node === undefined || node === false || node === true) return null;
    if (typeof node === 'string' || typeof node === 'number') return { type: '#text', text: String(node), props: {} };
    if (Array.isArray(node)) return node.map((child) => renderNode(child, context));
    if (typeof node !== 'object') return null;
    const { type, props } = node;
    if (typeof type === 'function') {
      const previous = currentRuntime;
      const scope = { hooks: {}, hookIndex: 0, effects: [] };
      currentRuntime = scope;
      let rendered;
      try {
        rendered = type(props || {});
      } finally {
        currentRuntime = previous;
      }
      for (const effect of scope.effects) context.effects.push(effect);
      return renderNode(rendered, context);
    }
    return { type, props: props || {}, children: renderNode((props || {}).children, context) };
  }

  const react = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      const nextProps = Object.assign({}, props);
      if (children.length === 1) nextProps.children = children[0];
      else if (children.length > 1) nextProps.children = children;
      return { type, props: nextProps };
    },
    useState(initial) {
      const scope = runtime();
      const index = scope.hookIndex++;
      if (!(index in scope.hooks)) scope.hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [
        scope.hooks[index],
        function setState(next) {
          scope.hooks[index] = typeof next === 'function' ? next(scope.hooks[index]) : next;
        },
      ];
    },
    useEffect(effect) {
      runtime().effects.push(effect);
    },
    useRef(initial) {
      const scope = runtime();
      const index = scope.hookIndex++;
      if (!(index in scope.hooks)) scope.hooks[index] = { current: initial };
      return scope.hooks[index];
    },
    useCallback(callback) {
      runtime();
      return callback;
    },
    useMemo(factory) {
      runtime();
      return factory();
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      runtime();
      return getSnapshot();
    },
    render(element) {
      const context = { effects: [], cleanups: [] };
      const tree = renderNode(element, context);
      for (const effect of context.effects) {
        const cleanup = effect();
        if (typeof cleanup === 'function') context.cleanups.push(cleanup);
      }
      return { tree, cleanups: context.cleanups };
    },
  };

  return react;
}

function walk(node, visitor) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visitor);
    return;
  }
  if (typeof node !== 'object') return;
  visitor(node);
  if (node.children !== undefined) walk(node.children, visitor);
}

function find(node, predicate) {
  let found = null;
  walk(node, (candidate) => {
    if (found === null && predicate(candidate)) found = candidate;
  });
  return found;
}

function findAll(node, predicate) {
  const found = [];
  walk(node, (candidate) => {
    if (predicate(candidate)) found.push(candidate);
  });
  return found;
}

function textOf(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node !== 'object') return '';
  const own = node.type === '#text' ? node.text : '';
  return own + (node.children !== undefined ? textOf(node.children) : '');
}
//#endregion

//#region fake DSH client slot runtime
function createMemoryStorage(initial, behavior) {
  const map = new Map(Object.entries(initial || {}));
  const options = behavior || {};
  return {
    map,
    getItem(key) {
      if (options.getThrows) throw new Error('storage read blocked by test');
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (options.setThrows) throw new Error('storage write blocked by test');
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function createFakeEnvironment(options) {
  const config = options || {};
  const declared = Object.assign(
    { main: 'keyed', [LEADING_SLOT]: 'single' },
    config.declaredSlots || {}
  );
  for (const key of Object.keys(declared)) {
    if (declared[key] === false) delete declared[key];
  }
  const entriesBySlot = {
    main: (config.mainOccupants || []).slice(),
    [LEADING_SLOT]: (config.leadingOccupants || []).slice(),
  };
  const events = {
    registrations: [],
    errors: [],
    warnings: [],
    locale: [],
    panelCalls: [],
    effectDisposers: [],
    injectDisposers: [],
  };

  const slots = {
    entries(slotName) {
      if (config.entriesUnavailable) throw new Error('entries unavailable by test');
      return (entriesBySlot[slotName] || []).slice();
    },
    specDynamic(slotName) {
      return declared[slotName] === undefined ? undefined : { kind: declared[slotName] };
    },
    spec(slotName) {
      return declared[slotName] === undefined ? undefined : { kind: declared[slotName] };
    },
    inject(slotName, callback) {
      if (declared[slotName] === undefined) throw new Error(`slot "${slotName}" is not declared`);
      let inner = null;
      try {
        inner = callback();
      } catch (error) {
        throw error;
      }
      const dispose = function disposeInjection() {
        if (typeof inner === 'function') inner();
      };
      events.injectDisposers.push(dispose);
      return dispose;
    },
    register(registration, component) {
      const kind = declared[registration.name];
      if (kind === undefined) throw new Error(`slot "${registration.name}" is not declared`);
      if (config.registerThrows && config.registerThrows[registration.name]) {
        throw new Error(`registration blocked for "${registration.name}" by test`);
      }
      const list = entriesBySlot[registration.name] || (entriesBySlot[registration.name] = []);
      if (kind === 'single' && list.length > 0) {
        throw new Error(`single slot "${registration.name}" already has a registration`);
      }
      if (kind === 'keyed') {
        if (registration.key === undefined) throw new Error(`keyed slot "${registration.name}" requires key`);
        if (list.some((entry) => entry.options.key === registration.key)) {
          throw new Error(`keyed slot "${registration.name}" already has key "${registration.key}"`);
        }
      }
      const record = { options: Object.assign({}, registration), component, live: true };
      list.push(record);
      events.registrations.push(record);
      return function unregister() {
        const index = list.indexOf(record);
        if (index >= 0) list.splice(index, 1);
        record.live = false;
      };
    },
  };

  let activePanelId = config.activePanelId === undefined ? null : config.activePanelId;

  const ctx = {
    logger: {
      error(...args) {
        events.errors.push(args);
      },
      warn(...args) {
        events.warnings.push(args);
      },
    },
    effect(callback, label) {
      const dispose = callback();
      events.effectDisposers.push(dispose);
      return dispose;
    },
    locale: {
      register(ns, dicts) {
        events.locale.push({ ns, dicts });
        return function unregisterLocale() {};
      },
    },
    layout: {
      panelInfo: {
        getSnapshot() {
          return { activePanelId };
        },
      },
      selectPanel(panelId) {
        if (config.selectPanelThrows) throw new Error('layout.selectPanel: main panel not registered (test)');
        activePanelId = panelId;
        events.panelCalls.push(panelId);
      },
    },
    slots,
  };

  return {
    ctx,
    events,
    entriesBySlot,
    declared,
    setActivePanel(panelId) {
      activePanelId = panelId;
    },
  };
}

/** Load the real client.js in a VM and return its exported plugin body. */
function loadClient() {
  const registrations = [];
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(registration) {
          registrations.push(registration);
        },
      },
    },
    localStorage: undefined,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    requestAnimationFrame(callback) {
      callback();
      return 0;
    },
    cancelAnimationFrame() {},
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(CLIENT_SOURCE, context, { filename: 'client.js' });
  assert(registrations.length === 1, `expected one module registration, got ${registrations.length}`);
  const registration = registrations[0];
  const react = createReact();
  const exportsObject = registration.factory((specifier) => {
    if (specifier === 'react') return react;
    throw new Error(`unexpected external require("${specifier}")`);
  });
  return { registration, react, exports: exportsObject, sandbox };
}

function loadClientWithStorage(storage) {
  const loaded = loadClient();
  loaded.sandbox.localStorage = storage;
  return loaded;
}

function activePanelHook(activePanelId) {
  return function usePanelInfo(selector) {
    return selector({ activePanelId });
  };
}

function mountComponent(react, component, props) {
  const element = react.createElement(component, props);
  const rendered = react.render(element);
  return rendered;
}

function activationErrors(events) {
  return events.errors.map((args) => String(args[0])).concat(events.warnings.map((args) => String(args[0])));
}
//#endregion

//#region tests
test('module registers one browser module with the dsh-video id and factory', () => {
  const loaded = loadClient();
  assert(loaded.registration.id === PANEL_ID, `module id is "${loaded.registration.id}"`);
  assert(typeof loaded.registration.factory === 'function', 'factory missing');
  assert(typeof loaded.exports.apply === 'function', 'plugin body lacks apply()');
  assert(Array.isArray(loaded.exports.inject), 'plugin body lacks inject array');
  assert(
    JSON.stringify(loaded.exports.inject) === JSON.stringify(['slots', 'layout', 'locale']),
    `unexpected inject list: ${JSON.stringify(loaded.exports.inject)}`
  );
});

test('apply registers the video main panel and the additive leading capsule', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const main = env.events.registrations.find((entry) => entry.options.name === 'main');
  const leading = env.events.registrations.find((entry) => entry.options.name === LEADING_SLOT);
  assert(main !== undefined, 'main panel was not registered');
  assert(main.options.key === PANEL_ID, `main key is "${main.options.key}"`);
  assert(leading !== undefined, 'leading capsule was not registered');
  assert(leading.options.locale === 'dshVideo', 'leading capsule must bind the plugin locale namespace');
  assert(env.events.locale.length === 1 && env.events.locale[0].ns === 'dshVideo', 'locale dictionaries not registered');
  assert(env.events.errors.length === 0, `unexpected activation errors: ${activationErrors(env.events).join('; ')}`);
  assert(leading.options.inject !== undefined && typeof leading.options.inject === 'function', 'leading capsule lacks injected navigation');
});

test('navigation goes through the host layout service with video/null', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const main = env.events.registrations.find((entry) => entry.options.name === 'main');
  const nav = main.options.inject();
  nav.onSelectMode('video');
  nav.onSelectMode('normal');
  assert(JSON.stringify(env.events.panelCalls) === JSON.stringify([PANEL_ID, null]), `panel calls: ${JSON.stringify(env.events.panelCalls)}`);
});

test('navigation failures are contained and reported once', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ selectPanelThrows: true });
  loaded.exports.apply(env.ctx);
  const leading = env.events.registrations.find((entry) => entry.options.name === LEADING_SLOT);
  const nav = leading.options.inject();
  let threw = false;
  try {
    nav.onSelectMode('video');
  } catch (_error) {
    threw = true;
  }
  assert(threw === false, 'navigation failure escaped into the UI');
  assert(activationErrors(env.events).some((message) => message.includes('navigation-failed')), 'navigation failure was not reported');
});

test('mode capsule derives selection from the host active panel', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const leading = env.events.registrations.find((entry) => entry.options.name === LEADING_SLOT);
  const props = Object.assign({ t: translate, usePanelInfo: activePanelHook(null) }, leading.options.inject());
  const rendered = mountComponent(loaded.react, leading.component, props);
  const buttons = findAll(rendered.tree, (node) => node.type === 'button' && node.props['data-mode'] !== undefined);
  assert(buttons.length === 2, `expected two mode buttons, got ${buttons.length}`);
  const normal = buttons.find((button) => button.props['data-mode'] === 'normal');
  const video = buttons.find((button) => button.props['data-mode'] === 'video');
  assert(normal.props['aria-pressed'] === 'true', 'normal segment should be pressed while conversation is active');
  assert(video.props['aria-pressed'] === 'false', 'video segment must not be pressed while conversation is active');
  video.props.onClick();
  assert(env.events.panelCalls[env.events.panelCalls.length - 1] === PANEL_ID, 'video segment did not navigate to the video panel');
  const style = find(rendered.tree, (node) => node.type === 'style');
  assert(style !== null && typeof style.props.dangerouslySetInnerHTML.__html === 'string', 'component-scoped styles were not rendered');
  assert(style.props['data-dsh-video'] === 'styles', 'style tag is not marked for this plugin');
});

test('video workspace shows the same capsule with video pressed and no fake controls', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const main = env.events.registrations.find((entry) => entry.options.name === 'main');
  const props = Object.assign({ t: translate, usePanelInfo: activePanelHook(PANEL_ID) }, main.options.inject());
  const rendered = mountComponent(loaded.react, main.component, props);
  const buttons = findAll(rendered.tree, (node) => node.type === 'button' && node.props['data-mode'] !== undefined);
  const video = buttons.find((button) => button.props['data-mode'] === 'video');
  assert(video.props['aria-pressed'] === 'true', 'video segment should be pressed inside the video panel');
  const toggles = findAll(rendered.tree, (node) => node.type === 'button' && node.props.role === 'switch');
  assert(toggles.length === 1, 'expected exactly one simplified-effects switch');
  assert(toggles[0].props['aria-checked'] === 'false', 'simplified effects should default to off');
  const buttonsAll = findAll(rendered.tree, (node) => node.type === 'button');
  const back = buttonsAll.find((button) => textOf(button).includes('video.empty.back'));
  assert(back !== undefined, 'working back-to-normal entry is missing');
  back.props.onClick();
  assert(env.events.panelCalls[env.events.panelCalls.length - 1] === null, 'back entry did not return to the conversation');
  const text = textOf(rendered.tree);
  for (const forbidden of ['timeline', 'export', 'create']) {
    assert(text.includes(forbidden) === false, `empty workspace rendered a fake "${forbidden}" affordance`);
  }
});

test('simplified-effects preference is versioned and restored', () => {
  const storage = createMemoryStorage();
  const loaded = loadClientWithStorage(storage);
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const main = env.events.registrations.find((entry) => entry.options.name === 'main');
  const props = Object.assign({ t: translate, usePanelInfo: activePanelHook(PANEL_ID) }, main.options.inject());

  const first = mountComponent(loaded.react, main.component, props);
  const toggle = find(first.tree, (node) => node.type === 'button' && node.props.role === 'switch');
  toggle.props.onClick();
  const stored = storage.map.get(PREFS_KEY);
  assert(typeof stored === 'string', 'preference was not persisted');
  const parsed = JSON.parse(stored);
  assert(parsed.version === 1, `stored payload version is ${parsed.version}`);
  assert(parsed.simplifiedEffects === true, 'stored payload did not record the simplified-effects value');

  const second = mountComponent(loaded.react, main.component, props);
  const toggleAgain = find(second.tree, (node) => node.type === 'button' && node.props.role === 'switch');
  assert(toggleAgain.props['aria-checked'] === 'true', 'persisted preference was not restored');
  const root = find(second.tree, (node) => node.props && node.props.className === 'dv-root');
  assert(root !== null && root.props['data-simplified'] === 'true', 'video root did not apply the simplified mode');

  const fresh = loadClientWithStorage(storage);
  const freshEnv = createFakeEnvironment();
  fresh.exports.apply(freshEnv.ctx);
  const freshMain = freshEnv.events.registrations.find((entry) => entry.options.name === 'main');
  const freshProps = Object.assign({ t: translate, usePanelInfo: activePanelHook(PANEL_ID) }, freshMain.options.inject());
  const freshRendered = mountComponent(fresh.react, freshMain.component, freshProps);
  const freshToggle = find(freshRendered.tree, (node) => node.type === 'button' && node.props.role === 'switch');
  assert(freshToggle.props['aria-checked'] === 'true', 'a fresh module load did not restore the persisted preference');
});

test('corrupt, unknown-version and wrong-shape preferences fall back safely', () => {
  const cases = [
    ['invalid JSON', '{"version":1,'],
    ['old version', JSON.stringify({ version: 0, simplifiedEffects: true })],
    ['unknown version', JSON.stringify({ version: 99, simplifiedEffects: true })],
    ['null payload', 'null'],
    ['array payload', '[]'],
    ['missing field', JSON.stringify({ version: 1 })],
  ];
  for (const [label, raw] of cases) {
    const storage = createMemoryStorage({ [PREFS_KEY]: raw });
    const loaded = loadClientWithStorage(storage);
    const env = createFakeEnvironment();
    loaded.exports.apply(env.ctx);
    const main = env.events.registrations.find((entry) => entry.options.name === 'main');
    const props = Object.assign({ t: translate, usePanelInfo: activePanelHook(PANEL_ID) }, main.options.inject());
    const rendered = mountComponent(loaded.react, main.component, props);
    const toggle = find(rendered.tree, (node) => node.type === 'button' && node.props.role === 'switch');
    assert(toggle.props['aria-checked'] === 'false', `${label}: corrupt preference was not rejected`);
  }
});

test('storage read/write exceptions do not break activation or the toggle', () => {
  const storage = createMemoryStorage({}, { getThrows: true, setThrows: true });
  const loaded = loadClientWithStorage(storage);
  const env = createFakeEnvironment();
  let threw = false;
  try {
    loaded.exports.apply(env.ctx);
  } catch (_error) {
    threw = true;
  }
  assert(threw === false, 'apply threw when storage was unavailable');
  const main = env.events.registrations.find((entry) => entry.options.name === 'main');
  const props = Object.assign({ t: translate, usePanelInfo: activePanelHook(PANEL_ID) }, main.options.inject());
  const rendered = mountComponent(loaded.react, main.component, props);
  const toggle = find(rendered.tree, (node) => node.type === 'button' && node.props.role === 'switch');
  try {
    toggle.props.onClick();
  } catch (_error) {
    threw = true;
  }
  assert(threw === false, 'toggle threw when the storage write failed');
  const rerendered = mountComponent(loaded.react, main.component, props);
  const toggleAgain = find(rerendered.tree, (node) => node.type === 'button' && node.props.role === 'switch');
  assert(toggleAgain.props['aria-checked'] === 'true', 'in-memory value was lost after a failed write');
  assert(activationErrors(env.events).some((message) => message.includes('prefs-')), 'storage failures were not reported');
});

test('occupied leading seat refuses to mount anything (no dead entry, no shadowing)', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ leadingOccupants: [{ options: { priority: 0 } }] });
  loaded.exports.apply(env.ctx);
  assert(env.events.registrations.length === 0, `expected no registrations, got ${env.events.registrations.length}`);
  assert(activationErrors(env.events).some((message) => message.includes('leading-seat-conflict')), 'leading conflict was not reported');
});

test('occupied dsh-video main key refuses to mount anything', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ mainOccupants: [{ options: { key: PANEL_ID } }] });
  loaded.exports.apply(env.ctx);
  assert(env.events.registrations.length === 0, `expected no registrations, got ${env.events.registrations.length}`);
  assert(activationErrors(env.events).some((message) => message.includes('main-key-conflict')), 'main key conflict was not reported');
});

test('undeclared main slot keeps normal mode and reports the failure', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ declaredSlots: { main: false } });
  loaded.exports.apply(env.ctx);
  assert(env.events.registrations.length === 0, 'nothing may be registered when the main slot cannot be injected');
  assert(activationErrors(env.events).some((message) => message.includes('main-inject-failed')), 'missing main slot was not reported');
});

test('late leading registration failure removes the video panel again', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ registerThrows: { [LEADING_SLOT]: true } });
  loaded.exports.apply(env.ctx);
  const live = env.events.registrations.filter((entry) => entry.live);
  assert(live.length === 0, `dead entry left registered: ${live.map((entry) => entry.options.name).join(', ')}`);
  assert(activationErrors(env.events).some((message) => message.includes('leading-register-failed')), 'leading registration failure was not reported');
});

test('slot enumeration unavailable refuses to mount without shadowing (reported, no throw)', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ entriesUnavailable: true });
  let threw = false;
  try {
    loaded.exports.apply(env.ctx);
  } catch (_error) {
    threw = true;
  }
  assert(threw === false, 'apply threw when slot enumeration was unavailable');
  assert(env.events.registrations.length === 0, `expected no registrations, got ${env.events.registrations.length}`);
  assert(
    activationErrors(env.events).some((message) => message.includes('main-entries-unavailable')),
    'enumeration failure was not reported'
  );
});

test('every registration is removed through its disposer (unload simulation)', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  assert(env.events.registrations.length === 2, 'expected two registrations before unload');
  env.setActivePanel(PANEL_ID);
  for (const dispose of env.events.injectDisposers.slice().reverse()) dispose();
  for (const dispose of env.events.effectDisposers.slice().reverse()) {
    if (typeof dispose === 'function') dispose();
  }
  const live = env.events.registrations.filter((entry) => entry.live);
  assert(live.length === 0, `registrations left live after unload: ${live.map((entry) => entry.options.name).join(', ')}`);
  assert(
    env.events.panelCalls[env.events.panelCalls.length - 1] === null,
    'unload while the video panel was selected did not ask the host to return to the conversation'
  );
});
//#endregion

for (const name of passes) console.log(`PASS  ${name}`);
for (const [name, message] of failures) console.error(`FAIL  ${name}: ${message}`);
console.log(`\n${passes.length} passed, ${failures.length} failed`);
if (failures.length > 0) process.exitCode = 1;
