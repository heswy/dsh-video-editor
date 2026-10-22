/**
 * Browser glue for scripts/test-conversation-preview.mjs.
 *
 * Served verbatim as `/harness/page.js` into a real Chrome page together with:
 *   /harness/react-dom-lite.js     – scripts/lib/react-dom-lite.mjs with the
 *                                    export line rewritten to window.ReactLite
 *   /harness/conversation-module.js – the EXACT staged `client.js` factory body
 *                                    (all regions before `//#region plugin`),
 *                                    wrapped as `window.ConversationModule(React, h)`
 *   /harness/staged.css            – the staged bundle's own CSS
 *   /harness/locale.json           – the staged EN dictionary (for `t`)
 *
 * The page mounts the REAL staged `VideoWorkspace` component with the props the
 * host renderer injects through the main-panel declaration (locale `t`, the
 * navigation face and the session kit). The Native conversation RENDERER is the
 * only simulated seam: `sessions`, `SessionProvider` and `renderFactorySlot`
 * are small harness faces, documented in the evidence JSON. Everything left of
 * the conversation (project lifecycle, inspect polling, CanvasWorkspace,
 * snapshots, play/seek) is the staged product code talking to the real staged
 * Host over the real request route.
 *
 * No assertion lives here: the Node orchestrator drives this file through
 * `window.__CASE__` and real puppeteer mouse/keyboard input.
 */
(function () {
  'use strict';

  var ReactLite = window.ReactLite;
  var createElement = ReactLite.createElement;
  // The product VideoWorkspace renders its own `.dv-root`; mount into a neutral
  // container so the querySelector('.dv-root') state reader finds the product
  // component, not the harness host element.
  var container = document.getElementById('root');
  var MODULE = null;
  var dictionary = null;
  var root = null;
  var mountedAt = null;
  var backCalls = 0;
  var fetchLog = [];
  var injections = [];
  var pageErrors = [];
  var eventLog = [];
  var retained = [];
  var released = 0;
  var realFetch = window.fetch.bind(window);
  var REQUEST_PATH = '/api/dsh-video/request';

  // ── the one simulated seam: session kit + client session service ─────────
  // The native conversation renderer is host-owned and unchanged by P3-012; the
  // harness supplies inert faces so the real VideoWorkspace lifecycle (including
  // its hostRequest-based session.list/session.create path) runs unchanged.
  var sessionListSnapshot = { projectionsBySession: {} };
  var fakeSessions = {
    list: {
      getSnapshot: function getSnapshot() { return sessionListSnapshot; },
      subscribe: function subscribe() { return function unsubscribe() {}; },
    },
    retain: function retainSession(sessionId) {
      var face = {
        getSnapshot: function getSnapshot() { return { openState: 'open', sessionId: sessionId }; },
        subscribe: function subscribe() { return function unsubscribe() {}; },
      };
      var handle = {
        ready: Promise.resolve({ session: face }),
        release: function release() { released += 1; },
      };
      retained.push(sessionId);
      return handle;
    },
  };
  function FakeSessionProvider(props) {
    return props !== null && typeof props === 'object' && props.children !== undefined ? props.children : null;
  }
  function fakeRenderFactorySlot(name) {
    return createElement(
      'div',
      { className: 'dv-harness-conversation', 'data-slot': String(name) },
      'simulated native conversation renderer (host-owned, out of P3-012 scope)'
    );
  }

  // React 18 shim: react-dom-lite intentionally implements only the hooks the
  // P3-008 component needed; the workspace uses useSyncExternalStore twice.
  function useSyncExternalStoreShim(subscribe, getSnapshot) {
    var pair = ReactLite.React.useState(getSnapshot());
    var value = pair[0];
    var setValue = pair[1];
    ReactLite.React.useEffect(function subscribeEffect() {
      var unsubscribe = typeof subscribe === 'function' ? subscribe(function onChange() { setValue(getSnapshot()); }) : null;
      return function cleanupSubscription() {
        if (typeof unsubscribe === 'function') unsubscribe();
      };
    }, [subscribe, getSnapshot]);
    return value;
  }
  var ReactForModule = Object.assign({}, ReactLite.React, { useSyncExternalStore: useSyncExternalStoreShim });

  function sleep(ms) {
    return new Promise(function wait(resolve) { setTimeout(resolve, ms); });
  }

  function translation(key) {
    if (dictionary !== null && Object.prototype.hasOwnProperty.call(dictionary, key)) return dictionary[key];
    return key;
  }

  function sanitize(value, limit) {
    try {
      var text = JSON.stringify(value);
      if (typeof text !== 'string') return { unserializable: true };
      if (text.length <= limit) return value;
      return { truncated: true, length: text.length, preview: text.slice(0, limit) };
    } catch (_error) {
      return { unserializable: true };
    }
  }

  // ── instrumented fetch: request log + one-shot host-shaped failures ──────
  window.fetch = function instrumentedFetch(input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    // The staged client calls the route RELATIVELY (`api/dsh-video/request`), so
    // match the route suffix rather than an absolute path.
    var isRequest = url.indexOf('api/dsh-video/request') !== -1;
    var method = null;
    var params = null;
    if (isRequest && init && typeof init.body === 'string') {
      try {
        var parsed = JSON.parse(init.body);
        if (parsed !== null && typeof parsed === 'object') {
          method = typeof parsed.method === 'string' ? parsed.method : null;
          params = parsed.params;
        }
      } catch (_error) { method = null; }
    }
    var entry = { at: Date.now(), method: method, params: sanitize(params, 800), injected: null, kind: null };
    if (isRequest && method !== null) {
      for (var index = 0; index < injections.length; index += 1) {
        var injection = injections[index];
        if (injection.remaining > 0 && injection.method === method) {
          injection.remaining -= 1;
          injection.hits += 1;
          if (injection.kind === 'delay-snapshot') {
            entry.injected = 'DELAYED_SNAPSHOT';
            entry.kind = 'delay-snapshot';
            fetchLog.push(entry);
            var delayMs = Number.isFinite(Number(injection.delayMs)) ? Number(injection.delayMs) : 2000;
            return new Promise(function delayedResponse(resolveDelayed) {
              setTimeout(function sendAfterDelay() {
                resolveDelayed(realFetch(input, init));
              }, delayMs);
            });
          }
          if (injection.kind === 'fake-snapshot') {
            // R2 candidate-runtime-error probe: answer the snapshot request with a
            // synthetic SUCCESS whose entry document loads but whose fixed runtime
            // reports an error (the harness server serves that entry). This keeps
            // the failure at the runtime boundary, not at the transport boundary.
            entry.injected = 'FAKE_SNAPSHOT';
            entry.kind = 'fake-snapshot';
            fetchLog.push(entry);
            var requestedRevision = params !== null && typeof params === 'object' && typeof params.revision === 'string' ? params.revision : null;
            var requestedProject = params !== null && typeof params === 'object' && typeof params.projectId === 'string' ? params.projectId : null;
            return Promise.resolve({
              ok: true,
              status: 200,
              json: function json() {
                return Promise.resolve({
                  ok: true,
                  result: {
                    projectId: requestedProject,
                    snapshotId: 'f'.repeat(32),
                    revision: requestedRevision,
                    entry: 'index.html',
                    entryUrl: injection.entryUrl,
                    routeBase: '/api/dsh-video/preview',
                    files: [{ path: 'index.html', bytes: 1, sha256: '0'.repeat(64) }],
                  },
                });
              },
              text: function text() { return Promise.resolve(''); },
            });
          }
          entry.injected = injection.code;
          entry.kind = 'host-shaped-error';
          fetchLog.push(entry);
          return Promise.resolve({
            ok: false,
            status: 500,
            json: function json() {
              return Promise.resolve({
                ok: false,
                error: { code: injection.code, message: injection.message, uncertain: injection.uncertain === true },
              });
            },
            text: function text() { return Promise.resolve(''); },
          });
        }
      }
    }
    var pending = realFetch(input, init);
    if (!isRequest || method === null) {
      fetchLog.push(entry);
      return pending;
    }
    return pending.then(function recordResponse(response) {
      var clone = response.clone();
      return clone.json().then(function captureBody(body) {
        entry.responseStatus = response.status;
        entry.responseOk = body !== null && typeof body === 'object' && body.ok === true;
        entry.responseErrorCode = body !== null && typeof body === 'object' && body.error !== null && typeof body.error === 'object' && typeof body.error.code === 'string' ? body.error.code : null;
        entry.responseRevision = body !== null && typeof body === 'object' && body.result !== null && typeof body.result === 'object' && typeof body.result.revision === 'string' ? body.result.revision : null;
        entry.responseSnapshotId = body !== null && typeof body === 'object' && body.result !== null && typeof body.result === 'object' && typeof body.result.snapshotId === 'string' ? body.result.snapshotId : null;
        entry.responseProjectId = body !== null && typeof body === 'object' && body.result !== null && typeof body.result === 'object' && typeof body.result.projectId === 'string' ? body.result.projectId : null;
        entry.responseSessionId = body !== null && typeof body === 'object' && body.result !== null && typeof body.result === 'object' && typeof body.result.sessionId === 'string' ? body.result.sessionId : null;
        fetchLog.push(entry);
        return response;
      }, function unreadable() {
        entry.responseStatus = response.status;
        fetchLog.push(entry);
        return response;
      });
    }, function failed(error) {
      entry.responseStatus = null;
      entry.transportError = String(error && error.message ? error.message : error);
      fetchLog.push(entry);
      throw error;
    });
  };

  // ── event bookkeeping (no assertions) ────────────────────────────────────
  ['pointerdown', 'pointerup', 'click', 'dblclick', 'keydown', 'input', 'change'].forEach(function capture(type) {
    document.addEventListener(type, function logEvent(event) {
      if (eventLog.length >= 400) eventLog.shift();
      var target = event && event.target;
      var label = target === null || target === undefined ? null : String(target.nodeName || '').toLowerCase() + (typeof target.className === 'string' && target.className.length > 0 ? '.' + target.className.split(' ').slice(0, 3).join('.') : '');
      eventLog.push({ at: Date.now(), type: type, target: label });
    }, true);
  });
  window.addEventListener('error', function onError(event) {
    pageErrors.push(String((event && event.message) || 'window error'));
  });
  window.addEventListener('unhandledrejection', function onRejection(event) {
    var reason = event ? event.reason : null;
    pageErrors.push('unhandled rejection: ' + String((reason && (reason.message || reason.code)) || reason));
  });

  // ── DOM state readers ────────────────────────────────────────────────────
  function rectOf(node) {
    if (node === null || node === undefined) return null;
    var rect = node.getBoundingClientRect();
    return {
      left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      right: rect.right, bottom: rect.bottom,
      centerX: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2,
    };
  }

  function querySelectorRect(selector) {
    return rectOf(document.querySelector(selector));
  }

  function textOf(selector) {
    var node = document.querySelector(selector);
    return node === null ? null : node.textContent;
  }

  function buttonsOf(scope) {
    var nodes = Array.prototype.slice.call(scope.querySelectorAll('button'));
    return nodes.map(function describe(node) {
      return { text: (node.textContent || '').trim().slice(0, 80), className: typeof node.className === 'string' ? node.className : '', disabled: node.disabled === true, rect: rectOf(node) };
    });
  }

  /** First bar button whose copy is the localized play/pause label. */
  function previewPlayButtonOf(shell) {
    if (shell === null) return null;
    var bar = shell.querySelector('.dv-canvas-bar');
    if (bar === null) return null;
    var playText = translation('video.canvas.play');
    var pauseText = translation('video.canvas.pause');
    var candidates = Array.prototype.slice.call(bar.querySelectorAll('button'));
    var node = null;
    for (var index = 0; index < candidates.length; index += 1) {
      var text = (candidates[index].textContent || '').trim();
      if (text === playText || text === pauseText) { node = candidates[index]; break; }
    }
    if (node === null && candidates.length > 0) node = candidates[0];
    if (node === null) return null;
    return { text: (node.textContent || '').trim(), rect: rectOf(node), disabled: node.disabled === true };
  }

  function frameSnapshotId(src) {
    var match = typeof src === 'string' ? /\/preview\/([a-f0-9]{32})\//.exec(src) : null;
    return match !== null ? match[1] : null;
  }

  function describeFrame(node) {
    if (node === null || node === undefined) return null;
    var style = window.getComputedStyle(node);
    var rect = rectOf(node);
    return {
      className: typeof node.className === 'string' ? node.className : '',
      src: node.getAttribute('src'),
      snapshotId: frameSnapshotId(node.getAttribute('src')),
      visibility: style.visibility,
      display: style.display,
      pointerEvents: style.pointerEvents,
      ariaHidden: node.getAttribute('aria-hidden'),
      elementWidth: node.style.width,
      elementHeight: node.style.height,
      elementTransform: node.style.transform,
      rect,
      visible: style.visibility !== 'hidden' && style.display !== 'none' && rect !== null && rect.width > 0 && rect.height > 0,
      loadedAt: node.__harnessLoadedAt || null,
    };
  }

  /** Active = the visible last-ready frame; candidate = hidden preloading frame. */
  function classifyFrames() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll('.dv-stage-frame, .dv-stage-frame-candidate'));
    var active = [];
    var candidate = [];
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      var isCandidate = typeof node.className === 'string' && node.className.split(/\s+/).indexOf('dv-stage-frame-candidate') !== -1;
      (isCandidate ? candidate : active).push(describeFrame(node));
    }
    return { active, candidate };
  }

  function readState() {
    var rootNode = document.querySelector('.dv-root');
    var shell = document.querySelector('.dv-canvas-shell');
    var frames = classifyFrames();
    var iframe = frames.active.length > 0 ? frames.active[0] : null;
    var iframeSrc = iframe !== null ? iframe.src : null;
    var snapshotMatch = iframe !== null && iframe.snapshotId !== null ? [null, iframe.snapshotId] : null;
    var errorNodes = Array.prototype.slice.call(document.querySelectorAll('[role="alert"], .dv-error, .dv-canvas-status[role="alert"]'));
    var retryNodes = Array.prototype.slice.call(document.querySelectorAll('.dv-canvas-status button, button.dv-canvas-retry, .dv-canvas-bar button, .dv-preview-notice button'));
    var noticeNodes = Array.prototype.slice.call(document.querySelectorAll('.dv-preview-notice'));
    var statusNodes = Array.prototype.slice.call(document.querySelectorAll('.dv-canvas-status[role="alert"]'));
    return {
      at: Date.now(),
      mountedAt: mountedAt,
      projectId: rootNode !== null ? rootNode.getAttribute('data-project-id') : null,
      panel: rootNode !== null ? rootNode.getAttribute('data-panel') : null,
      sessionState: rootNode !== null ? rootNode.getAttribute('data-session') : null,
      sessionActive: rootNode !== null ? rootNode.getAttribute('data-session-active') : null,
      phase: shell !== null ? shell.getAttribute('data-canvas-phase') : null,
      revision: shell !== null ? shell.getAttribute('data-canvas-revision') : null,
      targetRevision: shell !== null ? shell.getAttribute('data-canvas-target-revision') : null,
      previewOnly: shell !== null ? shell.getAttribute('data-preview-only') : null,
      shellPresent: shell !== null,
      snapshotId: snapshotMatch !== null ? snapshotMatch[1] : null,
      iframeSrc: iframeSrc,
      activeFrames: frames.active,
      candidateFrames: frames.candidate,
      activeFrameCount: frames.active.length,
      candidateFrameCount: frames.candidate.length,
      activeVisibleFrames: frames.active.filter(function visible(frame) { return frame.visible === true; }).length,
      notices: noticeNodes.map(function describeNotice(node) {
        var button = node.querySelector('button');
        return { text: (node.textContent || '').trim().slice(0, 300), role: node.getAttribute('role'), rect: rectOf(node), retry: button === null ? null : { text: (button.textContent || '').trim(), rect: rectOf(button) } };
      }),
      noticeVisible: noticeNodes.length > 0,
      noticeTexts: noticeNodes.map(function text(node) { return (node.textContent || '').trim().slice(0, 300); }),
      fullErrorTexts: statusNodes.map(function text(node) { return (node.textContent || '').trim().slice(0, 300); }),
      fullErrorVisible: statusNodes.length > 0,
      canvasStatusRetry: (function retryRect() {
        if (statusNodes.length === 0) return null;
        var button = statusNodes[0].querySelector('button');
        return button === null ? null : { text: (button.textContent || '').trim(), rect: rectOf(button) };
      })(),
      iframe: iframe === null ? null : { rect: iframe.rect, clientWidth: iframe.rect === null ? 0 : iframe.rect.width, clientHeight: iframe.rect === null ? 0 : iframe.rect.height },
      stage: querySelectorRect('.dv-stage'),
      wrap: querySelectorRect('.dv-canvas-wrap'),
      canvasBar: querySelectorRect('.dv-canvas-bar'),
      timeText: textOf('.dv-time'),
      seek: (function () {
        var seek = document.querySelector('.dv-seek');
        return seek === null ? null : { value: seek.value, min: seek.min, max: seek.max, rect: rectOf(seek) };
      })(),
      buttons: buttonsOf(rootNode || document),
      barButtons: shell === null ? [] : buttonsOf(shell),
      playButton: previewPlayButtonOf(shell),
      errorTexts: errorNodes.map(function text(node) { return (node.textContent || '').trim().slice(0, 300); }).filter(function nonEmpty(value) { return value.length > 0; }),
      retryButtons: retryNodes.filter(function isRetry(node) { return /retry|重试/i.test(node.textContent || ''); }).map(function describe(node) { return { text: (node.textContent || '').trim(), rect: rectOf(node) }; }),
      bodyText: (document.body.innerText || '').slice(0, 1200),
      requestCount: fetchLog.length,
      retained: retained.length,
      released: released,
    };
  }

  // ── wait helpers (polling only; the Node side owns assertions) ───────────
  async function waitCanvas(expected, timeoutMs) {
    var started = Date.now();
    var deadline = started + (timeoutMs || 30000);
    var last = null;
    while (Date.now() < deadline) {
      last = readState();
      var phaseOk = expected.phase === undefined || last.phase === expected.phase;
      var revisionOk = expected.revision === undefined || last.revision === expected.revision;
      var targetOk = expected.targetRevision === undefined || last.targetRevision === expected.targetRevision;
      var snapshotDifferent = expected.snapshotDifferentFrom === undefined || (last.snapshotId !== null && last.snapshotId !== expected.snapshotDifferentFrom);
      var noticeOk = expected.notice === undefined || last.noticeVisible === expected.notice;
      var minActive = expected.minActiveFrames === undefined || last.activeFrameCount >= expected.minActiveFrames;
      var maxCandidate = expected.maxCandidateFrames === undefined || last.candidateFrameCount <= expected.maxCandidateFrames;
      var fullErrorOk = expected.fullError === undefined || last.fullErrorVisible === expected.fullError;
      if (phaseOk && revisionOk && targetOk && snapshotDifferent && noticeOk && minActive && maxCandidate && fullErrorOk) {
        return { ok: true, elapsedMs: Date.now() - started, state: last };
      }
      await sleep(50);
    }
    return { ok: false, elapsedMs: Date.now() - started, state: last || readState(), expectation: expected };
  }

  /** Wait for the compact retention notice + retry affordance. */
  async function waitNotice(timeoutMs) {
    var started = Date.now();
    var last = null;
    while (Date.now() - started < (timeoutMs || 20000)) {
      last = readState();
      if (last.noticeVisible === true && last.notices.length > 0 && last.notices[0].retry !== null) {
        return { ok: true, elapsedMs: Date.now() - started, state: last };
      }
      await sleep(50);
    }
    return { ok: false, elapsedMs: Date.now() - started, state: last || readState() };
  }

  async function waitError(timeoutMs) {
    var started = Date.now();
    var deadline = started + (timeoutMs || 20000);
    var last = null;
    while (Date.now() < deadline) {
      last = readState();
      if (last.errorTexts.length > 0 && last.phase === 'error') {
        return { ok: true, elapsedMs: Date.now() - started, state: last };
      }
      await sleep(50);
    }
    return { ok: false, elapsedMs: Date.now() - started, state: last || readState() };
  }

  async function waitTime(predicate, timeoutMs) {
    var started = Date.now();
    var deadline = started + (timeoutMs || 15000);
    var last = null;
    while (Date.now() < deadline) {
      last = readState();
      if (predicate(last) === true) return { ok: true, elapsedMs: Date.now() - started, state: last };
      await sleep(40);
    }
    return { ok: false, elapsedMs: Date.now() - started, state: last || readState() };
  }

  // Bind the real iframe load event as soon as the component creates the
  // sandboxed preview frame, so a load that happens before the harness asks is
  // still observable (phase=ready is set before the document finishes loading).
  var frameLoadCount = 0;
  // R2F: snapshot of each candidate iframe at creation time (before promotion),
  // so the harness can prove the hidden candidate is sized from ITS OWN metadata.
  var candidateObservations = [];
  function recordCandidateFrame(node) {
    if (node === null || node === undefined) return;
    if (node.__harnessCandidateRecorded === true) return;
    if (typeof node.className !== 'string') return;
    var classes = node.className.split(/\s+/);
    if (classes.indexOf('dv-stage-frame-candidate') === -1) return;
    node.__harnessCandidateRecorded = true;
    var described = describeFrame(node);
    candidateObservations.push({
      at: Date.now(),
      snapshotId: described.snapshotId,
      src: described.src,
      elementWidth: described.elementWidth,
      elementHeight: described.elementHeight,
      elementTransform: described.elementTransform,
      visibility: described.visibility,
      ariaHidden: described.ariaHidden,
      visible: described.visible,
    });
    if (candidateObservations.length > 50) candidateObservations.shift();
  }
  function bindFrameLoad(frame) {
    if (frame === null || frame === undefined || frame.__harnessLoadBound === true) return;
    frame.__harnessLoadBound = true;
    frame.__harnessLoadedAt = undefined;
    frame.addEventListener('load', function onFrameLoad() {
      frameLoadCount += 1;
      frame.__harnessLoadedAt = Date.now();
    });
  }
  if (typeof MutationObserver === 'function') {
    var frameObserver = new MutationObserver(function observeFrames() {
      var frames = document.querySelectorAll('.dv-stage-frame, .dv-stage-frame-candidate');
      for (var index = 0; index < frames.length; index += 1) {
        bindFrameLoad(frames[index]);
        recordCandidateFrame(frames[index]);
      }
    });
    frameObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  /**
   * Wait until the current preview iframe fired its real `load` event after
   * `since` (all subresources incl. the GSAP asset are loaded).
   */
  async function waitFrameLoad(since, timeoutMs) {
    var started = Date.now();
    var deadline = started + (timeoutMs || 8000);
    while (Date.now() < deadline) {
      var state = readState();
      var active = state.activeFrames;
      var frameNode = null;
      if (active.length > 0) {
        var nodes = document.querySelectorAll('.dv-stage-frame');
        for (var index = 0; index < nodes.length; index += 1) {
          var candidateClass = typeof nodes[index].className === 'string' && nodes[index].className.split(/\s+/).indexOf('dv-stage-frame-candidate') !== -1;
          if (!candidateClass) frameNode = nodes[index];
        }
        if (frameNode !== null) bindFrameLoad(frameNode);
      }
      if (frameNode !== null && frameNode.__harnessLoadedAt !== undefined && frameNode.__harnessLoadedAt >= since) {
        return { ok: true, elapsedMs: Date.now() - started, loadedAt: frameNode.__harnessLoadedAt, loadCount: frameLoadCount, state };
      }
      await sleep(40);
    }
    return { ok: false, elapsedMs: Date.now() - started, loadCount: frameLoadCount, state: readState() };
  }

  function seekTo(value) {
    var seek = document.querySelector('.dv-seek');
    if (seek === null) return false;
    seek.value = String(value);
    seek.dispatchEvent(new Event('input', { bubbles: true }));
    seek.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function inject(spec) {
    injections.push({
      method: spec.method,
      kind: typeof spec.kind === 'string' ? spec.kind : 'host-shaped-error',
      entryUrl: typeof spec.entryUrl === 'string' ? spec.entryUrl : null,
      delayMs: Number.isFinite(Number(spec.delayMs)) ? Number(spec.delayMs) : null,
      code: spec.code || 'E_PREVIEW_NOT_FOUND',
      message: spec.message || 'Injected preview failure',
      uncertain: spec.uncertain === true,
      remaining: Number.isInteger(spec.times) && spec.times > 0 ? spec.times : 1,
      hits: 0,
    });
    return injections.length - 1;
  }

  function clearInjections() {
    injections = [];
  }

  function injectionState() {
    return injections.map(function describe(item) {
      return { method: item.method, kind: item.kind, code: item.code, entryUrl: item.entryUrl, delayMs: item.delayMs, remaining: item.remaining, hits: item.hits };
    });
  }

  function mark() { return fetchLog.length; }
  function requestsSince(markIndex) { return fetchLog.slice(markIndex); }
  function logs() { return fetchLog.slice(); }

  /**
   * Rendered product-panel audit. The conversation side (`.dv-ai`) and the
   * compact project switcher (`.dv-projectbar`) are allowed product surfaces
   * and are excluded from the deferred-manual-control audit by the caller's
   * selector scope choice; this function reports raw presence so the Node side
   * can assert on it without any assertion moving into the browser.
   */
  function domAudit(forbiddenSelectors, forbiddenTexts) {
    var scope = document.querySelector('.dv-root') || document.body;
    function allowedZone(node) {
      return node.closest('.dv-ai, .dv-projectbar, .dv-topbar') !== null;
    }
    var present = [];
    for (var index = 0; index < forbiddenSelectors.length; index += 1) {
      var selector = forbiddenSelectors[index];
      var matches = Array.prototype.slice.call(scope.querySelectorAll(selector));
      for (var matchIndex = 0; matchIndex < matches.length; matchIndex += 1) {
        var node = matches[matchIndex];
        if (allowedZone(node)) continue;
        present.push({ selector: selector, className: typeof node.className === 'string' ? node.className : '', text: (node.textContent || '').trim().slice(0, 100) });
      }
    }
    var copyHits = [];
    var textNodes = Array.prototype.slice.call(scope.querySelectorAll('button,label,option,summary,span,div,th,td'));
    for (var textIndex = 0; textIndex < textNodes.length; textIndex += 1) {
      var textNode = textNodes[textIndex];
      if (textNode.children.length > 0) continue;
      if (allowedZone(textNode)) continue;
      var text = (textNode.textContent || '').trim();
      if (text.length === 0 || text.length > 120) continue;
      for (var forbiddenIndex = 0; forbiddenIndex < forbiddenTexts.length; forbiddenIndex += 1) {
        var forbidden = forbiddenTexts[forbiddenIndex];
        if (typeof forbidden === 'string' && forbidden.length > 0 && text === forbidden) {
          copyHits.push({ text: text, className: typeof textNode.className === 'string' ? textNode.className : '' });
          break;
        }
      }
    }
    var formControls = Array.prototype.slice.call(scope.querySelectorAll('input,select,textarea'))
      .filter(function outsideAllowed(node) { return !allowedZone(node); })
      .map(function describe(node) {
        return { tag: String(node.nodeName || '').toLowerCase(), type: node.getAttribute('type'), className: typeof node.className === 'string' ? node.className : '', value: node.value };
      });
    var canvasBar = document.querySelector('.dv-canvas-bar');
    var seek = document.querySelector('.dv-seek');
    var time = document.querySelector('.dv-time');
    var playButton = previewPlayButtonOf(document.querySelector('.dv-canvas-shell'));
    return {
      present: present,
      copyHits: copyHits,
      formControls: formControls,
      canvasBarPresent: canvasBar !== null,
      playButton: playButton,
      seekPresent: seek !== null,
      timePresent: time !== null,
      buttons: buttonsOf(scope),
      bodyText: (document.body.innerText || '').slice(0, 2000),
      conversationStubPresent: document.querySelector('.dv-harness-conversation') !== null,
    };
  }

  // ── mount / boot ─────────────────────────────────────────────────────────
  function mount() {
    if (root !== null) root.unmount();
    mountedAt = Date.now();
    fetchLog = [];
    // Injections are intentionally NOT cleared here: the initial-failure probe
    // arms one before the remount. Tests that need a clean slate call
    // clearInjections() explicitly.
    pageErrors = [];
    eventLog = [];
    retained = [];
    released = 0;
    root = ReactLite.createRoot(container);
    var props = {
      t: translation,
      onBack: function onBack() { backCalls += 1; },
      sessions: fakeSessions,
      layout: null,
      SessionProvider: FakeSessionProvider,
      renderFactorySlot: fakeRenderFactorySlot,
    };
    // Legacy composition retention suite. M3 timeline gestures/media have their own real Host/Chrome suite.
    root.render(createElement(MODULE.VideoWorkspace, {...props,timelineEnabled:false}));
    return true;
  }

  async function unmount() {
    if (root !== null) {
      root.unmount();
      root = null;
    }
    return true;
  }

  async function boot() {
    var response = await realFetch('/harness/locale.json');
    if (response.ok !== true) throw new Error('locale dictionary is unavailable: ' + response.status);
    dictionary = await response.json();
    // The staged factory body declares its own `const React = require('react')`;
    // deliver the harness React shim through the module contract, not as a param.
    MODULE = window.ConversationModule(function requireForModule(name) {
      if (name === 'react') return ReactForModule;
      throw new Error('unsupported module requested by the staged client: ' + String(name));
    });
    if (typeof MODULE.VideoWorkspace !== 'function') throw new Error('extracted VideoWorkspace is not a function');
    if (typeof MODULE.CanvasWorkspace !== 'function') throw new Error('extracted CanvasWorkspace is not a function');
    window.__CASE__ = {
      mount: mount,
      unmount: unmount,
      state: readState,
      waitCanvas: waitCanvas,
      waitError: waitError,
      waitTime: waitTime,
      waitFrameLoad: waitFrameLoad,
      waitNotice: waitNotice,
      seekTo: seekTo,
      candidateObservations: function candidateObservationList() { return candidateObservations.slice(); },
      rect: querySelectorRect,
      inject: inject,
      clearInjections: clearInjections,
      injectionState: injectionState,
      mark: mark,
      requestsSince: requestsSince,
      logs: logs,
      domAudit: domAudit,
      dictionary: function dictionaryCopy() { return dictionary; },
      pageErrors: function pageErrorsList() { return pageErrors.slice(); },
      events: function eventList() { return eventLog.slice(); },
      backCalls: function backCallCount() { return backCalls; },
      mountedAt: function mountedAtValue() { return mountedAt; },
    };
    window.__BOOTED__ = true;
  }

  boot().catch(function bootFailed(error) {
    window.__BOOT_ERROR__ = String((error && (error.stack || error.message)) || error);
    window.__BOOTED__ = true;
  });
})();
