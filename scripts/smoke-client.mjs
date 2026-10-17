#!/usr/bin/env node
/**
 * Local smoke test for the dsh-video Client half (P0-005 sidebar entry).
 *
 * Executes the real `client.js` in a Node VM with a minimal fake Slot runtime and
 * a minimal React-compatible hook shim. The fake runtime models the verified
 * 0.2.0-rc.2 contract that matters here:
 *
 *   - `ctx.slots.inject(key, callback)` WAITS while the slot is undeclared and
 *     runs the callback on every declaration lifetime (no throw for "not yet");
 *   - a collapsed declaration disposes the effect (and its registrations);
 *   - `ctx.slots.entries()` is the live occupant list used for conflict checks;
 *   - `main` is keyed, `sidebar.panellist` is a list keyed by `id` (0.2.0-rc.2
 *     source: ui-slots registers one cell per list id at one priority);
 *   - a sidebar row points at the matching `main` id, so both must be an atomic
 *     pair: the panel first, the entry only after it, and both released together.
 *
 * Covered here: registration shape, the panel -> sidebar atomic lifecycle under
 * late/repeated/collapsed declarations, failure rollback, coexistence with the
 * shipped rows, unload fallback without stealing another panel, restrained empty
 * state, display-menu semantics, preference persistence and corruption safety,
 * and the sidebar icon owner-props contract.
 *
 * Not covered / not claimed: real browser rendering, CSS animation playback,
 * layout, the exact host row pixels, installation or any live host verification.
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
const SIDEBAR_SLOT = 'sidebar.panellist';

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
    const domNode = { type, props: props || {}, children: renderNode((props || {}).children, context) };
    const forwardedRef = domNode.props.ref;
    if (forwardedRef !== undefined && forwardedRef !== null) {
      domNode.focus = function focus() {
        context.activeElement = domNode;
      };
      if (typeof forwardedRef === 'function') forwardedRef(domNode);
      else if (typeof forwardedRef === 'object') forwardedRef.current = domNode;
    }
    return domNode;
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
    renderInteractive(component, props) {
      const scope = { hooks: {}, hookIndex: 0, effects: [] };
      const context = { effects: [], cleanups: [], activeElement: null };
      let currentTree = null;
      function renderOnce() {
        for (const cleanup of context.cleanups.splice(0).reverse()) {
          try {
            cleanup();
          } catch (_error) {
            /* cleanup is best effort in the shim */
          }
        }
        scope.hookIndex = 0;
        scope.effects = [];
        const previous = currentRuntime;
        currentRuntime = scope;
        let rendered;
        try {
          rendered = component(props);
        } finally {
          currentRuntime = previous;
        }
        context.effects = [];
        for (const effect of scope.effects.splice(0)) context.effects.push(effect);
        currentTree = renderNode(rendered, context);
        for (const effect of context.effects.splice(0)) {
          let cleanup;
          try {
            cleanup = effect();
          } catch (_error) {
            /* effects are best effort in the shim */
          }
          if (typeof cleanup === 'function') context.cleanups.push(cleanup);
        }
        return currentTree;
      }
      return {
        render: renderOnce,
        rerender: renderOnce,
        tree: () => currentTree,
        activeElement: () => context.activeElement,
      };
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
  const initialDeclared = Object.assign({ main: 'keyed', [SIDEBAR_SLOT]: 'list' }, config.declaredSlots || {});
  for (const [slot, kind] of Object.entries(initialDeclared)) {
    if (kind !== false) declared[slot] = kind;
  }
  const entriesBySlot = {
    main: (config.mainOccupants || []).slice(),
    [SIDEBAR_SLOT]: (config.sidebarOccupants || []).slice(),
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
  let currentLocale = config.locale === undefined ? 'zh' : config.locale;
  const controllersBySlot = new Map();

  function entriesFor(slot) {
    if (entriesBySlot[slot] === undefined) entriesBySlot[slot] = [];
    return entriesBySlot[slot];
  }

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
      return entriesFor(slot).slice();
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
      const list = entriesFor(registration.name);
      if (kind === 'single' && list.length > 0) {
        throw new Error(`single slot "${registration.name}" already has a registration`);
      }
      if (kind === 'keyed') {
        if (registration.key === undefined) throw new Error(`keyed slot "${registration.name}" requires key`);
        if (list.some((entry) => entry.options.key === registration.key)) {
          throw new Error(`keyed slot "${registration.name}" already has key "${registration.key}"`);
        }
      }
      if (kind === 'list') {
        if (registration.id === undefined) throw new Error(`list slot "${registration.name}" requires an id`);
        if (list.some((entry) => entry.options.id === registration.id && (entry.options.priority || 0) === (registration.priority || 0))) {
          throw new Error(`list slot "${registration.name}" already has an entry with id "${registration.id}"`);
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
    declared[slot] = kind || (slot === 'main' ? 'keyed' : slot === SIDEBAR_SLOT ? 'list' : 'single');
    runWaitingControllers(slot);
  }

  function collapseSlot(slot) {
    if (declared[slot] === undefined) return;
    delete declared[slot];
    for (const controller of controllersBySlot.get(slot) || []) deactivateController(controller);
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
      bind(ns) {
        return function resolve(key) {
          const record = [...events.locale].reverse().find((entry) => entry.ns === ns);
          const dictionary = record && record.dicts ? record.dicts[currentLocale] || record.dicts.zh : null;
          return dictionary && typeof dictionary[key] === 'string' ? dictionary[key] : key;
        };
      },
      getSnapshot() {
        return { locale: currentLocale, revision: 0 };
      },
      subscribe() {
        return function unsubscribe() {};
      },
    },
    layout: {
      panelInfo: {
        getSnapshot() {
          return { activePanelId };
        },
        subscribe() {
          return function unsubscribe() {};
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
    setLocale(locale) {
      currentLocale = locale;
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

function mount(react, component, props) {
  return react.render(react.createElement(component, props)).tree;
}

function registrationOf(env, slotName) {
  return env.events.registrations.find((entry) => entry.options.name === slotName);
}

function dictionaryOf(env, locale) {
  const record = env.events.locale[0];
  return record && record.dicts ? record.dicts[locale || 'zh'] || {} : {};
}

function translateFor(env, locale) {
  const dictionary = dictionaryOf(env, locale);
  return function t(key) {
    return typeof dictionary[key] === 'string' ? dictionary[key] : key;
  };
}

function mountPanel(loaded, env) {
  const registration = registrationOf(env, 'main');
  assert(registration !== undefined, 'main panel is not registered');
  const props = Object.assign({ t: translateFor(env) }, registration.options.inject());
  return mount(loaded.react, registration.component, props);
}

function mountInteractivePanel(loaded, env) {
  const registration = registrationOf(env, 'main');
  assert(registration !== undefined, 'main panel is not registered');
  const props = Object.assign({ t: translateFor(env) }, registration.options.inject());
  return loaded.react.renderInteractive(registration.component, props);
}

function mountSidebarIcon(loaded, env, ownerProps) {
  const registration = registrationOf(env, SIDEBAR_SLOT);
  assert(registration !== undefined, 'sidebar entry is not registered');
  const props = Object.assign({ size: 16, active: false }, ownerProps || {});
  return mount(loaded.react, registration.component, props);
}

function sidebarEntryOf(env) {
  return registrationOf(env, SIDEBAR_SLOT);
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

function liveMain(env) {
  return liveRegistrations(env).filter((entry) => entry.options.name === 'main');
}

function liveSidebar(env) {
  return liveRegistrations(env).filter((entry) => entry.options.name === SIDEBAR_SLOT);
}

function findNode(tree, predicate) {
  return find(tree, predicate);
}

function findNodes(tree, predicate) {
  return findAll(tree, predicate);
}

function panelButton(tree, className) {
  return findNode(tree, (node) => node.type === 'button' && node.props && node.props.className === className);
}

function panelMenuItem(tree) {
  return findNode(tree, (node) => node.type === 'button' && node.props && node.props.role === 'menuitemcheckbox');
}
//#endregion

//#region tests: module + registration baseline
test('module registers one browser module with the dsh-video id and factory', () => {
  const loaded = loadClient();
  assert(loaded.registration.id === PANEL_ID, `module id is "${loaded.registration.id}"`);
  assert(typeof loaded.registration.factory === 'function', 'factory missing');
  assert(typeof loaded.exports.apply === 'function', 'plugin body lacks apply()');
  assert(
    JSON.stringify(loaded.exports.inject) === JSON.stringify(['slots', 'layout', 'locale']),
    `unexpected inject list: ${JSON.stringify(loaded.exports.inject)}`
  );
});

test('apply registers the video main panel and one native sidebar entry', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const main = registrationOf(env, 'main');
  assert(main !== undefined, 'main panel was not registered');
  assert(main.options.key === PANEL_ID, `main key is "${main.options.key}"`);
  const entry = sidebarEntryOf(env);
  assert(entry !== undefined, 'sidebar entry was not registered');
  assert(entry.options.id === PANEL_ID, 'sidebar id must address the same main panel');
  assert(entry.options.order === 30, `sidebar order is ${entry.options.order}`);
  assert(typeof entry.options.label === 'function', 'sidebar label must be a locale-aware thunk');
  assert(entry.options.label() === 'Vedio Editor', `sidebar label is "${entry.options.label()}"`);
  assert(env.events.locale.length === 1 && env.events.locale[0].ns === 'dshVideo', 'locale dictionaries not registered');
  assert(registrationOf(env, 'conversation.header.leading') === undefined, 'the old top capsule seat must not be used');
  assert(env.events.errors.length === 0, `unexpected activation errors: ${activationErrors(env).join('; ')}`);
});

test('sidebar label keeps the exact user spelling in both locales', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const entry = sidebarEntryOf(env);
  assert(entry.options.label() === 'Vedio Editor', 'zh label must be exactly Vedio Editor');
  env.setLocale('en');
  assert(entry.options.label() === 'Vedio Editor', 'en label must keep the exact user spelling');
  assert(dictionaryOf(env, 'zh')['nav.label'] === 'Vedio Editor', 'zh dictionary label missing');
  assert(dictionaryOf(env, 'en')['nav.label'] === 'Vedio Editor', 'en dictionary label missing');
});

test('sidebar icon honours the host owner props and native line style', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const tree = mountSidebarIcon(loaded, env, { size: 18, active: true });
  const svg = findNode(tree, (node) => node.type === 'svg');
  assert(svg !== null, 'sidebar icon did not render an svg');
  assert(svg.props.width === 18 && svg.props.height === 18, 'icon must use the host-provided square edge');
  assert(svg.props.viewBox === '0 0 16 16', 'icon must use the host 16-unit grid');
  assert(svg.props.stroke === 'currentColor', 'icon must follow the row colour with currentColor');
  assert(svg.props['aria-hidden'] === 'true', 'icon is decorative; the host row owns the accessible name');
  const defaultIcon = mountSidebarIcon(loaded, env);
  const defaultSvg = findNode(defaultIcon, (node) => node.type === 'svg');
  assert(defaultSvg.props.width === 16, 'icon must fall back to the expanded 16px edge');
});
//#endregion

//#region tests: panel content + display options
test('panel renders exactly one empty sentence, one return action and one display menu', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const tree = mountPanel(loaded, env);
  const root = findNode(tree, (node) => node.props && node.props.className === 'dv-root');
  assert(root !== null, 'video panel root missing');
  assert(root.props['data-simplified'] === 'false', 'simplified effects should default to off');
  const empty = findNode(tree, (node) => node.props && node.props.className === 'dv-empty');
  assert(empty !== null, 'empty state missing');
  assert(textOf(empty) === '尚无工程', `empty state is "${textOf(empty)}"`);
  const back = panelButton(tree, 'dv-back');
  assert(back !== null, 'return action missing');
  assert(back.props['aria-label'] === '返回对话', 'return action needs an accessible name');
  assert(textOf(back) === '返回对话', 'return action label missing');
  const display = findNode(tree, (node) => node.type === 'button' && node.props && node.props.className === 'dv-icon-button');
  assert(display !== null, 'display options trigger missing');
  assert(display.props['aria-label'] === '显示选项', 'display options trigger needs an accessible name');
  assert(panelMenuItem(tree) === null, 'display menu must start closed');
  const text = textOf(tree);
  for (const forbidden of ['空工作区', '从一个想法', '创建工程', '导出', '时间线', '预览', 'Vedio Editor']) {
    assert(text.includes(forbidden) === false, `panel still renders removed content "${forbidden}"`);
  }
});

test('return action leaves the video panel through the host layout service', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ activePanelId: PANEL_ID });
  loaded.exports.apply(env.ctx);
  const interactive = mountInteractivePanel(loaded, env);
  let tree = interactive.render();
  const back = panelButton(tree, 'dv-back');
  back.props.onClick();
  assert(env.events.panelCalls[env.events.panelCalls.length - 1] === null, 'return action did not ask for the conversation');
  tree = interactive.rerender();
  assert(findNode(tree, (node) => node.props && node.props.role === 'alert') === null, 'successful return must not show an error');
});

test('failed return is surfaced in place and reported once', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ activePanelId: PANEL_ID, selectPanelThrows: true });
  loaded.exports.apply(env.ctx);
  const interactive = mountInteractivePanel(loaded, env);
  let tree = interactive.render();
  panelButton(tree, 'dv-back').props.onClick();
  tree = interactive.rerender();
  const alert = findNode(tree, (node) => node.props && node.props.role === 'alert');
  assert(alert !== null, 'failed return must render an in-place error');
  assert(textOf(alert) === '返回对话失败，请重试。', `error text is "${textOf(alert)}"`);
  assert(
    activationErrors(env).filter((message) => message.includes('navigation-failed')).length === 1,
    'navigation failure must be reported exactly once'
  );
});

test('display options menu toggles and persists the reduced-effects preference', () => {
  const storage = createMemoryStorage();
  const loaded = loadClientWithStorage(storage);
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const interactive = mountInteractivePanel(loaded, env);
  let tree = interactive.render();
  const display = findNode(tree, (node) => node.type === 'button' && node.props.className === 'dv-icon-button');
  assert(display.props['aria-expanded'] === 'false', 'menu must start collapsed');
  display.props.onClick();
  tree = interactive.rerender();
  const item = panelMenuItem(tree);
  assert(item !== null, 'display menu did not open');
  assert(item.props['aria-checked'] === 'false', 'simplified effects should default to off');
  const expanded = findNode(tree, (node) => node.type === 'button' && node.props.className === 'dv-icon-button');
  assert(expanded.props['aria-expanded'] === 'true', 'menu trigger did not expose the open state');
  item.props.onClick();
  tree = interactive.rerender();
  const root = findNode(tree, (node) => node.props && node.props.className === 'dv-root');
  assert(root.props['data-simplified'] === 'true', 'root did not apply the simplified state');
  const checked = panelMenuItem(tree);
  assert(checked.props['aria-checked'] === 'true', 'display option did not expose its checked state');
  const stored = storage.map.get(PREFS_KEY);
  assert(typeof stored === 'string', 'preference was not persisted');
  const parsed = JSON.parse(stored);
  assert(parsed.version === 1 && parsed.simplifiedEffects === true, 'stored preference payload is wrong');
  // Escape closes the menu again without leaving the panel.
  const menu = findNode(tree, (node) => node.props && node.props.className === 'dv-menu');
  menu.props.onKeyDown({ key: 'Escape', preventDefault() {} });
  tree = interactive.rerender();
  assert(panelMenuItem(tree) === null, 'Escape did not close the display menu');
});

test('R1: opening the display menu moves focus onto its item', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const interactive = mountInteractivePanel(loaded, env);
  let tree = interactive.render();
  const trigger = findNode(tree, (node) => node.type === 'button' && node.props.className === 'dv-icon-button');
  trigger.props.onClick();
  tree = interactive.rerender();
  const item = panelMenuItem(tree);
  assert(item !== null, 'display menu did not open');
  const active = interactive.activeElement();
  assert(active !== null, 'opening the menu did not move focus');
  assert(active.props && active.props.role === 'menuitemcheckbox', 'focus did not move onto the menu item');
});

test('R1: ArrowDown on the trigger opens and focuses the menu item', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const interactive = mountInteractivePanel(loaded, env);
  let tree = interactive.render();
  const trigger = findNode(tree, (node) => node.type === 'button' && node.props.className === 'dv-icon-button');
  let prevented = false;
  trigger.props.onKeyDown({ key: 'ArrowDown', preventDefault() { prevented = true; } });
  assert(prevented === true, 'ArrowDown must be handled');
  tree = interactive.rerender();
  const item = panelMenuItem(tree);
  assert(item !== null, 'ArrowDown did not open the menu');
  const active = interactive.activeElement();
  assert(active !== null && active.props && active.props.role === 'menuitemcheckbox', 'ArrowDown did not focus the item');
});

test('R1: Escape closes the menu and returns focus to the trigger', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const interactive = mountInteractivePanel(loaded, env);
  let tree = interactive.render();
  findNode(tree, (node) => node.type === 'button' && node.props.className === 'dv-icon-button').props.onClick();
  tree = interactive.rerender();
  const menu = findNode(tree, (node) => node.props && node.props.className === 'dv-menu');
  let prevented = false;
  menu.props.onKeyDown({ key: 'Escape', preventDefault() { prevented = true; } });
  tree = interactive.rerender();
  assert(prevented === true, 'Escape must be handled');
  assert(panelMenuItem(tree) === null, 'Escape did not close the menu');
  const active = interactive.activeElement();
  assert(active !== null && active.props && active.props.className === 'dv-icon-button', 'Escape did not return focus to the trigger');
});

test('R1: Tab closes the menu and returns focus without keeping it inside the removed menu', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const interactive = mountInteractivePanel(loaded, env);
  let tree = interactive.render();
  const trigger = findNode(tree, (node) => node.type === 'button' && node.props.className === 'dv-icon-button');
  trigger.props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
  tree = interactive.rerender();
  assert(panelMenuItem(tree) !== null, 'menu did not open for the Tab check');
  const activeBefore = interactive.activeElement();
  assert(activeBefore !== null && activeBefore.props.role === 'menuitemcheckbox', 'focus was not inside the menu before Tab');
  const menu = findNode(tree, (node) => node.props && node.props.className === 'dv-menu');
  let prevented = false;
  menu.props.onKeyDown({ key: 'Tab', preventDefault() { prevented = true; } });
  tree = interactive.rerender();
  assert(prevented === true, 'Tab must be handled so focus cannot stay on the removed node');
  assert(panelMenuItem(tree) === null, 'Tab did not close the menu');
  const activeAfter = interactive.activeElement();
  assert(activeAfter !== null && activeAfter.props && activeAfter.props.className === 'dv-icon-button', 'Tab did not return focus to the trigger');
});

test('R1: pressing the trigger again closes the menu and keeps focus on the trigger', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const interactive = mountInteractivePanel(loaded, env);
  let tree = interactive.render();
  let trigger = findNode(tree, (node) => node.type === 'button' && node.props.className === 'dv-icon-button');
  trigger.props.onClick();
  tree = interactive.rerender();
  assert(panelMenuItem(tree) !== null, 'menu did not open');
  trigger = findNode(tree, (node) => node.type === 'button' && node.props.className === 'dv-icon-button');
  trigger.props.onClick();
  tree = interactive.rerender();
  assert(panelMenuItem(tree) === null, 'second trigger press did not close the menu');
  const active = interactive.activeElement();
  assert(active !== null && active.props && active.props.className === 'dv-icon-button', 'closing did not keep focus on the trigger');
});

test('preferences are restored on a fresh module load', () => {
  const storage = createMemoryStorage({ [PREFS_KEY]: JSON.stringify({ version: 1, simplifiedEffects: true }) });
  const loaded = loadClientWithStorage(storage);
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  const tree = mountPanel(loaded, env);
  const root = findNode(tree, (node) => node.props && node.props.className === 'dv-root');
  assert(root.props['data-simplified'] === 'true', 'stored preference was not restored');
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
    const tree = mountPanel(loaded, env);
    const root = findNode(tree, (node) => node.props && node.props.className === 'dv-root');
    assert(root.props['data-simplified'] === 'false', `${label}: corrupt preference was not rejected`);
  }
});

test('storage read/write exceptions do not break activation or the menu', () => {
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
  const interactive = mountInteractivePanel(loaded, env);
  let tree = interactive.render();
  findNode(tree, (node) => node.type === 'button' && node.props.className === 'dv-icon-button').props.onClick();
  tree = interactive.rerender();
  try {
    panelMenuItem(tree).props.onClick();
    tree = interactive.rerender();
  } catch (_error) {
    threw = true;
  }
  assert(threw === false, 'display option threw when the storage write failed');
  const root = findNode(tree, (node) => node.props && node.props.className === 'dv-root');
  assert(root.props['data-simplified'] === 'true', 'in-memory value was lost after a failed write');
  assert(activationErrors(env).some((message) => message.includes('prefs-')), 'storage failures were not reported');
});
//#endregion

//#region tests: sidebar/main atomic lifecycle
test('sidebar declared late: the pair mounts only together', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ declaredSlots: { [SIDEBAR_SLOT]: false } });
  loaded.exports.apply(env.ctx);
  assert(liveRegistrations(env).length === 0, 'nothing may register before the sidebar entry exists');
  assert(registrationOf(env, 'main') === undefined, 'main panel must not exist before its sidebar entry');
  env.declareSlot(SIDEBAR_SLOT, 'list');
  assert(liveMain(env).length === 1, 'main panel missing after sidebar declaration');
  assert(liveSidebar(env).length === 1, 'sidebar entry missing after declaration');
  const nav = navigationOf(env);
  nav.onBack();
  assert(env.events.panelCalls[env.events.panelCalls.length - 1] === null, 'navigation unavailable after late mount');
});

test('main declared late: the pair mounts only together', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ declaredSlots: { main: false } });
  loaded.exports.apply(env.ctx);
  assert(liveRegistrations(env).length === 0, 'nothing may register before the main declaration exists');
  assert(registrationOf(env, SIDEBAR_SLOT) === undefined, 'sidebar entry must not exist before its panel');
  env.declareSlot('main', 'keyed');
  assert(liveMain(env).length === 1, 'main panel missing after declaration');
  assert(liveSidebar(env).length === 1, 'sidebar entry missing after declaration');
});

test('the new sidebar row coexists with the shipped panel rows', () => {
  const loaded = loadClient();
  const shipped = [
    { options: { id: 'plugins', order: 0, label: 'plugins' } },
    { options: { id: 'schedules', order: 10, label: 'schedules' } },
    { options: { id: 'dsh-context', order: 20, label: 'context' } },
  ];
  const env = createFakeEnvironment({ sidebarOccupants: shipped });
  loaded.exports.apply(env.ctx);
  const entries = env.entriesBySlot[SIDEBAR_SLOT];
  assert(entries.length === 4, `expected 3 shipped rows + ours, got ${entries.length}`);
  assert(entries.indexOf(shipped[0]) >= 0 && entries.indexOf(shipped[2]) >= 0, 'shipped rows were replaced');
  const ours = entries.find((entry) => entry.options && entry.options.id === PANEL_ID);
  assert(ours !== undefined, 'our sidebar row is missing');
  assert(ours.options.order === 30, 'our row must sort after the shipped rows');
  assert(env.events.errors.length === 0, `unexpected activation errors: ${activationErrors(env).join('; ')}`);
});

test('an occupied sidebar id refuses the whole pair', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ sidebarOccupants: [{ options: { id: PANEL_ID, order: 30 } }] });
  loaded.exports.apply(env.ctx);
  assert(liveRegistrations(env).length === 0, 'a conflicting sidebar id left registrations behind');
  assert(registrationOf(env, 'main') === undefined, 'video panel was registered without a usable entry');
  assert(
    activationErrors(env).some((message) => message.includes('sidebar-entry-conflict')),
    'sidebar id conflict was not reported'
  );
  assert(
    activationErrors(env).some((message) => message.includes('sidebar-entry-unavailable')),
    'missing reachable entry was not diagnosed'
  );
});

test('an occupied main key refuses the whole pair', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ mainOccupants: [{ options: { key: PANEL_ID } }] });
  loaded.exports.apply(env.ctx);
  assert(liveRegistrations(env).length === 0, 'expected no registrations');
  assert(activationErrors(env).some((message) => message.includes('main-key-conflict')), 'main key conflict was not reported');
});

test('a sidebar registration failure rolls the video panel back', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ registerThrows: { [SIDEBAR_SLOT]: true } });
  loaded.exports.apply(env.ctx);
  assert(liveRegistrations(env).length === 0, 'a failed sidebar entry left the video panel registered');
  assert(env.entriesBySlot.main.length === 0, 'main panel registration survived the rollback');
  const errors = activationErrors(env);
  assert(errors.some((message) => message.includes('sidebar-register-failed')), 'sidebar registration failure was not reported');
  assert(errors.some((message) => message.includes('sidebar-entry-unavailable')), 'missing entry was not diagnosed');
});

test('a main registration failure leaves no sidebar entry', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment({ registerThrows: { main: true } });
  loaded.exports.apply(env.ctx);
  assert(liveRegistrations(env).length === 0, 'a failed main panel left registrations behind');
  assert(registrationOf(env, SIDEBAR_SLOT) === undefined, 'a sidebar entry was registered without its panel');
  assert(activationErrors(env).some((message) => message.includes('main-register-failed')), 'main registration failure was not reported');
});

test('slot enumeration failure refuses to mount without throwing', () => {
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

//#region tests: collapse, retry and unload
test('sidebar collapse while video is selected releases the pair and returns to the conversation', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  env.setActivePanel(PANEL_ID);
  assert(liveRegistrations(env).length === 2, 'baseline pair missing');
  env.collapseSlot(SIDEBAR_SLOT);
  assert(liveRegistrations(env).length === 0, `a lost sidebar entry left ${liveRegistrations(env).length} registration(s)`);
  assert(env.events.panelCalls[env.events.panelCalls.length - 1] === null, 'losing the entry did not return the UI to the conversation');
  env.declareSlot(SIDEBAR_SLOT, 'list');
  assert(liveMain(env).length === 1 && liveSidebar(env).length === 1, 'redeclaration did not restore the pair');
  const cleanupErrors = activationErrors(env).filter((message) => message.includes('cleanup-failed'));
  assert(cleanupErrors.length === 0, `cleanup errors after collapse: ${cleanupErrors.join('; ')}`);
});

test('main collapse releases the sidebar entry; redeclaration restores the pair', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  env.setActivePanel(PANEL_ID);
  env.collapseSlot('main');
  assert(liveRegistrations(env).length === 0, `main collapse left ${liveRegistrations(env).length} live registration(s)`);
  assert(env.events.panelCalls[env.events.panelCalls.length - 1] === null, 'main collapse while video was selected did not return to the conversation');
  env.declareSlot('main', 'keyed');
  assert(liveMain(env).length === 1 && liveSidebar(env).length === 1, 'main redeclaration did not restore the pair');
});

test('losing the entry does not steal another panel', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  env.setActivePanel('plugins');
  env.collapseSlot(SIDEBAR_SLOT);
  assert(liveRegistrations(env).length === 0, 'pair was not released');
  assert(env.events.panelCalls.length === 0, 'another panel selection was disturbed');
  env.declareSlot(SIDEBAR_SLOT, 'list');
  assert(liveMain(env).length === 1 && liveSidebar(env).length === 1, 'pair did not recover');
});

test('repeated declaration cycles keep exactly one pair and no duplicate registration', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  for (let round = 0; round < 3; round += 1) {
    env.collapseSlot(SIDEBAR_SLOT);
    assert(liveRegistrations(env).length === 0, `round ${round}: lost entry left live registrations`);
    env.declareSlot(SIDEBAR_SLOT, 'list');
    assert(liveMain(env).length === 1, `round ${round}: expected exactly one main registration`);
    assert(liveSidebar(env).length === 1, `round ${round}: expected exactly one sidebar entry`);
  }
  const cleanupErrors = activationErrors(env).filter((message) => message.includes('cleanup-failed'));
  assert(cleanupErrors.length === 0, `repeated lifecycle produced cleanup errors: ${cleanupErrors.join('; ')}`);
});

test('unloading while video is selected removes everything and returns to the conversation', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  env.setActivePanel(PANEL_ID);
  env.disposeAllInjections();
  env.disposeAllEffects();
  assert(liveRegistrations(env).length === 0, `registrations left live after unload: ${liveRegistrations(env).length}`);
  assert(env.events.panelCalls[env.events.panelCalls.length - 1] === null, 'unload while video was selected did not return to the conversation');
});

test('unloading while another panel is selected does not steal it', () => {
  const loaded = loadClient();
  const env = createFakeEnvironment();
  loaded.exports.apply(env.ctx);
  env.setActivePanel('plugins');
  env.disposeAllInjections();
  env.disposeAllEffects();
  assert(liveRegistrations(env).length === 0, 'registrations left live after unload');
  assert(env.events.panelCalls.length === 0, 'unload disturbed another selected panel');
});
//#endregion

for (const name of passes) console.log(`PASS  ${name}`);
for (const [name, message] of failures) console.error(`FAIL  ${name}: ${message}`);
console.log(`\n${passes.length} passed, ${failures.length} failed`);
if (failures.length > 0) process.exitCode = 1;
