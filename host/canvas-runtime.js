/**
 * Fixed Host-owned preview runtime (P3-008).
 *
 * Adapted from the reviewed P3-005-B spike runtime (`ea2d1a4`), not a new
 * authority: it talks only to its parent frame, drives the snapshot document's
 * own GSAP timeline, and answers the frozen v1 command/event contract. The
 * Host injects this as an external script under a CSP; snapshot bytes remain
 * read-only and unchanged.
 */
export const CANVAS_RUNTIME_VERSION = "p3-008-runtime.1";

export const CANVAS_RUNTIME_SOURCE = String.raw`// P3-008 fixed preview runtime, adapted from the independently reviewed P3-005-B spike (ea2d1a4). It is served by the plugin Host and
// injected as an external script (same origin allow-list as the snapshot
// assets) into the sandboxed snapshot document. It owns no host/Node/model
// authority: it can only drive the document's own GSAP timeline
// (\`window.__timelines.main\`), answer hit/state queries and report events over
// postMessage.
//
// Contract: v1, see public/contract.js. Composition coordinates are CSS pixels
// in the document viewport; the sandbox document is rendered at its natural
// size and scaled by the Host layer.
//
// Playback model: composition duration comes from #main[data-duration] (the
// authoritative film length), while the GSAP timeline may end earlier because
// the last scene has no trailing tween. The runtime therefore keeps its own
// playhead over the composition duration and renders the GSAP state at
// min(time, timeline.duration()).
(() => {
  "use strict";

  const CONTRACT_VERSION = 1;
  const RUNTIME_VERSION = "p3-008-runtime.1";
  const INSTANCE_ID = /^[a-z0-9][a-z0-9-]{7,63}$/;
  const NONCE = /^[a-f0-9]{32}$/;
  const MAX_ELEMENTS = 512;
  const MAX_TEXT = 2048;
  const MAX_ERROR = 512;
  const WINDOW_EPSILON = 1e-6;

  const script = document.currentScript;
  if (!script) return;
  let parameters;
  try {
    parameters = new URL(script.src, location.href).searchParams;
  } catch {
    return;
  }
  const instanceId = parameters.get("instance") ?? "";
  const nonce = parameters.get("nonce") ?? "";
  const contractVersion = Number(parameters.get("v"));
  if (
    contractVersion !== CONTRACT_VERSION ||
    !INSTANCE_ID.test(instanceId) ||
    !NONCE.test(nonce)
  )
    return;

  const diagnostics = [];
  let eventSeq = 0;
  let destroyed = false;
  let timeline = null;
  let main = null;
  let windows = [];
  let parentWindow = null;
  let compositionDuration = 0;
  let compositionTime = 0;
  let playing = false;
  let rafId = null;
  let lastTickAt = null;
  try {
    parentWindow = window.parent;
  } catch {
    return;
  }

  function send(type, payload, replyTo = null) {
    if (destroyed) return;
    eventSeq += 1;
    try {
      parentWindow.postMessage(
        {
          v: CONTRACT_VERSION,
          kind: "evt",
          instanceId,
          nonce,
          seq: eventSeq,
          type,
          replyTo,
          payload,
        },
        "*",
      );
    } catch {
      // Parent window is gone (teardown race); nothing else to do.
    }
  }

  function diagnostic(code) {
    if (diagnostics.length >= 16) return;
    diagnostics.push(code);
  }

  window.addEventListener("error", (event) => {
    diagnostic("window-error");
    send("error", {
      code: "E_RUNTIME",
      message: String(event.message || "runtime error").slice(0, MAX_ERROR),
    });
  });
  window.addEventListener("unhandledrejection", () => {
    diagnostic("unhandled-rejection");
  });

  function sceneIdOf(element) {
    const section = element.closest("[data-scene-id]");
    return section?.getAttribute("data-scene-id") ?? null;
  }

  function rectOf(element) {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  function visibleForTime(element, time) {
    // The generated document encodes time windows as data-start/data-duration
    // (composition time). HyperFrames applies them at export; the preview
    // runtime applies the same visibility window on every rendered step so
    // selection/hidden-object behavior matches the rendered film.
    let node = element;
    while (node && node !== main) {
      if (node.hasAttribute("data-start")) {
        const start = Number(node.getAttribute("data-start"));
        const duration = Number(node.getAttribute("data-duration"));
        if (Number.isFinite(start) && Number.isFinite(duration)) {
          if (time < start - WINDOW_EPSILON) return false;
          if (time >= start + duration - WINDOW_EPSILON) return false;
        }
      }
      node = node.parentElement;
    }
    return true;
  }

  function computedVisible(element) {
    let node = element;
    while (node && node !== main) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (Number(style.opacity) < 0.05) return false;
      node = node.parentElement;
    }
    return true;
  }

  function styleSnapshot(element) {
    const style = getComputedStyle(element);
    return {
      fontSize: style.fontSize,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      color: style.color,
      textAlign: style.textAlign,
      letterSpacing: style.letterSpacing,
      whiteSpace: style.whiteSpace,
    };
  }

  function hitAt(x, y) {
    if (!main) return null;
    const rect = main.getBoundingClientRect();
    if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
    const candidates = document.elementsFromPoint(x, y);
    const stack = [];
    const seen = new Set();
    let found = null;
    for (const candidate of candidates) {
      const host = candidate.closest("[data-hf-id]");
      if (!host || !main.contains(host)) continue;
      const stableId = host.getAttribute("data-hf-id");
      if (seen.has(stableId)) continue;
      seen.add(stableId);
      stack.push(stableId);
      if (found) continue;
      if (!computedVisible(host)) continue;
      if (!visibleForTime(host, compositionTime)) continue;
      found = {
        stableId,
        sceneId: sceneIdOf(host),
        tag: host.tagName.toLowerCase(),
        text: (host.innerText ?? host.textContent ?? "").slice(0, MAX_TEXT),
        rect: rectOf(host),
        style: styleSnapshot(host),
      };
    }
    if (!found) return null;
    return { ...found, stack: stack.slice(0, 32) };
  }

  function elementList() {
    const elements = [];
    for (const element of main.querySelectorAll("[data-hf-id]")) {
      if (elements.length >= MAX_ELEMENTS) break;
      const stableId = element.getAttribute("data-hf-id");
      if (!stableId) continue;
      const start = element.hasAttribute("data-start")
        ? Number(element.getAttribute("data-start"))
        : null;
      const duration = element.hasAttribute("data-duration")
        ? Number(element.getAttribute("data-duration"))
        : null;
      elements.push({
        stableId,
        tag: element.tagName.toLowerCase(),
        sceneId: sceneIdOf(element),
        text: (element.innerText ?? element.textContent ?? "").slice(0, MAX_TEXT),
        rect: rectOf(element),
        start: Number.isFinite(start) ? start : null,
        duration: Number.isFinite(duration) ? duration : null,
        structural: element === main || element.tagName.toLowerCase() === "section",
      });
    }
    return elements;
  }

  function applyTimeWindows(time) {
    for (const entry of windows) {
      const visible =
        time >= entry.start - WINDOW_EPSILON &&
        time < entry.start + entry.duration - WINDOW_EPSILON;
      if (visible) {
        if (entry.element.style.visibility === "hidden")
          entry.element.style.visibility = "";
      } else if (entry.element.style.visibility !== "hidden") {
        entry.element.style.visibility = "hidden";
      }
    }
  }

  function renderAt(time) {
    // GSAP state: clamp to the timeline's own duration; the composition may
    // have a static tail after the last tween.
    const animationTime = Math.min(time, timeline.duration());
    timeline.time(animationTime);
    applyTimeWindows(time);
  }

  function state() {
    return { time: compositionTime, duration: compositionDuration, playing };
  }

  function stopClock() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    lastTickAt = null;
  }

  function tick(now) {
    if (!playing || destroyed) return;
    if (lastTickAt === null) lastTickAt = now;
    const delta = Math.max(0, (now - lastTickAt) / 1000);
    lastTickAt = now;
    compositionTime = Math.min(compositionDuration, compositionTime + delta);
    renderAt(compositionTime);
    if (compositionTime >= compositionDuration) {
      playing = false;
      stopClock();
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  function startClock() {
    if (compositionTime >= compositionDuration) compositionTime = 0;
    playing = true;
    stopClock();
    rafId = requestAnimationFrame(tick);
  }

  function validatePayload(type, payload) {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload))
      return null;
    const keys = Object.keys(payload);
    if (type === "seek") {
      if (keys.length !== 1 || keys[0] !== "time") return null;
      if (typeof payload.time !== "number" || !Number.isFinite(payload.time))
        return null;
      return { time: payload.time };
    }
    if (type === "hitTest") {
      if (keys.length !== 2 || !keys.includes("x") || !keys.includes("y")) return null;
      if (
        typeof payload.x !== "number" ||
        !Number.isFinite(payload.x) ||
        typeof payload.y !== "number" ||
        !Number.isFinite(payload.y)
      )
        return null;
      return { x: payload.x, y: payload.y };
    }
    if (keys.length !== 0) return null;
    return {};
  }

  const COMMAND_TYPES = new Set([
    "ping",
    "state",
    "seek",
    "play",
    "pause",
    "hitTest",
    "getElements",
    "destroy",
  ]);
  const COMMAND_KEYS = ["v", "kind", "instanceId", "nonce", "seq", "type", "payload"];

  function validCommand(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    if (Object.keys(data).length !== COMMAND_KEYS.length) return null;
    for (const key of COMMAND_KEYS) if (!(key in data)) return null;
    if (data.v !== CONTRACT_VERSION || data.kind !== "cmd") return null;
    if (data.instanceId !== instanceId || data.nonce !== nonce) return null;
    if (!Number.isInteger(data.seq) || data.seq < 1) return null;
    if (!COMMAND_TYPES.has(data.type)) return null;
    const payload = validatePayload(data.type, data.payload);
    if (payload === null) return null;
    return { seq: data.seq, type: data.type, payload };
  }

  function handleCommand(command) {
    const replyTo = command.seq;
    switch (command.type) {
      case "ping":
        send("pong", {}, replyTo);
        return;
      case "state":
        send("state", state(), replyTo);
        return;
      case "seek": {
        if (command.payload.time < 0 || command.payload.time > compositionDuration) {
          send(
            "error",
            { code: "E_TIME_RANGE", message: "seek time outside composition" },
            replyTo,
          );
          return;
        }
        compositionTime = command.payload.time;
        renderAt(compositionTime);
        if (playing) lastTickAt = null;
        send("seeked", { time: compositionTime }, replyTo);
        return;
      }
      case "play":
        startClock();
        send("playing", { time: compositionTime }, replyTo);
        return;
      case "pause":
        playing = false;
        stopClock();
        send("paused", { time: compositionTime }, replyTo);
        return;
      case "hitTest": {
        const hit = hitAt(command.payload.x, command.payload.y);
        send("hit", { hit }, replyTo);
        return;
      }
      case "getElements":
        send("elements", { elements: elementList() }, replyTo);
        return;
      case "destroy":
        send("destroyed", {}, replyTo);
        teardown();
        return;
      default:
        return;
    }
  }

  function teardown() {
    if (destroyed) return;
    destroyed = true;
    playing = false;
    stopClock();
    try {
      timeline.pause();
      timeline.time(0);
      for (const entry of windows) entry.element.style.visibility = "";
    } catch {
      diagnostic("teardown-timeline");
    }
    windows = [];
    window.removeEventListener("message", onMessage);
  }

  function onMessage(event) {
    if (destroyed) return;
    let fromParent = false;
    try {
      fromParent = event.source === parentWindow;
    } catch {
      fromParent = false;
    }
    if (!fromParent) return;
    const command = validCommand(event.data);
    if (!command) {
      diagnostic("invalid-command-dropped");
      return;
    }
    handleCommand(command);
  }

  function start() {
    main = document.querySelector("#main[data-composition-id]");
    timeline = window.__timelines?.main;
    if (!main || !timeline) {
      diagnostic("missing-timeline");
      send("error", {
        code: "E_NO_TIMELINE",
        message: "preview document has no #main / __timelines.main",
      });
      return;
    }
    const width =
      Number(main.getAttribute("data-width")) || main.getBoundingClientRect().width;
    const height =
      Number(main.getAttribute("data-height")) || main.getBoundingClientRect().height;
    compositionDuration = Number(main.getAttribute("data-duration"));
    if (!Number.isFinite(compositionDuration) || compositionDuration <= 0)
      compositionDuration = timeline.duration();
    for (const element of main.querySelectorAll("[data-start]")) {
      const startAt = Number(element.getAttribute("data-start"));
      const duration = Number(element.getAttribute("data-duration"));
      if (Number.isFinite(startAt) && Number.isFinite(duration))
        windows.push({ element, start: startAt, duration });
    }
    timeline.pause();
    renderAt(0);
    window.addEventListener("message", onMessage);
    send("ready", {
      runtimeVersion: RUNTIME_VERSION,
      width,
      height,
      duration: compositionDuration,
    });
  }

  // The script is injected after the document's own inline timeline script, so
  // this normally runs synchronously; fall back to a short poll for robustness.
  let attempts = 0;
  const poll = () => {
    if (destroyed) return;
    if (window.__timelines?.main && document.querySelector("#main[data-composition-id]")) {
      start();
      return;
    }
    attempts += 1;
    if (attempts > 100) {
      diagnostic("timeline-timeout");
      send("error", {
        code: "E_NO_TIMELINE",
        message: "preview runtime timed out waiting for the document timeline",
      });
      return;
    }
    setTimeout(poll, 50);
  };
  poll();
})();
`;
