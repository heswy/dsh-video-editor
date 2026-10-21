/**
 * Host-owned UI state for the video panel (V1 M1-05, created with M1-03).
 *
 * The only persisted UI facts live in `<dataRoot>/ui-state.json`:
 *   - lastProjectId: the project the user last had open (restored on boot);
 *   - layout: a small, whitelisted object (AI pane ratio today);
 *   - timelineOpen: optional timeline drawer state.
 *
 * Rules:
 *   - whitelist only: unknown patches/fields are rejected, never persisted;
 *   - atomic write (same-directory temp + rename, 0600);
 *   - corruption never blocks the panel: the bytes are kept aside as
 *     `ui-state.json.corrupt-<timestamp>` and defaults are restored;
 *   - this state never participates in a project revision.
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BridgeError } from './errors.js';

export const UI_STATE_VERSION = 1;
export const MAX_UI_STATE_BYTES = 64 * 1024;
const MAX_PATH = 4096;
const LAST_PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const AI_PANE_RATIO_MIN = 0.2;
const AI_PANE_RATIO_MAX = 0.8;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function uiError(code, message, stage = 'ui-state') {
  return new BridgeError(code, message, { stage });
}

function defaultState() {
  return { version: UI_STATE_VERSION, lastProjectId: null, layout: null, timelineOpen: null, updatedAt: null };
}

function clone(value) {
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

/** Validate a layout object; null clears it. Unknown keys are rejected. */
function normalizeLayout(value) {
  if (value === null) return null;
  if (isPlainObject(value) === false) throw uiError('E_UI_STATE_PARAMS', 'Invalid layout value');
  for (const key of Object.keys(value)) {
    if (key !== 'aiPaneRatio') throw uiError('E_UI_STATE_PARAMS', `Unknown layout field "${key}"`);
  }
  if (value.aiPaneRatio === undefined) return null;
  if (typeof value.aiPaneRatio !== 'number' || Number.isFinite(value.aiPaneRatio) === false) {
    throw uiError('E_UI_STATE_PARAMS', 'Invalid layout.aiPaneRatio');
  }
  if (value.aiPaneRatio < AI_PANE_RATIO_MIN || value.aiPaneRatio > AI_PANE_RATIO_MAX) {
    throw uiError('E_UI_STATE_PARAMS', 'layout.aiPaneRatio is outside the supported range');
  }
  return { aiPaneRatio: Math.round(value.aiPaneRatio * 10000) / 10000 };
}

function normalizeLastProjectId(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || LAST_PROJECT_ID.test(value) === false) {
    throw uiError('E_UI_STATE_PARAMS', 'Invalid lastProjectId');
  }
  return value;
}

function validateState(parsed) {
  if (isPlainObject(parsed) === false) throw uiError('E_UI_STATE_CORRUPT', 'UI state is not an object');
  if (parsed.version !== UI_STATE_VERSION) throw uiError('E_UI_STATE_CORRUPT', 'UI state has an unsupported version');
  const state = defaultState();
  if (parsed.lastProjectId !== undefined && parsed.lastProjectId !== null) {
    state.lastProjectId = normalizeLastProjectId(parsed.lastProjectId);
  }
  if (parsed.layout !== undefined && parsed.layout !== null) state.layout = normalizeLayout(parsed.layout);
  if (parsed.timelineOpen !== undefined && parsed.timelineOpen !== null) {
    if (typeof parsed.timelineOpen !== 'boolean') throw uiError('E_UI_STATE_CORRUPT', 'UI state has an invalid timelineOpen');
    state.timelineOpen = parsed.timelineOpen;
  }
  state.updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null;
  return state;
}

/** One Host-owned ui-state file. */
export class UiStateStore {
  /**
   * @param options.path - trusted absolute state path, or null when disabled.
   * @param options.logger - optional Host logger.
   */
  constructor(options = {}) {
    this.path = typeof options.path === 'string' && options.path.length > 0 && options.path.length <= MAX_PATH ? options.path : null;
    this.logger = options.logger;
    this.state = defaultState();
    this.prepared = false;
    this.recovered = null;
    this.loadError = null;
    this.queue = Promise.resolve();
  }

  /** Whether persistent UI state is available for this deployment. */
  configured() {
    return this.path !== null;
  }

  async prepare() {
    if (this.prepared) return { recovered: this.recovered !== null, ...(this.recovered || {}) };
    if (this.path === null) {
      this.prepared = true;
      this.loadError = uiError('E_UI_STATE_CONFIG', 'UI state storage is not configured');
      return { recovered: false, error: this.loadError.code };
    }
    let info = null;
    try {
      info = await stat(this.path);
    } catch (_error) {
      info = null;
    }
    if (info === null) {
      this.state = defaultState();
      this.prepared = true;
      await this.write().catch(() => {});
      return { recovered: false, error: null };
    }
    if (info.isFile() === false || info.size > MAX_UI_STATE_BYTES) {
      return this.recover('E_UI_STATE_CORRUPT');
    }
    let parsed;
    try {
      parsed = JSON.parse(await readFile(this.path, 'utf8'));
    } catch (_error) {
      return this.recover('E_UI_STATE_CORRUPT');
    }
    try {
      this.state = validateState(parsed);
      this.prepared = true;
      return { recovered: false, error: null };
    } catch (error) {
      return this.recover(error instanceof BridgeError ? error.code : 'E_UI_STATE_CORRUPT');
    }
  }

  /** Keep corrupt bytes aside and restart from defaults (never blocks the panel). */
  async recover(code) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let backupCreated = false;
    try {
      await rename(this.path, `${this.path}.corrupt-${stamp}`);
      backupCreated = true;
    } catch (_error) {
      backupCreated = false;
    }
    this.state = defaultState();
    this.recovered = { code, backupCreated, at: new Date().toISOString() };
    this.loadError = null;
    this.prepared = true;
    try {
      await this.write();
    } catch (_error) {
      this.loadError = uiError('E_UI_STATE_CORRUPT', 'Recovered UI state could not be written');
    }
    return { recovered: true, ...this.recovered };
  }

  /** Clone the current state for the panel. */
  get() {
    if (this.prepared === false) throw uiError('E_UI_STATE_UNAVAILABLE', 'UI state is not prepared yet');
    return { version: UI_STATE_VERSION, ...clone({ lastProjectId: this.state.lastProjectId, layout: this.state.layout, timelineOpen: this.state.timelineOpen, updatedAt: this.state.updatedAt }) };
  }

  /** Apply one whitelisted patch atomically and return the stored state. */
  async set(patch) {
    if (this.prepared === false) throw uiError('E_UI_STATE_UNAVAILABLE', 'UI state is not prepared yet');
    if (isPlainObject(patch) === false) throw uiError('E_UI_STATE_PARAMS', 'UI state patch must be an object');
    const allowed = ['lastProjectId', 'layout', 'timelineOpen'];
    for (const key of Object.keys(patch)) {
      if (allowed.includes(key) === false) throw uiError('E_UI_STATE_PARAMS', `Unknown UI state field "${key}"`);
    }
    const task = this.queue.then(async () => {
      const next = {
        version: UI_STATE_VERSION,
        lastProjectId: patch.lastProjectId !== undefined ? normalizeLastProjectId(patch.lastProjectId) : this.state.lastProjectId,
        layout: patch.layout !== undefined ? normalizeLayout(patch.layout) : this.state.layout,
        timelineOpen: patch.timelineOpen !== undefined ? (patch.timelineOpen === null ? null : Boolean(patch.timelineOpen)) : this.state.timelineOpen,
        updatedAt: new Date().toISOString(),
      };
      const previous = this.state;
      this.state = next;
      try {
        await this.write();
      } catch (error) {
        this.state = previous;
        throw error;
      }
      return this.get();
    });
    this.queue = task.catch(() => {});
    return task;
  }

  async write() {
    if (this.path === null) throw uiError('E_UI_STATE_CONFIG', 'UI state storage is not configured');
    if (this.prepared === false) return;
    await mkdir(dirname(this.path), { recursive: true });
    const serialized = JSON.stringify(this.state, null, 2) + '\n';
    if (Buffer.byteLength(serialized, 'utf8') > MAX_UI_STATE_BYTES) throw uiError('E_UI_STATE_LIMIT', 'UI state would exceed the size limit');
    const temporary = `${this.path}.tmp-${process.pid}-${Math.random().toString(16).slice(2, 10)}`;
    try {
      await writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  /** Bounded diagnostics; never contains paths. */
  diagnose() {
    return {
      configured: this.path !== null,
      prepared: this.prepared,
      error: this.loadError === null ? null : this.loadError.code,
      lastProjectId: this.state.lastProjectId,
      recovered: this.recovered === null ? null : { ...this.recovered },
    };
  }
}
