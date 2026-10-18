/**
 * Browser glue for scripts/test-canvas-workspace.mjs.
 *
 * Served verbatim as `/harness/page.js` into a real Chrome page together with:
 *   /harness/react-dom-lite.js  – scripts/lib/react-dom-lite.mjs, export line
 *                                 rewritten to `window.ReactLite = {...}`
 *   /harness/canvas-module.js   – exact staged `client.js` slices for
 *                                 `//#region host bridge helpers` and
 *                                 `//#region P3-008 canvas workspace`,
 *                                 wrapped as `window.CanvasModule(React, h)`
 *   /harness/staged.css         – the staged bundle's own CSS
 *   /harness/locale.json        – the staged EN dictionary (for `t`)
 *
 * The Node orchestrator only ever calls this file through `window.__CASE__`
 * plus real puppeteer mouse/keyboard input; no assertion lives here. The page
 * keeps the REAL CanvasWorkspace mounted on the REAL bridge (`hostRequest` ->
 * `/api/dsh-video/request` route of the staged VideoBridge), so every gesture
 * trades real HTTP requests and real worker revisions.
 */
(function () {
  'use strict';

  var container = document.querySelector('#root > .dv-root');
  var ReactLite = window.ReactLite;
  var React = ReactLite.React;
  var createElement = ReactLite.createElement;
  var MODULE = null;
  var dictionary = null;
  var root = null;
  var current = null;
  var fetchLog = [];
  var injections = [];
  var onErrors = [];
  var pageErrors = [];
  var eventLog = [];
  var realFetch = window.fetch.bind(window);
  var mountSeq = 0;

  function sleep(ms) {
    return new Promise(function wait(resolve) {
      setTimeout(resolve, ms);
    });
  }

  function translation(key) {
    if (dictionary !== null && Object.prototype.hasOwnProperty.call(dictionary, key)) return dictionary[key];
    return key;
  }

  function normalizeError(error) {
    if (error === null || error === undefined) return { code: 'E_UNKNOWN', message: 'unknown error' };
    return {
      code: typeof error.code === 'string' ? error.code : 'E_UNKNOWN',
      message: typeof error.message === 'string' ? error.message : String(error),
      uncertain: error.uncertain === true,
    };
  }

  function describeTarget(target) {
    if (target === null || target === undefined) return null;
    if (typeof target.className !== 'string') return String(target.nodeName || target);
    var className = target.className.split(' ').filter(function part(name) { return name.length > 0; }).slice(0, 3).join('.');
    return String(target.nodeName || '').toLowerCase() + (className ? '.' + className : '');
  }
  ['pointerdown', 'pointerup', 'click', 'dblclick', 'keydown'].forEach(function captureType(type) {
    document.addEventListener(type, function logEvent(event) {
      if (eventLog.length >= 200) eventLog.shift();
      eventLog.push({ type: type, target: describeTarget(event.target), detail: typeof event.detail === 'number' ? event.detail : null, key: typeof event.key === 'string' ? event.key : null });
    }, true);
  });

  window.addEventListener('error', function (event) {
    pageErrors.push(String((event && event.message) || 'window error'));
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event ? event.reason : null;
    pageErrors.push('unhandled rejection: ' + String((reason && (reason.message || reason.code)) || reason));
  });

  // ─── fetch instrumentation ───────────────────────────────────────────────
  // The request route is the real staged Host route; this wrapper only records
  // requests and lets the test inject a controlled Host-shaped failure for one
  // method (the component's own error path then runs unchanged).
  window.fetch = function instrumentedFetch(input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var method = null;
    if (init && typeof init.body === 'string') {
      try {
        var parsed = JSON.parse(init.body);
        if (parsed !== null && typeof parsed === 'object' && typeof parsed.method === 'string') method = parsed.method;
      } catch (_error) {
        method = null;
      }
    }
    var entry = { at: Date.now(), url: String(url), method: method, injected: null };
    if (method !== null) {
      for (var index = 0; index < injections.length; index += 1) {
        var injection = injections[index];
        if (injection.remaining > 0 && injection.method === method) {
          injection.remaining -= 1;
          injection.hits += 1;
          entry.injected = injection.code;
          fetchLog.push(entry);
          return Promise.resolve({
            ok: false,
            status: 409,
            json: function json() {
              return Promise.resolve({
                ok: false,
                error: { code: injection.code, message: injection.message || 'Injected failure' },
              });
            },
            text: function text() {
              return Promise.resolve('');
            },
          });
        }
      }
    }
    fetchLog.push(entry);
    return realFetch(input, init);
  };

  // ─── real component mounting ─────────────────────────────────────────────
  function readState() {
    var shell = document.querySelector('.dv-canvas-shell');
    var stage = document.querySelector('.dv-stage');
    var stageRect = stage ? stage.getBoundingClientRect() : null;
    var width = current && current.inspected && Number.isFinite(Number(current.inspected.width)) ? Number(current.inspected.width) : 1280;
    var height = current && current.inspected && Number.isFinite(Number(current.inspected.height)) ? Number(current.inspected.height) : 720;
    var scale = stageRect !== null && width > 0 ? stageRect.width / width : 0;
    function toComposition(rect) {
      if (rect === null || scale <= 0) return null;
      return {
        x: (rect.left - stageRect.left) / scale,
        y: (rect.top - stageRect.top) / scale,
        width: rect.width / scale,
        height: rect.height / scale,
        screen: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      };
    }
    function rectOf(selector) {
      var node = document.querySelector(selector);
      if (node === null) return null;
      var rect = node.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom, centerX: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2 };
    }
    var selectionNode = document.querySelector('.dv-selection');
    var editorNode = document.querySelector('.dv-inline-editor');
    var retryNode = document.querySelector('button.dv-editor-retry');
    var errorNodes = Array.prototype.slice.call(document.querySelectorAll('.dv-tool-error'));
    var hintNodes = Array.prototype.slice.call(document.querySelectorAll('.dv-tool-hint'));
    var iframe = document.querySelector('.dv-stage-frame');
    var iframeSrc = iframe !== null ? iframe.getAttribute('src') : null;
    var snapshotMatch = typeof iframeSrc === 'string' ? /\/preview\/([a-f0-9]{32})\//.exec(iframeSrc) : null;
    var phase = shell !== null ? shell.getAttribute('data-canvas-phase') : null;
    return {
      at: Date.now(),
      phase: phase,
      revision: shell !== null ? shell.getAttribute('data-canvas-revision') : null,
      inspectedRevision: current && current.inspected ? current.inspected.revision : null,
      projectId: current ? current.projectId : null,
      stage: stageRect !== null && scale > 0 ? {
        left: stageRect.left,
        top: stageRect.top,
        width: stageRect.width,
        height: stageRect.height,
        scale: scale,
        compositionWidth: width,
        compositionHeight: height,
      } : null,
      wrap: (function () {
        var wrap = document.querySelector('.dv-canvas-wrap');
        if (wrap === null) return null;
        var rect = wrap.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      })(),
      selection: selectionNode !== null ? toComposition(selectionNode.getBoundingClientRect()) : null,
      editor: editorNode !== null ? {
        value: editorNode.value,
        rect: toComposition(editorNode.getBoundingClientRect()),
      } : null,
      editorActions: document.querySelector('.dv-editor-actions') !== null,
      retryVisible: retryNode !== null,
      retryText: retryNode !== null ? retryNode.textContent : null,
      retryRect: rectOf('button.dv-editor-retry'),
      toolErrors: errorNodes.map(function text(node) { return node.textContent; }),
      toolHints: hintNodes.map(function text(node) { return node.textContent; }),
      errorVisible: errorNodes.length > 0,
      hintVisible: hintNodes.length > 0,
      iframeSrc: iframeSrc,
      snapshotId: snapshotMatch !== null ? snapshotMatch[1] : null,
      timeText: (function () {
        var node = document.querySelector('.dv-time');
        return node !== null ? node.textContent : null;
      })(),
      selectionNodeVisible: selectionNode !== null,
      handleSeRect: rectOf('.dv-handle-se'),
      stageStatus: (function () {
        var node = document.querySelector('.dv-canvas-status');
        return node !== null ? node.textContent : null;
      })(),
      onErrors: onErrors.slice(),
      mountSeq: mountSeq,
    };
  }

  async function onReload() {
    if (current === null || MODULE === null || root === null) throw { code: 'E_HARNESS', message: 'onReload before mount' };
    var next = await MODULE.hostRequest('inspect', { projectId: current.projectId });
    if (next === null || typeof next !== 'object' || typeof next.revision !== 'string') {
      throw { code: 'E_HARNESS_INSPECT', message: 'inspect returned no revision' };
    }
    current.inspected = next;
    current.props.inspected = next;
    root.render(createElement(MODULE.CanvasWorkspace, current.props));
    return next;
  }

  async function mount(options) {
    if (root !== null) {
      root.unmount();
      root = null;
    }
    mountSeq += 1;
    onErrors = [];
    current = null;
    var wrap = options.wrap || { width: 900, height: 400 };
    document.documentElement.style.setProperty('--harness-wrap-w', wrap.width + 'px');
    document.documentElement.style.setProperty('--harness-wrap-h', wrap.height + 'px');
    current = {
      projectId: options.projectId,
      inspected: options.inspected,
      props: null,
    };
    current.props = {
      t: translation,
      projectId: options.projectId,
      inspected: options.inspected,
      onReload: onReload,
      onError: function onError(error) {
        onErrors.push(normalizeError(error));
      },
    };
    root = ReactLite.createRoot(container);
    root.render(createElement(MODULE.CanvasWorkspace, current.props));
    await sleep(0);
    var started = Date.now();
    while (Date.now() - started < 25000) {
      var shell = document.querySelector('.dv-canvas-shell');
      var stage = document.querySelector('.dv-stage');
      if (shell !== null && shell.getAttribute('data-canvas-phase') === 'ready' && stage !== null && stage.getBoundingClientRect().width > 0) {
        // Give the fixed runtime its post-load handshake a moment, then let the
        // test seek/select; selection helpers retry, so this is only a hint.
        await sleep(220);
        return readState();
      }
      await sleep(40);
    }
    throw new Error('mount: canvas never reached ready phase; state=' + JSON.stringify(readState()).slice(0, 900)
      + ' debug=' + JSON.stringify(debugState()).slice(0, 3000)
      + ' html=' + document.body.innerHTML.slice(0, 3000));
  }

  function seek(time) {
    var input = document.querySelector('.dv-seek');
    if (input === null) throw new Error('seek control is missing');
    input.value = String(time);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function compToScreen(x, y) {
    var state = readState();
    if (state.stage === null) throw new Error('stage is not mounted');
    return {
      x: state.stage.left + x * state.stage.scale,
      y: state.stage.top + y * state.stage.scale,
      scale: state.stage.scale,
      stage: state.stage,
    };
  }

  function elementRect(selector) {
    var node = document.querySelector(selector);
    if (node === null) return null;
    var rect = node.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, centerX: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2 };
  }

  function inject(spec) {
    var injection = {
      method: spec.method,
      code: spec.code || 'E_PERSIST',
      message: spec.message || 'Injected failure',
      remaining: Number.isInteger(spec.times) && spec.times > 0 ? spec.times : 1,
      hits: 0,
    };
    injections.push(injection);
    return injections.length - 1;
  }

  function clearInjections() {
    injections = [];
  }

  function injectionState() {
    return injections.map(function describe(item) {
      return { method: item.method, code: item.code, remaining: item.remaining, hits: item.hits };
    });
  }

  function logs() {
    return fetchLog.slice();
  }

  function mark() {
    return fetchLog.length;
  }

  function requestsSince(markIndex) {
    return fetchLog.slice(markIndex);
  }

  function summarizeValue(value) {
    if (value === null) return null;
    if (value === undefined) return 'undefined';
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return 'array[' + value.length + ']';
    try {
      var keys = Object.keys(value).slice(0, 12);
      return 'object{' + keys.join(',') + '}';
    } catch (_error) {
      return 'object';
    }
  }

  function debugState() {
    if (root === null || root.instance === null) return null;
    var component = root.instance;
    var hooks = component.hooks.map(function cell(index) {
      if (cell === undefined) return { index: index, empty: true };
      if (Object.prototype.hasOwnProperty.call(cell, 'state')) return { index: index, state: summarizeValue(cell.state), hasSetter: typeof cell.setter === 'function' };
      if (cell.effect !== undefined) return { index: index, effectDeps: cell.effect.deps === undefined ? null : cell.effect.deps.map(summarizeValue), hasRun: cell.hasRun === true };
      return { index: index, other: true };
    });
    return {
      hookCount: component.hooks.length,
      hooks: hooks,
      child: component.child === null ? null : { kind: component.child.kind, type: typeof component.child.type === 'string' ? component.child.type : 'component' },
      childCount: component.child !== null && component.child.kind === 'host' ? component.child.children.length : null,
      bodyText: document.body.innerText.slice(0, 800),
    };
  }

  async function unmount() {
    if (root !== null) {
      root.unmount();
      root = null;
    }
    current = null;
    return true;
  }

  async function boot() {
    var response = await realFetch('/harness/locale.json');
    if (response.ok !== true) throw new Error('locale dictionary is unavailable: ' + response.status);
    dictionary = await response.json();
    MODULE = window.CanvasModule(React, createElement);
    if (typeof MODULE.CanvasWorkspace !== 'function') throw new Error('extracted CanvasWorkspace is not a function');
    window.__CASE__ = {
      mount: mount,
      seek: seek,
      state: readState,
      compToScreen: compToScreen,
      elementRect: elementRect,
      inject: inject,
      clearInjections: clearInjections,
      injectionState: injectionState,
      logs: logs,
      mark: mark,
      requestsSince: requestsSince,
      unmount: unmount,
      debug: debugState,
      pageErrors: function pageErrorsList() { return pageErrors.slice(); },
      events: function eventList() { return eventLog.slice(); },
      dictionary: function dictionaryCopy() { return dictionary; },
    };
    window.__BOOTED__ = true;
  }

  boot().catch(function bootFailed(error) {
    window.__BOOT_ERROR__ = String((error && (error.stack || error.message)) || error);
    window.__BOOTED__ = true;
  });
})();
