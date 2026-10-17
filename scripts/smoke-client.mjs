#!/usr/bin/env node
/**
 * Local smoke test for the dsh-video Client half.
 *
 * Executes the real `client.js` in a Node VM with a minimal fake Slot runtime and
 * a minimal React-compatible hook shim. The fake runtime models the verified
 * 0.2.0-rc.2 contract that matters here:
 *
 *   - `ctx.slots.inject(key, callback)` WAITS while the slot is undeclared and
 *     runs the callback on every declaration lifetime (no throw for "not yet");
 *   - a collapsed declaration disposes the effect (and its registrations);
 *   - `ctx.slots.entries()` is the live occupant list used for conflict checks.
 *
 * Covered here: registration shape, declaration-bound entry lifecycle (R1),
 * navigation, activePanel-derived selection, presentation hint start/end and
 * interruption logic (R2, no real animation), preference persistence,
 * corruption/write failures, conflicts and disposal.
 *
 * Not covered / not claimed: real browser rendering, CSS animation playback,
 * layout, host activation, or any install-time verification. Those stay in
 * P0-002's post-install checklist.
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

//#region fake DSH client slot runtime (declaration lifetime aware)
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
  const declared = {};
  const initialDeclared = Object.assign({ main: 'keyed', [LEADING_SLOT]: 'single' }, config.declaredSlots || {});
  for (const [slot, kind] of Object.entries(initialDeclared)) {
    if (kind !== false) declared[slot] = kind;
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
    injections: [],
    effectDisposers: [],
  };
  let activePanelId = config.activePanelId === undefined ? null : config.activePanelId;
  const controllersBySlot = new Map();

  function activateController(controller) {
    controller.running = true;
    try {
      const inner = controller.callback();
      controller.inner = typeof inner === 'function' ? inner : null;
      controller.active = true;
    } finally {
      controller.running = false;
    }
  }

  function deactivateController(controller) {
    if (!controller.active) return;
    controller.active = false;
    const inner = controller.inner;
    controller.inner = null;
    if (typeof inner === 'function') inner();
  }

  function disposeController(controller) {
    controller.stopped = true;
    deactivateController(controller);
  }

  const slots = {
    entries(slot) {
      if (config.entriesUnavailable) throw new Error('entries unavailable by test');
      return (entriesBySlot[slot] || []).slice();
    },
    spec(slot) {
      return declared[slot] === undefined ? undefined : { kind: declared[slot] };
    },
    specDynamic(slot) {
      return slots.spec(slot);
    },
    inject(slot, callback) {
      const controller = { slot, callback, active: false, running: false, stopped: false, inner: null };
      const list = controllersBySlot.get(slot) || [];
      list.push(controller);
      controllersBySlot.set(slot, list);
      events.injections.push(controller);
      if (declared[slot] !== undefined) {
        try {
          activateController(controller);
        } catch (error) {
          controller.stopped = true;
          throw error;
        }
      }
      return function disposeInjection() {
        disposeController(controller);
      };
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

  function runWaitingControllers(slot) {
    for (const controller of controllersBySlot.get(slot) || []) {
      if (controller.stopped || controller.active || controller.running) continue;
      try {
        activateController(controller);
      } catch (error) {
        events.errors.push(['host: injection callback threw', error]);
      }
    }
  }

  function declareSlot(slot, kind) {
    if (declared[slot] !== undefined) return;
    declared[slot] = kind || (slot === 'main' ? 'keyed' : 'single');
    runWaitingControllers(slot);
  }

  function collapseSlot(slot) {
    if (declared[slot] === undefined) return;
    delete declared[slot];
    for (const controller of controllersBySlot.get(slot) || []) {
      deactivateController(controller);
    }
  }

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
    declareSlot,
    collapseSlot,
    setActivePanel(panelId) {
      activePanelId = panelId;
    },
    getActivePanel() {
      return activePanelId;
    },
    disposeAllInjections() {
      for (const controller of events.injections.slice().reverse()) disposeController(controller);
    },
    disposeAllEffects() {
      for (const dispose of events.effectDisposers.slice().reverse()) {
        if (typeof dispose === 'function') dispose();
      }
    },
  };
}
//#endregion

//#region module loading
function loadClient(options) {
  const config = options || {};
  const registrations = [];
  const frames = [];
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(registration) {
          registrations.push(registration);
        },
      },
    },
    localStorage: config.storage,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    requestAnimationFrame(callback) {
      if (config.queueFrames !== true) {
        callback();
        return 0;
      }
      const token = { callback, cancelled: false };
      frames.push(token);
      return token;
    },
    cancelAnimationFrame(token) {
      if (token && typeof token === 'object') token.cancelled = true;
    },
  };
  if (typeof config.matchMedia === 'function') sandbox.window.matchMedia = config.matchMedia;
  const context = vm.createContext(sandbox);
  vm.runInContext(CLIENT_SOURCE, context, { filename: 'client.js' });
  assert(registrations.length === 1, `expected one module registration, got ${registrations.length}`);
  const registration = registrations[0];
  const react = createReact();
  const exportsObject = registration.factory((specifier) => {
    if (specifier === 'react') return react;
    throw new Error(`unexpected external require("${specifier}")`);
  });
  return {
    registration,
    react,
    exports: exportsObject,
    sandbox,
    flushFrames(rounds = 8) {
      for (let round = 0; round < rounds; round += 1) {
        const batch = frames.splice(0);
        if (batch.length === 0) return;
        for (const token of batch) {
          if (!token.cancelled && typeof token.callback === 'function') token.callback();
        }
      }
    },
  };
}

function loadClientWithStorage(storage, options) {
  const loaded = loadClient(options);
  loaded.sandbox.localStorage = storage;
  return loaded;
}

function activePanelHook(env) {
  return function usePanelInfo(selector) {
    return selector({ activePanelId: env.getActivePanel() });
  };
}

function mount(react, component, props) {
  return react.render(react.createElement(component, props)).tree;
}

function registrationOf(env, slotName) {
  return env.events.registrations.find((entry) => entry.options.name === slotName);
}

function mountSwitch(loaded, env, slotName) {
  const registration = registrationOf(env, slotName);
  assert(registration !== undefined, `no registration on ${slotName}`);
  const props = Object.assign(
    { t: translate, usePanelInfo: activePanelHook(env) },
    registration.options.inject()
  );
  return mount(loaded.react, registration.component, props);
}

function modeButtons(tree) {
  const buttons = findAll(tree, (node) => node.type === 'button' && node.props['data-mode'] !== undefined);
  return {
    all: buttons,
    normal: buttons.find((button) => button.props['data-mode'] === 'normal'),
    video: buttons.find((button) => button.props['data-mode'] === 'video'),
  };
}

function capsule(tree) {
  return find(tree, (node) => node.props && node.props.className === 'dv-mode');
}

function navigationOf(env) {
  const main = registrationOf(env, 'main');
  assert(main !== undefined, 'main panel is not registered');
  return main.options.inject();
}

function activationErrors(env) {
  return env.events.errors
    .map((args) => String(args[0]))
    .concat(env.events.warnings.map((args) => String(args[0])));
}

function liveRegistrations(env) {
  return env.events.registrations.filter((entry) => entry.live);
}
//#endregion

//#region tests: module + registration baseline
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
  const main = registrationOf(env, 'main');
  const leading = registrationOf(env, LEADING_SLOT);
  assert(main !== undefined, 'main panel was not registered');
  assert(main.options.key === PANEL_ID, `main key is "${main.options.key}"`);
  assert(leading !== undefined, 'leading capsule was not registered');
  assert(leading.options.locale === 'dshVideo', 'leading capsule must bind the plugin locale namespace');
  assert(env.events.locale.length === 1 && env.events.locale[0].ns === 'dshVideo', 'locale dictionaries not registered');
  assert(env.events.errors.length === 0, `unexpected activation errors: ${activationErrors(env).join('; ')}`);
});

test('navigation goes through the host layout service with video/null', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const nav = navigationOf(env);
  nav.onSelectMode('video');
  nav.onSelectMode('normal');
  assert(
    JSON.stringify(env.events.panelCalls) === JSON.stringify([PANEL_ID, null]),
    `panel calls: ${JSON.stringify(env.events.panelCalls)}`
  );
});

test('navigation failures are contained and reported once', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ selectPanelThrows: true });
  loaded.exports.apply(env.ctx);
  const nav = navigationOf(env);
  let threw = false;
  try {
    nav.onSelectMode('video');
  } catch (_error) {
    threw = true;
  }
  assert(threw === false, 'navigation failure escaped into the UI');
  assert(activationErrors(env).some((message) => message.includes('navigation-failed')), 'navigation failure was not reported');
});

test('mode capsule derives selection from the host active panel', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const tree = mountSwitch(loaded, env, LEADING_SLOT);
  const buttons = modeButtons(tree);
  assert(buttons.all.length === 2, `expected two mode buttons, got ${buttons.all.length}`);
  assert(buttons.normal.props['aria-pressed'] === 'true', 'normal segment should be pressed while conversation is active');
  assert(buttons.video.props['aria-pressed'] === 'false', 'video segment must not be pressed while conversation is active');
  buttons.video.props.onClick();
  assert(env.events.panelCalls[env.events.panelCalls.length - 1] === PANEL_ID, 'video segment did not navigate to the video panel');
  const style = find(tree, (node) => node.type === 'style');
  assert(style !== null && typeof style.props.dangerouslySetInnerHTML.__html === 'string', 'component-scoped styles were not rendered');
  assert(style.props['data-dsh-video'] === 'styles', 'style tag is not marked for this plugin');
});

test('video workspace shows the same capsule with video pressed and no fake controls', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  env.setActivePanel(PANEL_ID);
  const tree = mountSwitch(loaded, env, 'main');
  const buttons = modeButtons(tree);
  assert(buttons.video.props['aria-pressed'] === 'true', 'video segment should be pressed inside the video panel');
  const toggles = findAll(tree, (node) => node.type === 'button' && node.props.role === 'switch');
  assert(toggles.length === 1, 'expected exactly one simplified-effects switch');
  assert(toggles[0].props['aria-checked'] === 'false', 'simplified effects should default to off');
  const back = findAll(tree, (node) => node.type === 'button').find((button) => textOf(button).includes('video.empty.back'));
  assert(back !== undefined, 'working back-to-normal entry is missing');
  back.props.onClick();
  assert(env.events.panelCalls[env.events.panelCalls.length - 1] === null, 'back entry did not return to the conversation');
  const text = textOf(tree);
  for (const forbidden of ['timeline', 'export', 'create']) {
    assert(text.includes(forbidden) === false, `empty workspace rendered a fake "${forbidden}" affordance`);
  }
});
//#endregion

//#region tests: R1 declaration-bound entry lifecycle
test('R1: main undeclared -> no capsule; declaration -> both mount points appear', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ declaredSlots: { main: false } });
  loaded.exports.apply(env.ctx);
  assert(liveRegistrations(env).length === 0, `expected no visible entry before main exists, got ${liveRegistrations(env).length}`);
  assert(registrationOf(env, LEADING_SLOT) === undefined, 'normal-mode capsule must not exist before the video panel does');
  env.declareSlot('main', 'keyed');
  const live = liveRegistrations(env);
  assert(live.length === 2, `expected main + capsule after declaration, got ${live.length}`);
  assert(registrationOf(env, 'main') !== undefined, 'main panel missing after declaration');
  assert(registrationOf(env, LEADING_SLOT) !== undefined, 'capsule missing after declaration');
});

test('R1: collapsing main retracts the capsule; re-declaration restores both', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  assert(liveRegistrations(env).length === 2, 'baseline registrations missing');
  env.collapseSlot('main');
  assert(liveRegistrations(env).length === 0, `collapsing main left ${liveRegistrations(env).length} live registration(s)`);
  env.declareSlot('main', 'keyed');
  assert(liveRegistrations(env).length === 2, `re-declaration did not restore both mount points (got ${liveRegistrations(env).length})`);
  const nav = navigationOf(env);
  nav.onSelectMode('video');
  assert(env.events.panelCalls[env.events.panelCalls.length - 1] === PANEL_ID, 'navigation unavailable after re-declaration');
});

test('R1: re-declaration re-checks the main key and retracts everything on conflict', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  env.collapseSlot('main');
  env.entriesBySlot.main.push({ options: { key: PANEL_ID } });
  env.declareSlot('main', 'keyed');
  assert(liveRegistrations(env).length === 0, 'conflicting re-declaration left registrations behind');
  assert(
    activationErrors(env).some((message) => message.includes('main-key-conflict')),
    're-declaration conflict was not reported'
  );
});

test('R1: main registration failure at declaration time exposes no entry', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ declaredSlots: { main: false }, registerThrows: { main: true } });
  loaded.exports.apply(env.ctx);
  env.declareSlot('main', 'keyed');
  assert(liveRegistrations(env).length === 0, 'failed main registration left an entry behind');
  assert(
    activationErrors(env).some((message) => message.includes('main-register-failed')),
    'main registration failure was not reported'
  );
});

test('R1: failed capsule registration retracts the video panel (no unreachable panel)', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ declaredSlots: { main: false }, registerThrows: { [LEADING_SLOT]: true } });
  loaded.exports.apply(env.ctx);
  env.declareSlot('main', 'keyed');
  assert(liveRegistrations(env).length === 0, 'a video panel without its capsule was left registered');
  const errors = activationErrors(env);
  assert(errors.some((message) => message.includes('leading-register-failed')), 'capsule registration failure was not reported');
  assert(errors.some((message) => message.includes('leading-entry-unavailable')), 'missing entry was not diagnosed');
});

test('occupied leading seat refuses to mount anything (no dead entry, no shadowing)', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ leadingOccupants: [{ options: { priority: 0 } }] });
  loaded.exports.apply(env.ctx);
  assert(liveRegistrations(env).length === 0, `expected no registrations, got ${liveRegistrations(env).length}`);
  assert(activationErrors(env).some((message) => message.includes('leading-seat-conflict')), 'leading conflict was not reported');
});

test('occupied dsh-video main key refuses to mount anything', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ mainOccupants: [{ options: { key: PANEL_ID } }] });
  loaded.exports.apply(env.ctx);
  assert(liveRegistrations(env).length === 0, `expected no registrations, got ${liveRegistrations(env).length}`);
  assert(activationErrors(env).some((message) => message.includes('main-key-conflict')), 'main key conflict was not reported');
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
  assert(liveRegistrations(env).length === 0, `expected no registrations, got ${liveRegistrations(env).length}`);
  assert(
    activationErrors(env).some((message) => message.includes('main-entries-unavailable')),
    'enumeration failure was not reported'
  );
});
//#endregion

test('R1/D-P0-003-1: a late free leading declaration mounts the pair only then', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ declaredSlots: { [LEADING_SLOT]: false } });
  loaded.exports.apply(env.ctx);
  assert(liveRegistrations(env).length === 0, 'video panel must not exist before its leading entry does');
  assert(registrationOf(env, 'main') === undefined, 'main panel was registered before the leading seat existed');
  env.declareSlot(LEADING_SLOT, 'single');
  const live = liveRegistrations(env);
  assert(live.length === 2, `late free declaration did not mount the pair (got ${live.length})`);
  assert(
    JSON.stringify(live.map((entry) => entry.options.name)) === JSON.stringify([LEADING_SLOT, 'main']),
    `capsule must be registered before the panel: ${JSON.stringify(live.map((entry) => entry.options.name))}`
  );
  const nav = navigationOf(env);
  nav.onSelectMode('video');
  assert(env.events.panelCalls[env.events.panelCalls.length - 1] === PANEL_ID, 'navigation unavailable after late mount');
});

test('R1/D-P0-003-1: a late leading declaration with a competitor leaves no panel and recovers later', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ declaredSlots: { [LEADING_SLOT]: false } });
  loaded.exports.apply(env.ctx);
  assert(liveRegistrations(env).length === 0, 'video panel registered before its entry existed');
  // Competitor claims the seat while it is being declared, before our callback registers.
  env.entriesBySlot[LEADING_SLOT].push({ options: { priority: 0 } });
  env.declareSlot(LEADING_SLOT, 'single');
  assert(liveRegistrations(env).length === 0, `late conflicting declaration left ${liveRegistrations(env).length} registration(s)`);
  assert(
    activationErrors(env).some((message) => message.includes('leading-seat-conflict')),
    'late conflicting declaration was not reported'
  );
  assert(registrationOf(env, 'main') === undefined, 'a refused late entry still registered the video panel');
  // The competitor leaves and the seat is re-declared: the pair must recover together.
  env.entriesBySlot[LEADING_SLOT].length = 0;
  env.collapseSlot(LEADING_SLOT);
  env.declareSlot(LEADING_SLOT, 'single');
  const live = liveRegistrations(env);
  assert(live.length === 2, `recovered declaration did not mount the pair (got ${live.length})`);
  assert(live.filter((entry) => entry.options.name === 'main').length === 1, 'expected exactly one main registration');
  assert(live.filter((entry) => entry.options.name === LEADING_SLOT).length === 1, 'expected exactly one capsule registration');
});

test('R1/D-P0-003-1: a failed independent re-declaration releases the mounted pair', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  env.setActivePanel(PANEL_ID);
  assert(liveRegistrations(env).length === 2, 'baseline pair missing');
  env.collapseSlot(LEADING_SLOT);
  assert(liveRegistrations(env).length === 0, `a lost leading seat left ${liveRegistrations(env).length} registration(s)`);
  assert(
    env.events.panelCalls[env.events.panelCalls.length - 1] === null,
    'losing the entry while video was selected did not return the UI to the conversation'
  );
  // Competitor claims the re-declared seat: the panel must stay absent.
  env.entriesBySlot[LEADING_SLOT].push({ options: { priority: 0 } });
  env.declareSlot(LEADING_SLOT, 'single');
  assert(liveRegistrations(env).length === 0, 'refused re-declaration left a registration behind');
  assert(
    activationErrors(env).some((message) => message.includes('leading-seat-conflict')),
    'refused re-declaration was not reported'
  );
  // Seat becomes available again: re-declaration restores exactly one pair.
  env.entriesBySlot[LEADING_SLOT].length = 0;
  env.collapseSlot(LEADING_SLOT);
  env.declareSlot(LEADING_SLOT, 'single');
  const live = liveRegistrations(env);
  assert(live.length === 2, `re-declaration after conflict did not restore the pair (got ${live.length})`);
  const nav = navigationOf(env);
  nav.onSelectMode('video');
  assert(env.events.panelCalls[env.events.panelCalls.length - 1] === PANEL_ID, 'navigation unavailable after recovery');
});

test('R1: repeated leading re-declarations keep one pair live and clean up exactly once', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  for (let round = 0; round < 3; round += 1) {
    env.collapseSlot(LEADING_SLOT);
    assert(liveRegistrations(env).length === 0, `round ${round}: lost seat left live registrations`);
    env.declareSlot(LEADING_SLOT, 'single');
    const live = liveRegistrations(env);
    assert(live.length === 2, `round ${round}: expected exactly two live registrations, got ${live.length}`);
    assert(live.filter((entry) => entry.options.name === 'main').length === 1, `round ${round}: duplicate main registration`);
    assert(live.filter((entry) => entry.options.name === LEADING_SLOT).length === 1, `round ${round}: duplicate capsule registration`);
  }
  const cleanupErrors = activationErrors(env).filter((message) => message.includes('cleanup-failed'));
  assert(cleanupErrors.length === 0, `repeated lifecycle produced cleanup errors: ${cleanupErrors.join('; ')}`);
});

test('R1: collapsing main while video mode is selected releases the pair and returns to conversation', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  env.setActivePanel(PANEL_ID);
  assert(liveRegistrations(env).length === 2, 'baseline pair missing');
  env.collapseSlot('main');
  assert(liveRegistrations(env).length === 0, `main collapse left ${liveRegistrations(env).length} live registration(s)`);
  assert(
    env.events.panelCalls[env.events.panelCalls.length - 1] === null,
    'main collapse while video was selected did not return the UI to the conversation'
  );
  env.declareSlot('main', 'keyed');
  assert(liveRegistrations(env).length === 2, 'main re-declaration did not restore the pair');
});

test('R1: unloading while the pair is pending or refused leaves nothing live', () => {
  const pending = loadClient();
  const pendingEnv = createFakeEnvironment({ declaredSlots: { [LEADING_SLOT]: false } });
  pending.exports.apply(pendingEnv.ctx);
  assert(liveRegistrations(pendingEnv).length === 0, 'pending state unexpectedly registered something');
  pendingEnv.disposeAllInjections();
  pendingEnv.disposeAllEffects();
  assert(liveRegistrations(pendingEnv).length === 0, 'disposing a pending chain left registrations behind');

  const refused = loadClient();
  const refusedEnv = createFakeEnvironment();
  refusedEnv.entriesBySlot[LEADING_SLOT].push({ options: { priority: 0 } });
  refused.exports.apply(refusedEnv.ctx);
  assert(liveRegistrations(refusedEnv).length === 0, 'refused activation registered something');
  refusedEnv.disposeAllInjections();
  refusedEnv.disposeAllEffects();
  assert(liveRegistrations(refusedEnv).length === 0, 'disposing a refused chain left registrations behind');
});

//#region tests: R2 presentation continuity logic


test('R2: first mount starts at the authoritative active segment (no flash)', () => {
  const loaded = loadClient({ queueFrames: true });
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const tree = mountSwitch(loaded, env, LEADING_SLOT);
  const view = capsule(tree);
  assert(view !== null, 'mode capsule missing');
  assert(view.props['data-active'] === 'normal', 'active state must be normal on first load');
  assert(view.props['data-thumb'] === 'normal', 'first load must not animate from a wrong segment');
  assert(view.props['data-ready'] === 'false', 'transition should be off for the first paint');
  loaded.flushFrames();
});

test('R2: navigation records the leaving segment once and the next mount slides from it', () => {
  const loaded = loadClient({ queueFrames: true });
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const nav = navigationOf(env);
  nav.onSelectMode('video');
  assert(env.events.panelCalls[env.events.panelCalls.length - 1] === PANEL_ID, 'navigation must be immediate');
  env.setActivePanel(PANEL_ID);

  const firstVideoMount = capsule(mountSwitch(loaded, env, 'main'));
  assert(firstVideoMount.props['data-active'] === 'video', 'authoritative active state must be video');
  assert(firstVideoMount.props['data-thumb'] === 'normal', 'new mount must start the glass at the leaving segment');
  assert(firstVideoMount.props['data-ready'] === 'false', 'start frame must not transition yet');
  const pressed = modeButtons(mountSwitch(loaded, env, 'main'));
  assert(pressed.video.props['aria-pressed'] === 'true', 'pressed state must reflect the host active panel immediately');

  // The hint is consumed by exactly one mount.
  const secondVideoMount = capsule(mountSwitch(loaded, env, 'main'));
  assert(secondVideoMount.props['data-thumb'] === 'video', 'presentation hint was replayed by a second mount');
  loaded.flushFrames();
});

test('R2: rapid reverse navigation keeps only the latest origin (interruptible, no backlog)', () => {
  const loaded = loadClient({ queueFrames: true });
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const nav = navigationOf(env);
  nav.onSelectMode('video');
  env.setActivePanel(PANEL_ID);
  const videoMount = capsule(mountSwitch(loaded, env, 'main'));
  assert(videoMount.props['data-thumb'] === 'normal', 'first direction did not record normal as origin');

  nav.onSelectMode('normal');
  env.setActivePanel(null);
  const normalMount = capsule(mountSwitch(loaded, env, LEADING_SLOT));
  assert(normalMount.props['data-active'] === 'normal', 'authoritative active state must be normal again');
  assert(normalMount.props['data-thumb'] === 'video', 'rapid reverse must start from the latest leaving segment');
  loaded.flushFrames();
});

test('R2: simplified effects skip the slide entirely', () => {
  const loaded = loadClient({ queueFrames: true });
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  env.setActivePanel(PANEL_ID);
  const workspace = mountSwitch(loaded, env, 'main');
  const toggle = find(workspace, (node) => node.type === 'button' && node.props.role === 'switch');
  toggle.props.onClick();
  const nav = navigationOf(env);
  nav.onSelectMode('normal');
  env.setActivePanel(null);
  const normalMount = capsule(mountSwitch(loaded, env, LEADING_SLOT));
  assert(normalMount.props['data-thumb'] === 'normal', 'simplified effects must not replay the slide');
  loaded.flushFrames();
});

test('R2: reduced-motion host preference skips the slide', () => {
  const loaded = loadClient({
    queueFrames: true,
    matchMedia: () => ({ matches: true }),
  });
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const nav = navigationOf(env);
  nav.onSelectMode('video');
  env.setActivePanel(PANEL_ID);
  const videoMount = capsule(mountSwitch(loaded, env, 'main'));
  assert(videoMount.props['data-thumb'] === 'video', 'reduced-motion must start at the destination segment');
  loaded.flushFrames();
});

test('R2: a failed navigation clears the presentation hint', () => {
  const loaded = loadClient({ queueFrames: true });
  const env = createFakeEnvironment({ selectPanelThrows: true });
  loaded.exports.apply(env.ctx);
  const nav = navigationOf(env);
  nav.onSelectMode('video');
  env.setActivePanel(PANEL_ID);
  const videoMount = capsule(mountSwitch(loaded, env, 'main'));
  assert(videoMount.props['data-thumb'] === 'video', 'failed navigation must not leave a stale origin');
  loaded.flushFrames();
});
//#endregion

//#region tests: persistence, rendering content, disposal
test('simplified-effects preference is versioned and restored', () => {
  const storage = createMemoryStorage();
  const loaded = loadClientWithStorage(storage);
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  env.setActivePanel(PANEL_ID);
  const props = Object.assign(
    { t: translate, usePanelInfo: activePanelHook(env) },
    registrationOf(env, 'main').options.inject()
  );

  const first = mount(loaded.react, registrationOf(env, 'main').component, props);
  const toggle = find(first, (node) => node.type === 'button' && node.props.role === 'switch');
  toggle.props.onClick();
  const stored = storage.map.get(PREFS_KEY);
  assert(typeof stored === 'string', 'preference was not persisted');
  const parsed = JSON.parse(stored);
  assert(parsed.version === 1, `stored payload version is ${parsed.version}`);
  assert(parsed.simplifiedEffects === true, 'stored payload did not record the simplified-effects value');

  const second = mount(loaded.react, registrationOf(env, 'main').component, props);
  const toggleAgain = find(second, (node) => node.type === 'button' && node.props.role === 'switch');
  assert(toggleAgain.props['aria-checked'] === 'true', 'persisted preference was not restored');
  const root = find(second, (node) => node.props && node.props.className === 'dv-root');
  assert(root !== null && root.props['data-simplified'] === 'true', 'video root did not apply the simplified mode');

  const fresh = loadClientWithStorage(storage);
  const freshEnv = createFakeEnvironment();
  fresh.exports.apply(freshEnv.ctx);
  freshEnv.setActivePanel(PANEL_ID);
  const freshProps = Object.assign(
    { t: translate, usePanelInfo: activePanelHook(freshEnv) },
    registrationOf(freshEnv, 'main').options.inject()
  );
  const freshRendered = mount(fresh.react, registrationOf(freshEnv, 'main').component, freshProps);
  const freshToggle = find(freshRendered, (node) => node.type === 'button' && node.props.role === 'switch');
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
    env.setActivePanel(PANEL_ID);
    const props = Object.assign(
      { t: translate, usePanelInfo: activePanelHook(env) },
      registrationOf(env, 'main').options.inject()
    );
    const rendered = mount(loaded.react, registrationOf(env, 'main').component, props);
    const toggle = find(rendered, (node) => node.type === 'button' && node.props.role === 'switch');
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
  env.setActivePanel(PANEL_ID);
  const props = Object.assign(
    { t: translate, usePanelInfo: activePanelHook(env) },
    registrationOf(env, 'main').options.inject()
  );
  const rendered = mount(loaded.react, registrationOf(env, 'main').component, props);
  const toggle = find(rendered, (node) => node.type === 'button' && node.props.role === 'switch');
  try {
    toggle.props.onClick();
  } catch (_error) {
    threw = true;
  }
  assert(threw === false, 'toggle threw when the storage write failed');
  const rerendered = mount(loaded.react, registrationOf(env, 'main').component, props);
  const toggleAgain = find(rerendered, (node) => node.type === 'button' && node.props.role === 'switch');
  assert(toggleAgain.props['aria-checked'] === 'true', 'in-memory value was lost after a failed write');
  assert(activationErrors(env).some((message) => message.includes('prefs-')), 'storage failures were not reported');
});

test('every registration is removed through its disposer (unload simulation)', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  assert(liveRegistrations(env).length === 2, 'expected two registrations before unload');
  env.setActivePanel(PANEL_ID);
  env.disposeAllInjections();
  env.disposeAllEffects();
  assert(liveRegistrations(env).length === 0, `registrations left live after unload: ${liveRegistrations(env).length}`);
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
