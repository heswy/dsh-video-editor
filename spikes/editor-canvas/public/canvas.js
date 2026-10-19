// P3-005-B Host-side canvas test page. It is a controlled test page, not the
// final DSH UI: it proves the sandboxed preview instance, real playback/seek,
// hit-test driven selection, in-place text edit write-back, and the layout
// persistence gap. All product mutations go through the Host bridge
// (`window.dshHostRequest`, backed by the real worker client), never by
// mutating the snapshot document.
import {
  CONTRACT_VERSION,
  MessageLedger,
  compositionToScreen,
  computeStage,
  proposedLayoutOp,
  screenToComposition,
  selectableFromCatalogue,
  validateTextCommit,
} from "./contract.js";

const $ = (id) => document.getElementById(id);
const RUNTIME_READY_TIMEOUT_MS = 15000;
const REQUEST_TIMEOUT_MS = 5000;
const HANDLE_NAMES = new Set(["nw", "ne", "se", "sw"]);

const metrics = {
  instancesCreated: 0,
  instancesRevoked: 0,
  instancesDestroyed: 0,
  commandsSent: 0,
  eventsAccepted: 0,
  eventsDropped: 0,
  foreignSourceMessages: 0,
  revokedRejections: 0,
  bridgeCalls: 0,
  lateResponseDrops: 0,
  lastEventOrigin: null,
};
const diagnostics = [];
const state = {
  session: null,
  catalogue: [],
  composition: { width: 1280, height: 720 },
  stage: { scale: 1, left: 0, top: 0, width: 1280, height: 720 },
  stageRect: null,
  instances: new Map(),
  active: null,
  playing: false,
  time: 0,
  selection: null,
  lastHit: null,
  editing: null,
  committing: false,
  pendingEdit: null,
  drag: null,
  gapProposal: null,
  suppressClick: false,
  pollTimer: null,
  ready: false,
  loading: false,
};

class CanvasError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

function randomHex(bytes) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return [...buffer].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function newInstanceId() {
  const id = `inst-${randomHex(6)}`;
  return id.length >= 8 ? id : `${id}-x`;
}

function note(type, detail) {
  const entry = { at: new Date().toISOString(), type, detail };
  diagnostics.push(entry);
  if (diagnostics.length > 400) diagnostics.shift();
  return entry;
}

function setStatus(kind, text) {
  const element = $("status");
  element.className = `status ${kind}`;
  element.textContent = text;
}

function showError(message) {
  const banner = $("error-banner");
  banner.classList.remove("hidden");
  banner.textContent = message;
}

function clearError() {
  $("error-banner").classList.add("hidden");
  $("error-banner").textContent = "";
}

async function bridge(op, payload = {}) {
  if (typeof window.dshHostRequest !== "function")
    throw new CanvasError("E_NO_HOST_BRIDGE", "Host bridge is not available");
  metrics.bridgeCalls += 1;
  const response = await window.dshHostRequest({ op, payload });
  if (!response || response.ok !== true)
    throw new CanvasError(
      response?.error?.code ?? "E_BRIDGE",
      response?.error?.message ?? "Host bridge failure",
    );
  return response;
}

class PreviewInstance {
  constructor({ session, onEvent }) {
    this.id = newInstanceId();
    this.nonce = randomHex(16);
    this.session = session;
    this.revoked = false;
    this.readyInfo = null;
    this.ledger = new MessageLedger({
      instanceId: this.id,
      nonce: this.nonce,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    this.waiters = new Map();
    this.onEvent = onEvent;
    this.frame = document.createElement("iframe");
    this.frame.setAttribute("sandbox", "allow-scripts");
    this.frame.setAttribute("referrerpolicy", "no-referrer");
    this.frame.setAttribute("title", "isolated preview snapshot");
    this.frame.style.width = `${session.project.width}px`;
    this.frame.style.height = `${session.project.height}px`;
    this.frame.src =
      `${session.entryUrl}?instance=${encodeURIComponent(this.id)}` +
      `&nonce=${encodeURIComponent(this.nonce)}`;
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
      this.readyTimer = setTimeout(() => {
        reject(new CanvasError("E_RUNTIME_TIMEOUT", "preview runtime did not report ready"));
      }, RUNTIME_READY_TIMEOUT_MS);
    });
    this.readyPromise.catch(() => {});
    metrics.instancesCreated += 1;
  }
  attach(container) {
    container.replaceChildren(this.frame);
  }
  async request(type, payload = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    if (this.revoked) {
      metrics.revokedRejections += 1;
      throw new CanvasError("E_INSTANCE_REVOKED", "preview instance was revoked");
    }
    const command = this.ledger.command(type, payload);
    metrics.commandsSent += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.waiters.has(command.seq)) return;
        this.waiters.delete(command.seq);
        this.ledger.expire(Date.now() + 1);
        reject(new CanvasError("E_REQUEST_TIMEOUT", `${type} timed out`));
      }, timeoutMs);
      this.waiters.set(command.seq, { resolve, reject, timer, type });
      try {
        this.frame.contentWindow.postMessage(command, "*");
      } catch (error) {
        clearTimeout(timer);
        this.waiters.delete(command.seq);
        reject(new CanvasError("E_TRANSPORT", String(error?.message ?? error)));
      }
    });
  }
  handleMessage(message) {
    const accepted = this.ledger.acceptEvent(message, { sourceOk: true });
    if (!accepted.accepted) {
      metrics.eventsDropped += 1;
      if (accepted.code === "E_LATE_RESPONSE") metrics.lateResponseDrops += 1;
      note("event-dropped", {
        instanceId: this.id,
        code: accepted.code,
        detail: accepted.detail,
      });
      return;
    }
    metrics.eventsAccepted += 1;
    if (accepted.replyTo !== null) {
      const waiter = this.waiters.get(accepted.replyTo);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.waiters.delete(accepted.replyTo);
      if (accepted.type === "error")
        waiter.reject(
          new CanvasError(accepted.payload.code, accepted.payload.message),
        );
      else waiter.resolve(accepted.payload);
      return;
    }
    if (accepted.type === "ready") {
      this.readyInfo = accepted.payload;
      clearTimeout(this.readyTimer);
      this.resolveReady(accepted.payload);
      this.onEvent("ready", { instanceId: this.id, payload: accepted.payload });
    } else if (accepted.type === "error") {
      note("runtime-error", accepted.payload);
      this.onEvent("error", { instanceId: this.id, payload: accepted.payload });
    }
  }
  revoke(reason) {
    if (this.revoked) return;
    this.revoked = true;
    metrics.instancesRevoked += 1;
    clearTimeout(this.readyTimer);
    this.rejectReady?.(new CanvasError("E_INSTANCE_REVOKED", reason));
    for (const [seq, waiter] of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new CanvasError("E_INSTANCE_REVOKED", reason));
      this.waiters.delete(seq);
    }
    this.ledger.revoke();
    this.frame.remove();
    note("instance-revoked", { instanceId: this.id, reason });
  }
  async destroy() {
    try {
      await this.request("destroy");
      metrics.instancesDestroyed += 1;
    } catch (error) {
      note("destroy-failed", { instanceId: this.id, code: error.code });
    }
    this.revoke("destroyed");
    return { instanceId: this.id, destroyed: true };
  }
}

window.addEventListener("message", (event) => {
  for (const instance of state.instances.values()) {
    if (event.source === instance.frame.contentWindow) {
      metrics.lastEventOrigin = String(event.origin);
      instance.handleMessage(event.data);
      return;
    }
  }
  metrics.foreignSourceMessages += 1;
  note("foreign-source-message", { origin: String(event.origin) });
});

// ── session / instance lifecycle ─────────────────────────────────────────

function projectSessionView(session) {
  return {
    project: session.project,
    catalogue: session.catalogue,
    snapshot: session.snapshot,
    entryUrl: session.entryUrl,
  };
}

function stageFor(session) {
  const element = $("stage");
  const rect = element.getBoundingClientRect();
  const stage = computeStage({
    containerWidth: rect.width,
    containerHeight: rect.height,
    compositionWidth: session.project.width,
    compositionHeight: session.project.height,
  });
  return { stage, rect };
}

function applyStage() {
  if (!state.session) return;
  const { stage, rect } = stageFor(state.session);
  state.stage = stage;
  state.stageRect = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
  const transform = $("preview-transform");
  transform.style.left = `${stage.left}px`;
  transform.style.top = `${stage.top}px`;
  transform.style.width = `${state.session.project.width}px`;
  transform.style.height = `${state.session.project.height}px`;
  transform.style.transform = `scale(${stage.scale})`;
  positionOverlay();
}

async function loadSession(session) {
  state.loading = true;
  for (const instance of state.instances.values()) instance.revoke("new-session");
  state.instances.clear();
  state.active = null;
  clearSelection();
  cancelEdit({ silent: true });
  state.session = session;
  state.catalogue = session.catalogue;
  state.composition = {
    width: session.project.width,
    height: session.project.height,
  };
  state.time = 0;
  state.playing = false;
  const instance = new PreviewInstance({
    session,
    onEvent: (type, detail) => {
      if (type === "error") {
        showError(`预览 runtime 错误：${detail.payload.code} ${detail.payload.message}`);
        setStatus("error", "预览 runtime 错误");
      }
      if (type === "ready") setStatus("ok", "预览就绪");
      renderDiagnostics();
    },
  });
  state.instances.set(instance.id, instance);
  state.active = instance;
  $("frame-layer").replaceChildren();
  instance.attach($("frame-layer"));
  applyStage();
  $("duration-label").textContent = `${state.composition ? session.project.duration.toFixed(3) : "0.000"}s`;
  const seek = $("seek-range");
  seek.max = String(session.project.duration);
  seek.value = "0";
  updateTimeLabel(0);
  renderSessionPanel();
  renderDiagnostics();
  setStatus("busy", "等待预览 runtime…");
  const ready = await instance.readyPromise;
  if (ready.runtimeVersion !== "p3-005b-runtime.1")
    throw new CanvasError("E_RUNTIME_VERSION", "unexpected runtime version");
  state.ready = true;
  state.loading = false;
  setStatus("ok", "预览就绪");
  clearError();
  return ready;
}

function renderSessionPanel() {
  const info = $("session-info");
  if (!state.session) {
    info.innerHTML = "<dt>状态</dt><dd>未连接</dd>";
    return;
  }
  const { project, snapshot } = state.session;
  info.innerHTML = "";
  const rows = [
    ["projectId", project.projectId],
    ["revision", project.revision],
    ["snapshotId", snapshot.snapshotId],
    ["duration", `${project.duration.toFixed(3)}s`],
    ["stage", `${state.stage.scale.toFixed(4)}× letterbox ${state.stage.left.toFixed(1)},${state.stage.top.toFixed(1)}`],
    ["runtime", "p3-005b-runtime.1"],
  ];
  for (const [name, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = name;
    const dd = document.createElement("dd");
    dd.textContent = String(value);
    info.append(dt, dd);
  }
}

function renderDiagnostics() {
  const parts = {
    metrics: { ...metrics },
    instances: [...state.instances.values()].map((instance) => ({
      id: instance.id,
      ready: Boolean(instance.readyInfo),
      pending: instance.ledger.pendingCount(),
    })),
    dropped: state.active?.ledger.dropped.slice(-8) ?? [],
    recent: diagnostics.slice(-10),
  };
  $("diag-info").textContent = JSON.stringify(parts, null, 2);
  const meta = $("engine-meta");
  if (state.session) {
    const { project, snapshot } = state.session;
    meta.textContent = `${project.projectId} · rev ${project.revision.slice(0, 10)} · snap ${snapshot.snapshotId.slice(0, 8)}`;
  }
}

function updateTimeLabel(time) {
  state.time = time;
  $("time-label").textContent = `${time.toFixed(3)}s`;
  $("seek-range").value = String(Math.max(0, Math.min(time, Number($("seek-range").max))));
}

// ── overlay / selection ─────────────────────────────────────────────────

function pointFromScreen(x, y) {
  return screenToComposition(
    { x: x - state.stageRect.left, y: y - state.stageRect.top },
    state.stage,
    state.composition,
  );
}

function screenRectFromDocument(rect) {
  const topLeft = compositionToScreen({ x: rect.x, y: rect.y }, state.stage);
  return {
    left: topLeft.x,
    top: topLeft.y,
    width: rect.width * state.stage.scale,
    height: rect.height * state.stage.scale,
  };
}

function positionOverlay() {
  if (!state.selection) {
    $("selection").classList.add("hidden");
    $("floatbar").classList.add("hidden");
    return;
  }
  const element = $("selection");
  const box = screenRectFromDocument(state.selection.rect);
  element.style.left = `${box.left}px`;
  element.style.top = `${box.top}px`;
  element.style.width = `${box.width}px`;
  element.style.height = `${box.height}px`;
  $("selection-label").textContent = state.selection.stableId;
  element.classList.remove("hidden");
  const floatbar = $("floatbar");
  floatbar.innerHTML = "";
  if (state.selection.editableText) {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "原位编辑文字";
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      void openTextEditor();
    });
    floatbar.append(edit);
  }
  const hint = document.createElement("span");
  hint.textContent = state.selection.editableText
    ? "拖动/缩放为暂态"
    : "无文字能力·仅可选中";
  floatbar.append(hint);
  floatbar.style.left = `${box.left}px`;
  floatbar.style.top = `${Math.max(box.top - 30, 0)}px`;
  floatbar.classList.remove("hidden");
  positionEditor();
}

function clearSelection() {
  state.selection = null;
  state.gapProposal = null;
  $("selection").classList.add("hidden");
  $("floatbar").classList.add("hidden");
  $("drag-hint").classList.add("hidden");
  $("gap-info").textContent = "未尝试";
  cancelEdit({ silent: true });
}

function select(hit, selectable) {
  state.selection = {
    stableId: hit.stableId,
    sceneId: hit.sceneId,
    rect: hit.rect,
    text: hit.text,
    style: hit.style,
    capabilities: selectable.capabilities,
    editableText: selectable.editableText,
    tag: hit.tag,
    stack: hit.stack,
  };
  state.gapProposal = null;
  positionOverlay();
  renderHitPanel();
  $("gap-info").textContent = "尚未拖动/缩放。拖动或缩放只在编辑层移动，不会写入工程。";
}

function renderHitPanel() {
  const payload = {
    hit: state.lastHit?.hit ?? null,
    selectable: state.lastHit?.selectable ?? null,
    selection: state.selection
      ? {
          stableId: state.selection.stableId,
          sceneId: state.selection.sceneId,
          editableText: state.selection.editableText,
          capabilities: state.selection.capabilities,
          rect: state.selection.rect,
        }
      : null,
  };
  $("hit-info").textContent = JSON.stringify(payload, null, 2);
}

async function hitAt(x, y) {
  if (state.loading) throw new CanvasError("E_LOADING", "preview instance is loading");
  if (!state.active) return null;
  const { hit } = await state.active.request("hitTest", { x, y });
  return hit;
}

async function handleStageClick(event) {
  if (state.editing) return;
  if (state.suppressClick) {
    state.suppressClick = false;
    return;
  }
  const point = pointFromScreen(event.clientX, event.clientY);
  if (!point.inside) {
    clearSelection();
    return;
  }
  const hit = await hitAt(point.x, point.y);
  const selectable = selectableFromCatalogue(hit, state.catalogue);
  state.lastHit = { hit, selectable, point };
  renderHitPanel();
  if (!hit) {
    clearSelection();
    return;
  }
  const structural =
    hit.stableId === "hf-main" || hit.stableId.endsWith("-section") || !selectable.ok;
  if (structural) {
    state.selection = null;
    $("selection").classList.add("hidden");
    $("floatbar").classList.add("hidden");
    $("gap-info").textContent = "该命中是结构容器/未知对象，不在可编辑选择范围内。";
    renderHitPanel();
    return;
  }
  select(hit, selectable);
}

async function handleStageDoubleClick(event) {
  if (state.editing) return;
  const point = pointFromScreen(event.clientX, event.clientY);
  if (!point.inside) return;
  const hit = await hitAt(point.x, point.y);
  if (!hit) return;
  const selectable = selectableFromCatalogue(hit, state.catalogue);
  if (!selectable.ok || !selectable.editableText) return;
  if (!state.selection || state.selection.stableId !== hit.stableId) select(hit, selectable);
  await openTextEditor();
}

// ── playback ────────────────────────────────────────────────────────────

function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(async () => {
    if (!state.active || state.editing) return;
    try {
      const value = await state.active.request("state");
      updateTimeLabel(value.time);
      state.playing = value.playing;
      $("btn-play").textContent = value.playing ? "播放中…" : "播放";
      if (!value.playing) stopPolling();
    } catch {
      stopPolling();
    }
  }, 120);
}

async function seek(time, { record = true } = {}) {
  if (state.loading) throw new CanvasError("E_LOADING", "preview instance is loading");
  if (!state.active) throw new CanvasError("E_NO_INSTANCE");
  if (state.editing) throw new CanvasError("E_EDITING", "finish or cancel text editing first");
  const { time: actual } = await state.active.request("seek", { time });
  updateTimeLabel(actual);
  if (record) note("seek", { requested: time, actual });
  return actual;
}

async function play() {
  if (state.loading) throw new CanvasError("E_LOADING", "preview instance is loading");
  if (!state.active) throw new CanvasError("E_NO_INSTANCE");
  if (state.editing) throw new CanvasError("E_EDITING");
  const { time } = await state.active.request("play");
  state.playing = true;
  updateTimeLabel(time);
  startPolling();
  return time;
}

async function pause() {
  if (!state.active) throw new CanvasError("E_NO_INSTANCE");
  const { time } = await state.active.request("pause");
  state.playing = false;
  stopPolling();
  updateTimeLabel(time);
  return time;
}

// ── text editing ────────────────────────────────────────────────────────

function editorScreenBox() {
  if (!state.selection) return null;
  return screenRectFromDocument(state.selection.rect);
}

function positionEditor() {
  if (!state.editing || !state.selection) return;
  const editor = $("text-editor");
  const box = editorScreenBox();
  if (!box) return;
  editor.style.left = `${box.left}px`;
  editor.style.top = `${box.top}px`;
  editor.style.width = `${box.width}px`;
  editor.style.height = `${box.height}px`;
}

async function openTextEditor() {
  if (!state.selection || !state.selection.editableText) return;
  if (state.playing) await pause();
  clearError();
  state.editing = {
    stableId: state.selection.stableId,
    originalText: state.selection.text,
    draft: state.selection.text,
    error: null,
  };
  const editor = $("text-editor");
  editor.classList.remove("hidden");
  editor.textContent = state.selection.text;
  editor.style.fontSize = `${parseFloat(state.selection.style.fontSize) * state.stage.scale}px`;
  editor.style.fontFamily = state.selection.style.fontFamily;
  editor.style.fontWeight = state.selection.style.fontWeight;
  editor.style.lineHeight = state.selection.style.lineHeight;
  editor.style.color = state.selection.style.color;
  editor.style.textAlign = state.selection.style.textAlign;
  editor.style.letterSpacing = `${parseFloat(state.selection.style.letterSpacing || "0") * state.stage.scale}px`;
  positionEditor();
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  setStatus("busy", `原位编辑 ${state.selection.stableId}`);
  note("text-editor-opened", { stableId: state.selection.stableId });
}

function cancelEdit({ silent = false } = {}) {
  if (!state.editing) return;
  $("text-editor").classList.add("hidden");
  $("text-editor").textContent = "";
  note("text-editor-cancelled", { stableId: state.editing.stableId, silent });
  state.editing = null;
  state.pendingEdit = null;
  if (!$("error-banner").dataset.keep) clearError();
  setStatus("ok", "已恢复原文字（未写入）");
}

function updatePendingFromEditor() {
  if (!state.editing) return null;
  const text = $("text-editor").textContent ?? "";
  state.editing.draft = text;
  return text;
}

async function commitText() {
  if (!state.editing || state.committing) return { ok: false, code: "E_NO_EDIT" };
  const text = updatePendingFromEditor();
  updatePendingFromEditor();
  const validation = validateTextCommit({
    stableId: state.editing.stableId,
    text,
    expectedRevision: state.session.project.revision,
    currentRevision: state.session.project.revision,
    catalogue: state.catalogue,
  });
  if (!validation.ok) {
    showError(`无法提交：${validation.code}`);
    return validation;
  }
  state.committing = true;
  setStatus("busy", "提交到共享 worker…");
  const operationId = `canvas-${state.editing.stableId}-${Date.now()}`;
  try {
    const response = await bridge("edit", {
      projectId: state.session.project.projectId,
      expectedRevision: state.session.project.revision,
      operationId,
      ops: [{ type: "text", target: state.editing.stableId, text }],
    });
    const session = response.result.session;
    state.pendingEdit = null;
    clearError();
    // Load the new snapshot before dropping the editor state: the overlay is
    // removed by loadSession and only then is the edit considered finished.
    await loadSession(session);
    state.editing = null;
    $("text-editor").classList.add("hidden");
    $("text-editor").textContent = "";
    setStatus("ok", `已写回 revision ${session.project.revision.slice(0, 10)}`);
    note("text-committed", {
      stableId: validation.stableId,
      operationId,
      revision: session.project.revision,
    });
    return { ok: true, revision: session.project.revision };
  } catch (error) {
    const code = error.code ?? "E_UNKNOWN";
    showError(
      `提交失败（${code}）：${error.message ?? ""}。草稿保留，可刷新后重试。`,
    );
    $("error-banner").dataset.keep = "1";
    state.pendingEdit = {
      stableId: state.editing?.stableId ?? validation.stableId,
      text,
      code,
    };
    setStatus("error", `提交失败 ${code}`);
    note("text-commit-failed", { code, stableId: validation.stableId });
    return { ok: false, code, message: error.message };
  } finally {
    state.committing = false;
  }
}

async function refreshAndRetry() {
  clearError();
  const response = await bridge("session");
  await loadSession(response.result.session);
  setStatus("ok", "已刷新到最新 revision，可重试");
  return state.pendingEdit;
}

// ── transient drag / resize (capability gap evidence) ───────────────────

async function attemptGapWriteback(kind) {
  if (!state.gapProposal) return { ok: false, code: "E_NO_PROPOSAL" };
  const op = proposedLayoutOp({
    stableId: state.gapProposal.stableId,
    box: state.gapProposal.box,
  });
  if (!op) return { ok: false, code: "E_BAD_PROPOSAL" };
  state.gapProposal.op = op;
  try {
    const response = await bridge("edit", {
      projectId: state.session.project.projectId,
      expectedRevision: state.session.project.revision,
      operationId: `layout-probe-${Date.now()}`,
      ops: [op],
    });
    $("gap-info").textContent = JSON.stringify(
      { kind, op, unexpectedSuccess: response.result ?? null },
      null,
      2,
    );
    return { ok: true, unexpected: true };
  } catch (error) {
    const record = {
      kind,
      op,
      workerError: { code: error.code, message: error.message },
    };
    $("gap-info").textContent = JSON.stringify(record, null, 2);
    note("layout-writeback-rejected", record.workerError);
    setStatus("ok", `引擎拒绝暂态写回：${error.code}`);
    const session = await bridge("session");
    if (session.result.session.project.revision !== state.session.project.revision) {
      showError("布局探测期间 revision 变化，请刷新");
      return { ok: false, code: "E_REVISION_CHANGED" };
    }
    return record;
  }
}

function beginDrag(event, kind, handle) {
  if (!state.selection) return;
  if (state.playing) {
    note("drag-blocked-while-playing", { stableId: state.selection.stableId });
    setStatus("busy", "播放中不进入拖动（先暂停）");
    return;
  }
  if (state.editing) return;
  event.preventDefault();
  event.stopPropagation();
  state.drag = {
    kind,
    handle,
    startX: event.clientX,
    startY: event.clientY,
    origin: { ...state.selection.rect },
    moved: false,
  };
  $("selection").setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", onDragMove);
  window.addEventListener("pointerup", onDragEnd, { once: true });
}

function clampBox(box) {
  const minSize = 24;
  const width = Math.min(Math.max(box.width, minSize), state.composition.width);
  const height = Math.min(Math.max(box.height, minSize), state.composition.height);
  return {
    x: Math.min(Math.max(box.x, 0), state.composition.width - width),
    y: Math.min(Math.max(box.y, 0), state.composition.height - height),
    width,
    height,
  };
}

function onDragMove(event) {
  if (!state.drag || !state.selection) return;
  const dx = (event.clientX - state.drag.startX) / state.stage.scale;
  const dy = (event.clientY - state.drag.startY) / state.stage.scale;
  if (Math.abs(event.clientX - state.drag.startX) + Math.abs(event.clientY - state.drag.startY) > 2)
    state.drag.moved = true;
  const origin = state.drag.origin;
  let box;
  if (state.drag.kind === "move") {
    box = clampBox({ ...origin, x: origin.x + dx, y: origin.y + dy });
  } else {
    const handle = state.drag.handle;
    box = { ...origin };
    if (handle.includes("e")) box.width = origin.width + dx;
    if (handle.includes("s")) box.height = origin.height + dy;
    if (handle.includes("w")) {
      box.x = origin.x + dx;
      box.width = origin.width - dx;
    }
    if (handle.includes("n")) {
      box.y = origin.y + dy;
      box.height = origin.height - dy;
    }
    box = clampBox(box);
  }
  state.selection.rect = box;
  positionOverlay();
  const hint = $("drag-hint");
  hint.classList.remove("hidden");
  hint.textContent = `${state.drag.kind === "move" ? "移动" : "缩放"}暂态 · (${Math.round(box.x)}, ${Math.round(box.y)}) · ${Math.round(box.width)}×${Math.round(box.height)} px（未保存）`;
  const screen = screenRectFromDocument(box);
  hint.style.left = `${screen.left}px`;
  hint.style.top = `${Math.max(screen.top - 24, 0)}px`;
}

async function onDragEnd() {
  window.removeEventListener("pointermove", onDragMove);
  if (!state.drag || !state.selection) return;
  const drag = state.drag;
  state.drag = null;
  if (!drag.moved) {
    $("drag-hint").classList.add("hidden");
    return;
  }
  state.suppressClick = true;
  const size = state.selection.rect;
  state.gapProposal = {
    kind: drag.kind,
    stableId: state.selection.stableId,
    // Engine-facing proposal uses top-left composition pixels; the overlay
    // keeps {x,y,width,height} for DOM positioning.
    box: { left: size.x, top: size.y, width: size.width, height: size.height },
    overlayRect: { ...size },
    workerError: null,
  };
  $("gap-info").textContent = JSON.stringify(
    { ...state.gapProposal, note: "暂态，仅编辑层；提交需新 typed op" },
    null,
    2,
  );
  note("transient-layout", state.gapProposal);
  const floatbar = $("floatbar");
  floatbar.innerHTML = "";
  const probe = document.createElement("button");
  probe.type = "button";
  probe.textContent = "尝试写回（预期被拒）";
  probe.addEventListener("click", async (event) => {
    event.stopPropagation();
    const result = await attemptGapWriteback(drag.kind);
    if (result?.workerError) {
      probe.disabled = true;
      probe.textContent = `引擎拒绝：${result.workerError.code}`;
    }
  });
  const revert = document.createElement("button");
  revert.type = "button";
  revert.textContent = "重新载入快照";
  revert.addEventListener("click", async (event) => {
    event.stopPropagation();
    await reloadSession();
  });
  floatbar.append(probe, revert);
  floatbar.classList.remove("hidden");
}

async function reloadSession() {
  const response = await bridge("session");
  await loadSession(response.result.session);
  setStatus("ok", "已重新载入最新快照（暂态布局已丢弃）");
}

// ── UI wiring / boot ────────────────────────────────────────────────────

function renderGapPanel() {
  if (state.gapProposal)
    $("gap-info").textContent = JSON.stringify(state.gapProposal, null, 2);
}

async function boot() {
  $("btn-play").addEventListener("click", async () => {
    try {
      await play();
    } catch (error) {
      setStatus("error", error.code ?? "播放失败");
    }
  });
  $("btn-pause").addEventListener("click", async () => {
    try {
      await pause();
    } catch (error) {
      setStatus("error", error.code ?? "暂停失败");
    }
  });
  $("seek-range").addEventListener("change", async (event) => {
    try {
      await seek(Number(event.target.value));
    } catch (error) {
      setStatus("error", error.code ?? "定位失败");
    }
  });
  $("stage").addEventListener("click", (event) => {
    handleStageClick(event).catch((error) => setStatus("error", error.code ?? "命中失败"));
  });
  $("stage").addEventListener("dblclick", (event) => {
    handleStageDoubleClick(event).catch((error) => setStatus("error", error.code ?? "编辑失败"));
  });
  $("selection").addEventListener("pointerdown", (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset.handle) {
      beginDrag(event, "resize", event.target.dataset.handle);
    } else {
      beginDrag(event, "move", null);
    }
  });
  $("selection").addEventListener("dblclick", (event) => {
    event.stopPropagation();
    void openTextEditor();
  });
  $("text-editor").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void commitText();
    }
  });
  $("text-editor").addEventListener("input", () => updatePendingFromEditor());
  $("text-editor").addEventListener("blur", () => {
    if (!state.editing || state.committing) return;
    const changed = $("text-editor").textContent !== state.editing.draft;
    updatePendingFromEditor();
    if (changed) void commitText();
  });
  for (const button of document.querySelectorAll("[data-stage]")) {
    button.addEventListener("click", () => {
      const [width, height] = button.dataset.stage.split("x").map(Number);
      setStageSize(width, height);
    });
  }
  const resize = new ResizeObserver(() => applyStage());
  resize.observe($("stage"));
  renderDiagnostics();
  setStatus("busy", "连接 Host…");
  try {
    const response = await bridge("session");
    await loadSession(response.result.session);
    note("session-loaded", { revision: state.session.project.revision });
  } catch (error) {
    setStatus("error", "连接失败");
    showError(`无法连接 Host worker：${error.code ?? ""} ${error.message ?? ""}`);
    note("boot-failed", { code: error.code, message: error.message });
  }
  window.__canvas.ready = true;
}

function setStageSize(width, height) {
  const stage = $("stage");
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  requestAnimationFrame(() => applyStage());
  return { width, height };
}

async function destroyAll() {
  const instances = [...state.instances.values()];
  state.instances.clear();
  state.active = null;
  stopPolling();
  clearSelection();
  const results = [];
  for (const instance of instances) results.push(await instance.destroy());
  $("frame-layer").replaceChildren();
  setStatus("ok", "实例已销毁");
  return { results, remainingInstances: state.instances.size, frames: $("frame-layer").childElementCount };
}

window.__canvas = {
  ready: false,
  instanceId: () => state.active?.id ?? null,
  instanceNonce: () => state.active?.nonce ?? null,
  snapshot: () => ({
    session: state.session ? projectSessionView(state.session) : null,
  }),
  state: () => ({
    ready: state.ready,
    loading: state.loading,
    playing: state.playing,
    time: state.time,
    revision: state.session?.project.revision ?? null,
    snapshotId: state.session?.snapshot.snapshotId ?? null,
    instanceId: state.active?.id ?? null,
    stage: { ...state.stage, stageRect: state.stageRect },
    composition: { ...state.composition },
    selection: state.selection
      ? {
          stableId: state.selection.stableId,
          sceneId: state.selection.sceneId,
          rect: state.selection.rect,
          editableText: state.selection.editableText,
        }
      : null,
    editing: state.editing
      ? { stableId: state.editing.stableId, draft: state.editing.draft, error: state.editing.error }
      : null,
    pendingEdit: state.pendingEdit,
    gapProposal: state.gapProposal,
    metrics: { ...metrics },
    diagnostics: diagnostics.slice(-40),
  }),
  screenPoint: (x, y) => {
    const point = compositionToScreen({ x, y }, state.stage);
    return {
      x: state.stageRect.left + point.x,
      y: state.stageRect.top + point.y,
    };
  },
  seek,
  play,
  pause,
  hit: async (x, y) => hitAt(x, y),
  elements: async () => (await state.active.request("getElements")).elements,
  catalogue: () => state.catalogue,
  setStageSize,
  openEditorAt: async (x, y) => {
    if (!state.selection) {
      const hit = await hitAt(x, y);
      const selectable = selectableFromCatalogue(hit, state.catalogue);
      if (selectable.ok) select(hit, selectable);
      state.lastHit = { hit, selectable };
    }
    await openTextEditor();
  },
  typeText: (text) => {
    const editor = $("text-editor");
    editor.textContent = text;
    updatePendingFromEditor();
    return editor.textContent;
  },
  commitText,
  cancelEdit,
  refreshAndRetry,
  reloadSession,
  attemptGapWriteback,
  setSelectionBox: (box) => {
    if (!state.selection) return null;
    state.selection.rect = { ...box };
    positionOverlay();
    return state.selection.rect;
  },
  beginDragAt: (dx, dy, kind = "move") => {
    if (!state.selection) return null;
    const box = state.selection.rect;
    const screen = screenRectFromDocument(box);
    const start = {
      clientX: state.stageRect.left + screen.left + screen.width / 2,
      clientY: state.stageRect.top + screen.top + screen.height / 2,
    };
    const target = $("selection");
    const pointerId = 1;
    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId,
        clientX: start.clientX,
        clientY: start.clientY,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId,
        clientX: start.clientX + dx,
        clientY: start.clientY + dy,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerId, clientX: start.clientX + dx, clientY: start.clientY + dy }),
    );
    return state.gapProposal;
  },
  destroyAll,
  sendTo: async (instanceId, type, payload = {}) => {
    const instance = state.instances.get(instanceId);
    if (!instance) {
      metrics.revokedRejections += 1;
      throw new CanvasError("E_INSTANCE_NOT_FOUND", "no live instance with that id");
    }
    return instance.request(type, payload);
  },
  foreignMessageProbe: (originMark = "probe") => {
    window.postMessage(
      { v: 1, kind: "cmd", instanceId: "inst-foreign-probe", nonce: "f".repeat(32), seq: 1, type: "state", payload: {}, mark: originMark },
      "*",
    );
    return true;
  },
  wrongNonceProbe: (type = "state") => {
    const instance = state.active;
    if (!instance) throw new CanvasError("E_NO_INSTANCE");
    instance.frame.contentWindow.postMessage(
      {
        v: 1,
        kind: "cmd",
        instanceId: instance.id,
        nonce: "f".repeat(32),
        seq: 999,
        type,
        payload: {},
      },
      "*",
    );
    return { instanceId: instance.id, nonce: "f".repeat(32), type };
  },
  diagnostics: () => ({ metrics: { ...metrics }, log: diagnostics.slice(-80) }),
  bridgeHealth: () => ({ hasBridge: typeof window.dshHostRequest === "function" }),
};

boot();
