/**
 * dsh-video — Client half.
 *
 * Hand-written DSH client bundle (no bundler, no JSX, no npm dependencies).
 * It contributes exactly two things:
 *
 *   1. one native sidebar navigation entry ("Vedio Editor") in the host's
 *      `sidebar.panellist` list, immediately after the shipped panel rows and
 *      before the Workspace/Session browsing region;
 *   2. one global main panel under the `dsh-video` key, registered in the host
 *      `main` keyed slot and selected only through `ctx.layout.selectPanel`.
 *
 * Boundaries (P0-005):
 *   - the selected state is read by the host from its own layout store; the
 *     plugin keeps no second mode boolean and never registers a second nav row;
 *   - no overlay, no host-header replacement, no DOM geometry reads, no sidebar
 *     replacement, no Remote, no session events, no local project content store;
 *     project/revision/job authority stays in the Host worker, while this Client
 *     keeps only bounded view memory across a panel switch;
 *   - the main panel and the sidebar entry are one atomic pair: the panel is
 *     registered first, the entry only after it; any failure, conflict or loss
 *     releases both, and a later declaration retries. The panel can never stay
 *     registered without a reachable navigation entry;
 *   - every registration is owned by the caller fiber through `ctx.slots.inject`
 *     / `ctx.effect`, so disabling the plugin removes it and the host's
 *     `retainMainPanels` mechanism can return the UI to the conversation.
 *
 * Browser persistence is limited to the reduced-effects preference, versioned and
 * corruption-safe. Project content is not stored here.
 */
window.__ModuleLoader__.load({
  id: 'dsh-video',
  factory(require) {
    'use strict';

    //#region constants
    const React = require('react');
    const h = React.createElement;

    /** Main-panel key, sidebar list id, Loader row id and Client module id. */
    const PANEL_ID = 'dsh-video';
    /** Locale namespace registered for this plugin's UI text. */
    const NS = 'dshVideo';
    /** Browser preference key (version lives in the key and in the payload). */
    const PREFS_KEY = 'dsh-video.ui.v1';
    const PREFS_VERSION = 1;
    /**
     * Sidebar row position. The shipped panel rows use orders 0 (plugins),
     * 10 (schedules) and 20 (context). The workspace/session region is a
     * different sidebar slot rendered after the whole panel list, so any order
     * greater than 20 lands after the last shipped row and before the Workspace
     * group. 30 leaves room for future shipped rows without reordering them.
     */
    const SIDEBAR_ORDER = 30;
    //#endregion

    //#region locale dictionaries
    const ZH = {
      'nav.label': 'Vedio Editor',
      'video.back': '返回对话',
      'video.empty': '尚无工程',
      'video.open': '打开示例',
      'video.opening': '正在打开…',
      'video.display.label': '显示选项',
      'video.display.simplified': '简化界面效果',
      'video.title': '标题',
      'video.timing': '时间',
      'video.start': '开始（秒）',
      'video.duration': '时长（秒）',
      'video.update': '更新画面',
      'video.updating': '正在生成画面…',
      'video.save': '保存修改',
      'video.saving': '正在保存…',
      'video.export': '导出 MP4',
      'video.exporting': '正在导出…',
      'video.cancel': '取消',
      'video.cancelling': '正在取消…',
      'video.download': '下载 MP4',
      'video.refresh': '重新读取',
      'video.refreshing': '正在读取…',
      'video.frame.empty': '画面尚未生成',
      'video.frame.failed': '画面加载失败，请重新更新。',
      'video.noText': '此工程没有可编辑文本。',
      'video.details': '属性',
      'video.target': '目标',
      'video.capabilities': '能力',
      'video.edit.empty': '没有需要保存的修改。',
      'video.edit.invalidTiming': '请输入有效的开始时间和时长。',
      'video.error.back': '返回对话失败，请重试。',
      'video.error.configuration': '视频服务尚未配置，请检查 Host 配置。',
      'video.error.network': '无法连接到视频服务。',
      'video.error.worker': '视频引擎暂时不可用。',
      'video.error.conflict': '工程已更新，请重新读取后再修改。',
      'video.error.generic': '操作失败。',
      'video.state.queued': '等待中',
      'video.state.running': '处理中',
      'video.state.cancelling': '正在取消',
      'video.state.succeeded': '已完成',
      'video.state.failed': '失败',
      'video.state.cancelled': '已取消',
      'video.state.timed_out': '超时',
    };

    const EN = {
      'nav.label': 'Vedio Editor',
      'video.back': 'Back to conversation',
      'video.empty': 'No project yet',
      'video.open': 'Open example',
      'video.opening': 'Opening…',
      'video.display.label': 'Display options',
      'video.display.simplified': 'Reduce UI effects',
      'video.title': 'Title',
      'video.timing': 'Timing',
      'video.start': 'Start (s)',
      'video.duration': 'Duration (s)',
      'video.update': 'Update frame',
      'video.updating': 'Rendering frame…',
      'video.save': 'Save changes',
      'video.saving': 'Saving…',
      'video.export': 'Export MP4',
      'video.exporting': 'Exporting…',
      'video.cancel': 'Cancel',
      'video.cancelling': 'Cancelling…',
      'video.download': 'Download MP4',
      'video.refresh': 'Reload project',
      'video.refreshing': 'Reloading…',
      'video.frame.empty': 'No frame yet',
      'video.frame.failed': 'The frame could not be loaded. Update it again.',
      'video.noText': 'This project has no editable text.',
      'video.details': 'Properties',
      'video.target': 'Target',
      'video.capabilities': 'Capabilities',
      'video.edit.empty': 'There is nothing to save.',
      'video.edit.invalidTiming': 'Enter a valid start time and duration.',
      'video.error.back': 'Could not return to the conversation. Try again.',
      'video.error.configuration': 'The video service is not configured. Check the Host configuration.',
      'video.error.network': 'Could not reach the video service.',
      'video.error.worker': 'The video engine is temporarily unavailable.',
      'video.error.conflict': 'The project changed. Reload it before editing again.',
      'video.error.generic': 'The operation failed.',
      'video.state.queued': 'Queued',
      'video.state.running': 'Running',
      'video.state.cancelling': 'Cancelling',
      'video.state.succeeded': 'Done',
      'video.state.failed': 'Failed',
      'video.state.cancelled': 'Cancelled',
      'video.state.timed_out': 'Timed out',
    };
    //#endregion

    //#region styles
    // Only inspected theme tokens (--dsw-alias-*) are used for colors; the
    // host-published --dsh-content-font-size and --dsh-frame-top-clearance
    // variables keep typography and the macOS window-chrome clearance native.
    // The empty workspace is deliberately plain: one quiet sentence, no cards,
    // badges, stage framing, decorative motion or future-capability copy.
    const CSS = `
.dv-root{
  --dv-dur-fast:120ms;
  --dv-dur-med:160ms;
  --dv-ease:cubic-bezier(.2,.8,.2,1);
  box-sizing:border-box;
  display:flex;
  flex-direction:column;
  width:100%;
  height:100%;
  min-width:0;
  min-height:0;
  overflow:hidden;
  container-type:inline-size;
  container-name:dsh-video;
  background:var(--dsw-alias-bg-base, #1a1a1c);
  color:var(--dsw-alias-label-primary, #f2f2f5);
  font-family:inherit;
  font-size:var(--dsh-content-font-size, 14px);
  line-height:1.5;
  animation:dv-panel-in var(--dv-dur-med) var(--dv-ease) both;
}
.dv-root *,.dv-root *::before,.dv-root *::after{box-sizing:border-box;}
.dv-root[data-simplified="true"]{--dv-dur-fast:0ms;--dv-dur-med:0ms;}
@keyframes dv-panel-in{
  from{opacity:0;transform:translateY(2px);}
  to{opacity:1;transform:none;}
}
.dv-topbar{
  display:flex;
  align-items:center;
  gap:8px;
  flex:none;
  min-height:52px;
  padding:10px max(16px, var(--dsh-frame-leading-clearance, 0px)) 10px 16px;
  border-bottom:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 62%, transparent);
}
[data-platform="darwin"] .dv-topbar{
  padding-top:calc(10px + var(--dsh-frame-top-clearance, 0px));
}
.dv-back{
  display:inline-flex;
  align-items:center;
  gap:6px;
  flex:none;
  height:32px;
  padding:0 10px;
  border:0;
  border-radius:8px;
  background:transparent;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font:inherit;
  font-size:.86em;
  cursor:pointer;
  -webkit-app-region:no-drag;
  transition:color var(--dv-dur-fast) var(--dv-ease), background var(--dv-dur-fast) var(--dv-ease);
}
.dv-back:hover{
  color:var(--dsw-alias-label-primary, #f2f2f5);
  background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,140,.14));
}
.dv-back:focus-visible{
  outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #5b8cff));
  outline-offset:2px;
}
.dv-back-label{white-space:nowrap;}
.dv-spacer{flex:1;min-width:0;}
.dv-display{position:relative;display:inline-flex;flex:none;}
.dv-icon-button{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:32px;
  height:32px;
  padding:0;
  border:0;
  border-radius:8px;
  background:transparent;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  cursor:pointer;
  -webkit-app-region:no-drag;
  transition:color var(--dv-dur-fast) var(--dv-ease), background var(--dv-dur-fast) var(--dv-ease);
}
.dv-icon-button:hover,.dv-icon-button[aria-expanded="true"]{
  color:var(--dsw-alias-label-primary, #f2f2f5);
  background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,140,.14));
}
.dv-icon-button:focus-visible{
  outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #5b8cff));
  outline-offset:2px;
}
.dv-menu{
  position:absolute;
  top:calc(100% + 6px);
  right:0;
  z-index:2;
  min-width:190px;
  padding:6px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 84%, transparent);
  border-radius:10px;
  background:var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, #232327));
  box-shadow:0 12px 32px -20px rgba(0,0,0,.5);
  -webkit-app-region:no-drag;
}
.dv-menu-item{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  width:100%;
  height:34px;
  padding:0 10px;
  border:0;
  border-radius:7px;
  background:transparent;
  color:var(--dsw-alias-label-primary, #f2f2f5);
  font:inherit;
  font-size:.86em;
  text-align:left;
  cursor:pointer;
}
.dv-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,140,.14));}
.dv-menu-item:focus-visible{
  outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #5b8cff));
  outline-offset:-2px;
}
.dv-menu-check{
  flex:none;
  min-width:1em;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  text-align:center;
}
.dv-menu-text{
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.dv-main{
  display:flex;
  flex:1;
  flex-direction:column;
  min-width:0;
  min-height:0;
  padding:0;
  overflow:hidden;
}
.dv-emptywrap{
  display:flex;
  flex:1;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap:14px;
  min-width:0;
  min-height:0;
  padding:24px;
}
.dv-empty{
  margin:0;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font-size:1em;
}
.dv-error{
  margin:0;
  max-width:38em;
  color:var(--dsw-alias-state-error-primary, #e5484d);
  font-size:.86em;
  text-align:center;
}
.dv-editor{
  display:grid;
  grid-template-columns:minmax(0,1fr) 288px;
  flex:1;
  min-width:0;
  min-height:0;
}
.dv-stage{
  display:flex;
  flex-direction:column;
  gap:12px;
  min-width:0;
  min-height:0;
  padding:16px;
}
.dv-stagebar{
  display:flex;
  align-items:baseline;
  justify-content:space-between;
  gap:12px;
  min-height:28px;
}
.dv-project-title{
  min-width:0;
  overflow:hidden;
  color:var(--dsw-alias-label-primary, #f2f2f5);
  font-size:1.08em;
  font-weight:600;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.dv-project-meta{
  flex:none;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font-size:.8em;
  font-variant-numeric:tabular-nums;
  white-space:nowrap;
}
.dv-canvas{
  position:relative;
  display:flex;
  flex:1;
  align-items:center;
  justify-content:center;
  min-height:200px;
  overflow:hidden;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 70%, transparent);
  border-radius:10px;
  background:var(--dsw-alias-bg-layer-1, #232327);
}
.dv-frame{
  display:block;
  max-width:100%;
  max-height:100%;
  object-fit:contain;
}
.dv-canvas-note{
  margin:0;
  max-width:32em;
  padding:16px;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font-size:.86em;
  text-align:center;
}
.dv-side{
  display:flex;
  flex-direction:column;
  gap:14px;
  min-height:0;
  overflow:auto;
  padding:16px;
  border-left:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 62%, transparent);
}
.dv-actions{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
}
.dv-button{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  min-height:32px;
  padding:0 12px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 86%, transparent);
  border-radius:8px;
  background:transparent;
  color:var(--dsw-alias-label-primary, #f2f2f5);
  font:inherit;
  font-size:.86em;
  cursor:pointer;
  transition:background var(--dv-dur-fast) var(--dv-ease), border-color var(--dv-dur-fast) var(--dv-ease), opacity var(--dv-dur-fast) var(--dv-ease);
}
.dv-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,140,.14));}
.dv-button:focus-visible{
  outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #5b8cff));
  outline-offset:2px;
}
.dv-button:disabled{opacity:.55;cursor:default;}
.dv-button-primary{
  border-color:transparent;
  background:var(--dsw-alias-brand-primary, #5b8cff);
  color:var(--dsw-alias-label-on-brand, #fff);
}
.dv-button-primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary, #5b8cff);filter:brightness(1.06);}
.dv-button-quiet{color:var(--dsw-alias-label-secondary, #a4a4ad);}
.dv-field{
  display:flex;
  flex-direction:column;
  gap:6px;
}
.dv-field-row{
  display:flex;
  gap:8px;
}
.dv-field-row .dv-field{flex:1;min-width:0;}
.dv-label{
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font-size:.8em;
}
.dv-input{
  width:100%;
  min-width:0;
  height:32px;
  padding:0 9px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 86%, transparent);
  border-radius:8px;
  background:var(--dsw-alias-bg-base, #1a1a1c);
  color:var(--dsw-alias-label-primary, #f2f2f5);
  font:inherit;
  font-size:.86em;
}
.dv-input:focus-visible{
  outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #5b8cff));
  outline-offset:1px;
}
.dv-note{
  margin:0;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font-size:.8em;
}
.dv-job{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:8px;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font-size:.8em;
}
.dv-job-state{
  color:var(--dsw-alias-label-primary, #f2f2f5);
}
.dv-download{
  color:var(--dsw-alias-brand-primary, #5b8cff);
  font-size:.86em;
  text-decoration:none;
}
.dv-download:hover{text-decoration:underline;}
.dv-download:focus-visible{
  outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary, #5b8cff));
  outline-offset:2px;
}
.dv-details{
  padding-top:10px;
  border-top:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 62%, transparent);
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font-size:.8em;
}
.dv-details summary{cursor:pointer;color:var(--dsw-alias-label-primary, #f2f2f5);}
.dv-meta-list{
  display:flex;
  flex-direction:column;
  gap:6px;
  margin:8px 0 0;
  padding:0;
  list-style:none;
}
.dv-meta-item{
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.dv-side .dv-error{
  max-width:none;
  text-align:left;
}
@media (prefers-reduced-motion: reduce){
  .dv-root{animation:none;}
}
@container dsh-video (max-width: 820px){
  .dv-editor{grid-template-columns:minmax(0,1fr);}
  .dv-stage{padding-bottom:8px;}
  .dv-side{
    max-height:46%;
    border-top:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 62%, transparent);
    border-left:0;
  }
}
@container dsh-video (max-width: 520px){
  .dv-topbar{padding-left:12px;padding-right:12px;}
  .dv-back{padding:0 8px;}
  .dv-stage{padding:10px;}
  .dv-side{padding:10px;}
}
`;
    //#endregion

    //#region diagnostics
    const reportedCodes = new Set();
    let reportIssue = function noopReport() {};

    /** Build a logger that can never throw into the UI or the slot runtime. */
    function makeReporter(ctx) {
      return function report(code, error) {
        try {
          const message = 'dsh-video: ' + code;
          if (error === undefined) {
            if (ctx.logger && typeof ctx.logger.warn === 'function') ctx.logger.warn(message);
          } else if (ctx.logger && typeof ctx.logger.error === 'function') {
            ctx.logger.error(message, error);
          }
        } catch (_ignored) {
          /* diagnostics must not break activation or interaction */
        }
      };
    }

    function reportOnce(code, error) {
      if (reportedCodes.has(code)) return;
      reportedCodes.add(code);
      reportIssue(code, error);
    }
    //#endregion

    //#region preferences + plugin store
    function safeStorage() {
      try {
        if (typeof localStorage === 'undefined') return null;
        const candidate = localStorage;
        if (
          candidate === null ||
          typeof candidate !== 'object' ||
          typeof candidate.getItem !== 'function' ||
          typeof candidate.setItem !== 'function'
        ) {
          return null;
        }
        return candidate;
      } catch (_error) {
        return null;
      }
    }

    function defaultPrefs() {
      return { simplifiedEffects: false };
    }

    /**
     * Read the versioned browser preference. Any absence, corrupt JSON, unexpected
     * shape, unknown version, or storage exception falls back to defaults.
     */
    function readPrefs() {
      const storage = safeStorage();
      if (storage === null) return defaultPrefs();
      let raw;
      try {
        raw = storage.getItem(PREFS_KEY);
      } catch (error) {
        reportOnce('prefs-read-failed', error);
        return defaultPrefs();
      }
      if (typeof raw !== 'string' || raw === '') return defaultPrefs();
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultPrefs();
        if (parsed.version !== PREFS_VERSION) return defaultPrefs();
        return { simplifiedEffects: parsed.simplifiedEffects === true };
      } catch (error) {
        reportOnce('prefs-corrupt', error);
        return defaultPrefs();
      }
    }

    /**
     * Best-effort write of the versioned preference. A failed write keeps the
     * in-memory value and reports once; it never blocks the UI.
     */
    function writePrefs(state) {
      const storage = safeStorage();
      if (storage === null) {
        reportOnce('prefs-storage-unavailable');
        return false;
      }
      try {
        storage.setItem(
          PREFS_KEY,
          JSON.stringify({ version: PREFS_VERSION, simplifiedEffects: state.simplifiedEffects === true })
        );
        return true;
      } catch (error) {
        reportOnce('prefs-write-failed', error);
        return false;
      }
    }

    function createUiStore(initial, report) {
      let state = initial;
      const listeners = new Set();
      return {
        getSnapshot() {
          return state;
        },
        subscribe(listener) {
          listeners.add(listener);
          return function unsubscribe() {
            listeners.delete(listener);
          };
        },
        setPatch(patch) {
          state = Object.assign({}, state, patch);
          const snapshot = Array.from(listeners);
          for (let index = 0; index < snapshot.length; index += 1) {
            try {
              snapshot[index]();
            } catch (error) {
              report('store-listener-failed', error);
            }
          }
        },
      };
    }

    /** Plugin-scope store shared by the panel and its display menu. */
    let uiStore = null;
    /** Bounded panel-scope memory: a mode switch must not rewrite worker state. */
    let editorMemory = null;

    function getStore() {
      if (uiStore === null) {
        uiStore = createUiStore(
          { simplifiedEffects: false, navigationError: null },
          function noop() {}
        );
      }
      return uiStore;
    }

    function usePluginState() {
      const store = getStore();
      return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    }

    function setSimplifiedEffects(next) {
      const store = getStore();
      const value = next === true;
      if (store.getSnapshot().simplifiedEffects === value) return;
      store.setPatch({ simplifiedEffects: value });
      writePrefs(store.getSnapshot());
    }

    function setNavigationError(code) {
      const store = getStore();
      const value = typeof code === 'string' ? code : null;
      if (store.getSnapshot().navigationError === value) return;
      store.setPatch({ navigationError: value });
    }
    //#endregion

    //#region host helpers
    /** Feature-detected slot enumeration, used for occupancy diagnostics. */
    function slotEntries(ctx, slotName) {
      try {
        const slots = ctx.slots;
        if (slots === null || typeof slots !== 'object' || typeof slots.entries !== 'function') return null;
        const entries = slots.entries(slotName);
        return Array.isArray(entries) ? entries : null;
      } catch (error) {
        reportOnce('slot-entries-failed', error);
        return null;
      }
    }

    /**
     * Detect whether a slot already has occupants. `field === null` matches any
     * entry (single/list slots); otherwise the entry's options[field] must equal
     * value. Returns null when the runtime cannot answer.
     */
    function findOccupants(ctx, slotName, field, value) {
      const entries = slotEntries(ctx, slotName);
      if (entries === null) return null;
      if (field === null) return entries;
      return entries.filter(function keep(entry) {
        return entry !== null && typeof entry === 'object' && entry.options && entry.options[field] === value;
      });
    }

    /** Whether a slot declaration currently exists; null when it cannot be known. */
    function isSlotDeclared(ctx, slotName) {
      try {
        const slots = ctx.slots;
        if (slots === null || typeof slots !== 'object') return null;
        if (typeof slots.specDynamic === 'function') return slots.specDynamic(slotName) !== undefined;
        if (typeof slots.spec === 'function') return slots.spec(slotName) !== undefined;
      } catch (_error) {
        return null;
      }
      return null;
    }
    //#endregion

    //#region icons
    /**
     * Refined one-pixel video-camera outline for the host sidebar row. The host
     * supplies the square edge (`size`: 16 expanded / 18 collapsed in 0.2.0-rc.2)
     * and the selected state; the glyph follows the row's currentColor only.
     */
    function SidebarVideoIcon(props) {
      let size = props && typeof props.size === 'number' && isFinite(props.size) ? props.size : 16;
      if (size < 12) size = 12;
      if (size > 24) size = 24;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
          stroke: 'currentColor',
          strokeWidth: 1,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('rect', { x: 1.25, y: 3.5, width: 8.75, height: 9, rx: 2 }),
        h('path', { d: 'M10 7.15 13.9 5a.55.55 0 0 1 .82.48v5.04a.55.55 0 0 1-.82.48L10 8.85' })
      );
    }

    function BackIcon() {
      return h(
        'svg',
        {
          width: 14,
          height: 14,
          viewBox: '0 0 16 16',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        h('path', { d: 'M9.75 3.5 5.25 8l4.5 4.5' })
      );
    }

    function DisplayOptionsIcon() {
      return h(
        'svg',
        {
          width: 16,
          height: 16,
          viewBox: '0 0 16 16',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
          stroke: 'currentColor',
          strokeWidth: 1,
          strokeLinecap: 'round',
        },
        h('path', { d: 'M2.5 4.25h2.2M8.3 4.25h5.2' }),
        h('circle', { cx: 6.5, cy: 4.25, r: 1.5 }),
        h('path', { d: 'M2.5 8h5.3M11.4 8h2.1' }),
        h('circle', { cx: 9.6, cy: 8, r: 1.5 }),
        h('path', { d: 'M2.5 11.75h1.9M7.9 11.75h5.6' }),
        h('circle', { cx: 6.1, cy: 11.75, r: 1.5 })
      );
    }
    //#endregion

    //#region host bridge helpers
    // The Host-configured controlled fixture id. A request can only reference a
    // project id from the trusted allowlist; this UI never sends a path or URL.
    const DEMO_PROJECT_ID = 'demo';
    const REQUEST_ROUTE = 'api/dsh-video/request';
    const ARTIFACT_ROUTE = 'api/dsh-video/artifact';
    const TERMINAL_JOB_STATES = ['succeeded', 'failed', 'cancelled', 'timed_out'];

    function operationId() {
      try {
        if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
      } catch (_error) {
        /* fall through to the bounded local form */
      }
      return 'ui-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }

    function artifactUrl(jobId) {
      return ARTIFACT_ROUTE + '?jobId=' + encodeURIComponent(String(jobId));
    }

    function capabilityList(element) {
      return element && Array.isArray(element.capabilities) ? element.capabilities : [];
    }

    function textElement(elements) {
      for (let index = 0; index < elements.length; index += 1) {
        if (capabilityList(elements[index]).indexOf('text') !== -1) return elements[index];
      }
      return null;
    }

    function timingElement(elements) {
      for (let index = 0; index < elements.length; index += 1) {
        if (capabilityList(elements[index]).indexOf('timing') !== -1) return elements[index];
      }
      return null;
    }

    function elementsOf(project) {
      return project && Array.isArray(project.elements) ? project.elements : [];
    }

    function frameTime(project) {
      const duration = Number(project && project.duration);
      if (Number.isFinite(duration) === false || duration <= 0) return 0;
      return Math.min(2.5, Math.max(0, duration - 1 / 30));
    }

    function formatSeconds(value) {
      return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '';
    }

    function isTerminalJob(job) {
      return job !== null && typeof job === 'object' && TERMINAL_JOB_STATES.indexOf(job.state) !== -1;
    }

    function hostError(error) {
      if (error !== null && typeof error === 'object' && typeof error.code === 'string') {
        return {
          code: error.code,
          message: typeof error.message === 'string' && error.message.length > 0 ? error.message : 'Request failed',
          uncertain: error.uncertain === true,
          jobUnknown: error.jobUnknown === true,
        };
      }
      return { code: 'E_NETWORK', message: 'Request failed', uncertain: false, jobUnknown: false };
    }

    async function hostRequest(method, params) {
      if (typeof fetch !== 'function') throw { code: 'E_NETWORK', message: 'fetch is unavailable' };
      let response;
      try {
        response = await fetch(REQUEST_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ method: method, params: params || {} }),
        });
      } catch (_error) {
        throw { code: 'E_NETWORK', message: 'Could not reach the video service' };
      }
      let body = null;
      try {
        body = await response.json();
      } catch (_error) {
        body = null;
      }
      if (body === null || typeof body !== 'object') {
        throw { code: 'E_NETWORK', message: 'The video service returned an invalid response' };
      }
      if (body.ok === true) return body.result;
      const error = body.error !== null && typeof body.error === 'object' ? body.error : {};
      throw hostError({
        code: typeof error.code === 'string' ? error.code : 'E_INTERNAL',
        message: typeof error.message === 'string' ? error.message : 'The video service rejected the request',
        uncertain: error.uncertain === true,
        jobUnknown: error.jobUnknown === true,
      });
    }

    function errorText(error, t) {
      const code = error && error.code;
      let friendly = null;
      if (code === 'E_CONFIGURATION') friendly = t('video.error.configuration');
      else if (code === 'E_NETWORK') friendly = t('video.error.network');
      else if (code === 'E_REVISION_CONFLICT' || code === 'E_OPERATION_REUSED' || code === 'E_PROJECT_CLOSING' || code === 'E_PROJECT_NOT_OPEN') friendly = t('video.error.conflict');
      else if (code === 'E_WORKER_START' || code === 'E_WORKER_EXITED' || code === 'E_WORKER_DISPOSED' || code === 'E_TRANSPORT' || code === 'E_STARTUP') friendly = t('video.error.worker');
      else if (code === 'E_ARTIFACT_INTEGRITY' || code === 'E_ARTIFACT_NOT_READY') friendly = t('video.frame.failed');
      const detail = error && typeof error.message === 'string' ? error.message : '';
      if (friendly !== null) {
        return detail.length > 0 ? friendly + ' ' + detail : friendly;
      }
      return detail.length > 0 ? detail : t('video.error.generic');
    }

    function stateText(state, t) {
      return typeof state === 'string' && state.length > 0 ? t('video.state.' + state) : '';
    }
    //#endregion

    //#region components
    function StyleTag() {
      return h('style', {
        'data-dsh-video': 'styles',
        dangerouslySetInnerHTML: { __html: CSS },
      });
    }

    function VideoWorkspace(props) {
      const t = props.t;
      const onBack = props.onBack;
      const ui = usePluginState();
      const [menuOpen, setMenuOpen] = React.useState(false);
      const triggerRef = React.useRef(null);
      const itemRef = React.useRef(null);

      const remembered = editorMemory === null ? {} : editorMemory;
      const [project, setProject] = React.useState(remembered.project || null);
      const [frame, setFrame] = React.useState(remembered.frame || null);
      const [job, setJob] = React.useState(remembered.job || null);
      const [busy, setBusy] = React.useState(null);
      const [error, setError] = React.useState(remembered.error || null);
      const [titleDraft, setTitleDraft] = React.useState(typeof remembered.titleDraft === 'string' ? remembered.titleDraft : '');
      const [startDraft, setStartDraft] = React.useState(typeof remembered.startDraft === 'string' ? remembered.startDraft : '');
      const [durationDraft, setDurationDraft] = React.useState(typeof remembered.durationDraft === 'string' ? remembered.durationDraft : '');
      const aliveRef = React.useRef(true);
      const jobTokenRef = React.useRef(0);
      const resumedRef = React.useRef(false);

      React.useEffect(
        function keepAlive() {
          aliveRef.current = true;
          return function cleanupWorkspace() {
            aliveRef.current = false;
          };
        },
        []
      );

      // A panel switch is a view switch: the worker keeps the project and jobs,
      // and this memory keeps the visible project/frame/draft/job in the plugin
      // scope so returning restores them instead of silently clearing progress.
      React.useEffect(function rememberVisibleState() {
        editorMemory = {
          project: project,
          frame: frame,
          job: job,
          error: error,
          titleDraft: titleDraft,
          startDraft: startDraft,
          durationDraft: durationDraft,
        };
      });

      // Resume observation of a job that was already running when the panel was
      // left. A terminal job needs no polling; the restored state is enough.
      React.useEffect(
        function resumeRunningJob() {
          if (resumedRef.current) return;
          resumedRef.current = true;
          if (project === null || job === null || isTerminalJob(job)) return;
          const kind = job.kind === 'frame' ? 'frame' : 'render';
          const token = ++jobTokenRef.current;
          setBusy(kind === 'frame' ? 'frame' : 'export');
          void waitForJob(job, kind, project, token).finally(function finishResume() {
            if (aliveRef.current && token === jobTokenRef.current) setBusy(null);
          });
        },
        []
      );

      // Focus management for the single-item display menu. The trigger opens the
      // menu; the open menu moves focus onto its item; Escape and Tab close it and
      // return focus to the trigger (Tab is not prevented from leaving afterwards,
      // and focus never stays on the removed node). No document/window listeners
      // are installed, so unmount cannot leak a global handler.
      React.useEffect(
        function focusOpenItem() {
          if (!menuOpen || itemRef.current === null || typeof itemRef.current.focus !== 'function') return;
          try {
            itemRef.current.focus();
          } catch (_error) {
            /* focus is best-effort; the menu stays usable */
          }
        },
        [menuOpen]
      );

      function focusTrigger() {
        try {
          if (triggerRef.current !== null && typeof triggerRef.current.focus === 'function') {
            triggerRef.current.focus();
          }
        } catch (_error) {
          /* focus is best-effort; the menu is already closed */
        }
      }

      function openMenu() {
        setMenuOpen(true);
      }

      function closeMenu() {
        setMenuOpen(false);
        focusTrigger();
      }

      function onTriggerClick() {
        if (menuOpen) closeMenu();
        else openMenu();
      }

      function onTriggerKeyDown(event) {
        if (!event) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (menuOpen) {
            if (itemRef.current !== null && typeof itemRef.current.focus === 'function') itemRef.current.focus();
          } else {
            openMenu();
          }
        } else if (event.key === 'Escape' && menuOpen) {
          event.preventDefault();
          closeMenu();
        }
      }

      function onMenuKeyDown(event) {
        if (!event) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          closeMenu();
        } else if (event.key === 'Tab') {
          event.preventDefault();
          closeMenu();
        }
      }

      function onToggleSimplified() {
        setSimplifiedEffects(!ui.simplifiedEffects);
      }

      function applyInspected(inspected) {
        const elements = elementsOf(inspected);
        const titleTarget = textElement(elements);
        const timingTarget = timingElement(elements);
        setProject(inspected);
        setTitleDraft(titleTarget !== null && typeof titleTarget.text === 'string' ? titleTarget.text : '');
        setStartDraft(timingTarget !== null && timingTarget.timing ? formatSeconds(timingTarget.timing.start) : '');
        setDurationDraft(timingTarget !== null && timingTarget.timing ? formatSeconds(timingTarget.timing.duration) : '');
      }

      function clearEditor() {
        jobTokenRef.current += 1;
        setProject(null);
        setFrame(null);
        setJob(null);
        setBusy(null);
        setTitleDraft('');
        setStartDraft('');
        setDurationDraft('');
      }

      function sleep(milliseconds) {
        return new Promise(function wait(resolve) {
          setTimeout(resolve, milliseconds);
        });
      }

      async function waitForJob(initialJob, kind, targetProject, token) {
        if (!aliveRef.current || token !== jobTokenRef.current) return null;
        setJob(initialJob);
        const deadline = Date.now() + 125000;
        for (;;) {
          if (!aliveRef.current || token !== jobTokenRef.current) return null;
          let current;
          try {
            current = await hostRequest('status', { jobId: initialJob.jobId });
          } catch (requestError) {
            if (aliveRef.current && token === jobTokenRef.current) setError(hostError(requestError));
            return null;
          }
          if (!aliveRef.current || token !== jobTokenRef.current) return null;
          setJob(current);
          if (isTerminalJob(current)) {
            if (kind === 'frame') {
              if (current.state === 'succeeded') {
                setFrame({
                  url: artifactUrl(initialJob.jobId),
                  revision: targetProject.revision,
                  jobId: initialJob.jobId,
                });
              } else {
                setError(hostError(current.error || { code: 'E_FRAME_FAILED', message: t('video.error.generic') }));
              }
            } else if (current.state !== 'succeeded') {
              setError(hostError(current.error || { code: 'E_RENDER_FAILED', message: t('video.error.generic') }));
            }
            return current;
          }
          if (Date.now() > deadline) {
            setError({ code: 'E_TIMEOUT', message: t('video.error.generic') });
            return null;
          }
          await sleep(700);
        }
      }

      async function requestFrame(targetProject) {
        if (targetProject === null) return;
        const token = ++jobTokenRef.current;
        setBusy('frame');
        setError(null);
        setFrame(null);
        setJob(null);
        try {
          const initial = await hostRequest('frame', {
            projectId: targetProject.projectId,
            revision: targetProject.revision,
            time: frameTime(targetProject),
          });
          await waitForJob(initial, 'frame', targetProject, token);
        } catch (requestError) {
          if (aliveRef.current && token === jobTokenRef.current) setError(hostError(requestError));
        } finally {
          if (aliveRef.current && token === jobTokenRef.current) setBusy(null);
        }
      }

      async function openSample() {
        if (busy !== null) return;
        jobTokenRef.current += 1;
        clearEditor();
        setBusy('open');
        setError(null);
        let inspected = null;
        try {
          const opened = await hostRequest('open', { projectId: DEMO_PROJECT_ID });
          inspected = await hostRequest('inspect', { projectId: opened.projectId });
          if (aliveRef.current) applyInspected(inspected);
        } catch (requestError) {
          if (aliveRef.current) setError(hostError(requestError));
        } finally {
          if (aliveRef.current) setBusy(null);
        }
        if (inspected !== null && aliveRef.current) void requestFrame(inspected);
      }

      async function refreshProject() {
        if (project === null || busy !== null) return;
        const token = ++jobTokenRef.current;
        setBusy('refresh');
        setError(null);
        let inspected = null;
        try {
          inspected = await hostRequest('inspect', { projectId: project.projectId });
          if (aliveRef.current && token === jobTokenRef.current) applyInspected(inspected);
        } catch (requestError) {
          if (aliveRef.current && token === jobTokenRef.current) setError(hostError(requestError));
        } finally {
          if (aliveRef.current && token === jobTokenRef.current) setBusy(null);
        }
        if (inspected !== null && inspected.revision !== project.revision && aliveRef.current) {
          setFrame(null);
          setJob(null);
          void requestFrame(inspected);
        }
      }

      async function saveEdit() {
        if (project === null || busy !== null) return;
        const elements = elementsOf(project);
        const titleTarget = textElement(elements);
        const timingTarget = timingElement(elements);
        const ops = [];
        let nextStart = null;
        let nextDuration = null;

        if (titleTarget !== null && titleDraft !== titleTarget.text) {
          ops.push({ type: 'text', target: titleTarget.stableId, text: titleDraft });
        }
        if (timingTarget !== null) {
          nextStart = Number(startDraft);
          nextDuration = Number(durationDraft);
          if (Number.isFinite(nextStart) === false || Number.isFinite(nextDuration) === false || nextStart < 0 || nextStart > 3600 || nextDuration < 1 / 240 || nextDuration > 3600) {
            setError({ code: 'E_PARAMS', message: t('video.edit.invalidTiming') });
            return;
          }
          if (timingTarget.timing && (nextStart !== Number(timingTarget.timing.start) || nextDuration !== Number(timingTarget.timing.duration))) {
            ops.push({ type: 'timing', target: timingTarget.stableId, start: nextStart, duration: nextDuration });
          }
        }
        if (ops.length === 0) {
          setError({ code: 'E_PARAMS', message: t('video.edit.empty') });
          return;
        }

        const token = ++jobTokenRef.current;
        setBusy('edit');
        setError(null);
        let inspected = null;
        try {
          await hostRequest('edit', {
            projectId: project.projectId,
            expectedRevision: project.revision,
            operationId: operationId(),
            ops: ops,
          });
          inspected = await hostRequest('inspect', { projectId: project.projectId });
          if (aliveRef.current && token === jobTokenRef.current) applyInspected(inspected);
        } catch (requestError) {
          if (aliveRef.current && token === jobTokenRef.current) setError(hostError(requestError));
        } finally {
          if (aliveRef.current && token === jobTokenRef.current) setBusy(null);
        }
        if (inspected !== null && aliveRef.current) {
          setFrame(null);
          setJob(null);
          void requestFrame(inspected);
        }
      }

      async function exportVideo() {
        if (project === null || busy !== null) return;
        const token = ++jobTokenRef.current;
        setBusy('export');
        setError(null);
        setJob(null);
        try {
          const initial = await hostRequest('render', {
            projectId: project.projectId,
            revision: project.revision,
          });
          await waitForJob(initial, 'render', project, token);
        } catch (requestError) {
          if (aliveRef.current && token === jobTokenRef.current) setError(hostError(requestError));
        } finally {
          if (aliveRef.current && token === jobTokenRef.current) setBusy(null);
        }
      }

      async function cancelCurrentJob() {
        if (job === null || typeof job.jobId !== 'string' || isTerminalJob(job) || busy === 'cancel') return;
        setBusy('cancel');
        try {
          const updated = await hostRequest('cancel', { jobId: job.jobId });
          if (aliveRef.current) setJob(updated);
        } catch (requestError) {
          if (aliveRef.current) setError(hostError(requestError));
        } finally {
          if (aliveRef.current) setBusy(null);
        }
      }

      const elements = elementsOf(project);
      const titleTarget = textElement(elements);
      const timingTarget = timingElement(elements);
      const savedTitle = titleTarget !== null && typeof titleTarget.text === 'string' ? titleTarget.text : '';
      const titleChanged = titleTarget !== null && titleDraft !== savedTitle;
      const timingChanged =
        timingTarget !== null &&
        timingTarget.timing &&
        (Number(startDraft) !== Number(timingTarget.timing.start) || Number(durationDraft) !== Number(timingTarget.timing.duration));
      const canSave = project !== null && busy === null && (titleChanged || timingChanged);
      const projectTitle = project !== null ? savedTitle || project.projectId : '';
      const projectMeta =
        project !== null && Number.isFinite(Number(project.width)) && Number.isFinite(Number(project.height))
          ? Math.round(Number(project.width)) + '×' + Math.round(Number(project.height)) + ' · ' + formatSeconds(project.duration) + 's'
          : '';
      const activeJob = job !== null && typeof job === 'object' ? job : null;
      const canCancel = activeJob !== null && typeof activeJob.jobId === 'string' && !isTerminalJob(activeJob) && busy !== 'cancel';
      const download = activeJob !== null && activeJob.state === 'succeeded' && activeJob.kind === 'render' ? artifactUrl(activeJob.jobId) : null;
      const busyLabel = (key, idleKey) => (busy === key ? t(idleKey) : null);

      function errorNotice() {
        if (error === null) return null;
        return h('p', { className: 'dv-error', role: 'alert', key: 'error' }, errorText(error, t));
      }

      function navigationNotice() {
        if (ui.navigationError === null) return null;
        return h('p', { className: 'dv-error', role: 'alert', key: 'navigation-error' }, t('video.error.back'));
      }

      function stageContent() {
        if (project === null) {
          return h(
            'div',
            { className: 'dv-emptywrap', key: 'empty' },
            navigationNotice(),
            errorNotice(),
            h('p', { className: 'dv-empty' }, t('video.empty')),
            h(
              'button',
              {
                type: 'button',
                className: 'dv-button dv-button-primary',
                disabled: busy !== null,
                onClick: openSample,
              },
              busy === 'open' ? t('video.opening') : t('video.open')
            )
          );
        }
        return h(
          'div',
          { className: 'dv-editor', key: 'editor' },
          h(
            'section',
            { className: 'dv-stage', 'aria-label': projectTitle },
            h(
              'header',
              { className: 'dv-stagebar' },
              h('div', { className: 'dv-project-title' }, projectTitle),
              projectMeta === '' ? null : h('div', { className: 'dv-project-meta' }, projectMeta)
            ),
            h(
              'div',
              { className: 'dv-canvas' },
              frame !== null
                ? h('img', {
                    className: 'dv-frame',
                    src: frame.url,
                    alt: projectTitle,
                    onError: function frameFailed() {
                      if (!aliveRef.current) return;
                      setFrame(null);
                      setError({ code: 'E_ARTIFACT_INTEGRITY', message: t('video.frame.failed') });
                    },
                  })
                : h('p', { className: 'dv-canvas-note' }, busy === 'frame' ? t('video.updating') : t('video.frame.empty'))
            )
          ),
          h(
            'aside',
            { className: 'dv-side', 'aria-label': t('video.details') },
            h(
              'div',
              { className: 'dv-actions' },
              h(
                'button',
                { type: 'button', className: 'dv-button dv-button-primary', disabled: busy !== null, onClick: function update() { void requestFrame(project); } },
                busy === 'frame' ? t('video.updating') : t('video.update')
              ),
              h(
                'button',
                { type: 'button', className: 'dv-button', disabled: busy !== null, onClick: function render() { void exportVideo(); } },
                busy === 'export' ? t('video.exporting') : t('video.export')
              ),
              h(
                'button',
                { type: 'button', className: 'dv-button dv-button-quiet', disabled: busy !== null, onClick: function refresh() { void refreshProject(); } },
                busy === 'refresh' ? t('video.refreshing') : t('video.refresh')
              )
            ),
            navigationNotice(),
            errorNotice(),
            project === null ? null : h('div', { className: 'dv-field' },
              h('label', { className: 'dv-label', htmlFor: 'dsh-video-title' }, t('video.title')),
              h('input', {
                id: 'dsh-video-title',
                className: 'dv-input',
                type: 'text',
                value: titleDraft,
                disabled: busy !== null || titleTarget === null,
                onChange: function updateTitle(event) { setTitleDraft(event.target.value); },
              })
            ),
            project === null || timingTarget === null ? null : h('div', null,
              h('div', { className: 'dv-label' }, t('video.timing')),
              h('div', { className: 'dv-field-row' },
                h('div', { className: 'dv-field' },
                  h('label', { className: 'dv-label', htmlFor: 'dsh-video-start' }, t('video.start')),
                  h('input', { id: 'dsh-video-start', className: 'dv-input', type: 'number', step: '0.05', min: '0', max: '3600', value: startDraft, disabled: busy !== null, onChange: function updateStart(event) { setStartDraft(event.target.value); } })
                ),
                h('div', { className: 'dv-field' },
                  h('label', { className: 'dv-label', htmlFor: 'dsh-video-duration' }, t('video.duration')),
                  h('input', { id: 'dsh-video-duration', className: 'dv-input', type: 'number', step: '0.05', min: '0.01', max: '3600', value: durationDraft, disabled: busy !== null, onChange: function updateDuration(event) { setDurationDraft(event.target.value); } })
                )
              )
            ),
            titleTarget === null && timingTarget === null ? h('p', { className: 'dv-note' }, t('video.noText')) : null,
            h('button', {
              type: 'button',
              className: 'dv-button',
              disabled: !canSave,
              onClick: function save() { void saveEdit(); },
            }, busy === 'edit' ? t('video.saving') : t('video.save')),
            activeJob === null ? null : h('div', { className: 'dv-job' },
              h('span', { className: 'dv-job-state' }, stateText(activeJob.state, t)),
              Number.isFinite(Number(activeJob.progress)) && activeJob.progress > 0 ? h('span', null, Math.round(Number(activeJob.progress) * 100) + '%') : null,
              canCancel ? h('button', { type: 'button', className: 'dv-button dv-button-quiet', disabled: busy === 'cancel', onClick: function cancel() { void cancelCurrentJob(); } }, busy === 'cancel' ? t('video.cancelling') : t('video.cancel')) : null,
              download === null ? null : h('a', { className: 'dv-download', href: download, download: 'dsh-video-' + activeJob.jobId + '.mp4' }, t('video.download'))
            ),
            h('details', { className: 'dv-details' },
              h('summary', null, t('video.details')),
              h('ul', { className: 'dv-meta-list' },
                elements.map(function elementRow(element, index) {
                  const capabilities = capabilityList(element);
                  const summary = (typeof element.stableId === 'string' && element.stableId.length > 0 ? element.stableId : '#' + (index + 1)) + (capabilities.length > 0 ? ' · ' + capabilities.join(', ') : '');
                  return h('li', { className: 'dv-meta-item', key: (element.stableId || index) + '' }, summary);
                })
              ),
              titleTarget === null && timingTarget === null ? null : h('p', { className: 'dv-note' }, (titleTarget !== null ? t('video.title') + ': ' + titleTarget.stableId : '') + (timingTarget !== null && timingTarget !== titleTarget ? (titleTarget !== null ? ' · ' : '') + t('video.timing') + ': ' + timingTarget.stableId : ''))
            )
          )
        );
      }

      return h(
        'div',
        {
          className: 'dv-root',
          'data-simplified': ui.simplifiedEffects ? 'true' : 'false',
          'data-panel': PANEL_ID,
        },
        h(StyleTag, { key: 'style' }),
        h(
          'header',
          { className: 'dv-topbar', 'data-window-drag': true, key: 'topbar' },
          h(
            'button',
            {
              type: 'button',
              key: 'back',
              className: 'dv-back',
              onClick: onBack,
              'aria-label': t('video.back'),
              title: t('video.back'),
            },
            h(BackIcon, { key: 'icon' }),
            h('span', { className: 'dv-back-label', key: 'label' }, t('video.back'))
          ),
          h('span', { className: 'dv-spacer', key: 'spacer' }),
          h(
            'div',
            { className: 'dv-display', key: 'display' },
            h(
              'button',
              {
                type: 'button',
                key: 'trigger',
                ref: triggerRef,
                className: 'dv-icon-button',
                'aria-haspopup': 'menu',
                'aria-expanded': menuOpen ? 'true' : 'false',
                'aria-controls': 'dsh-video-display-menu',
                'aria-label': t('video.display.label'),
                title: t('video.display.label'),
                onClick: onTriggerClick,
                onKeyDown: onTriggerKeyDown,
              },
              h(DisplayOptionsIcon)
            ),
            menuOpen
              ? h(
                  'div',
                  {
                    className: 'dv-menu',
                    id: 'dsh-video-display-menu',
                    role: 'menu',
                    'aria-label': t('video.display.label'),
                    key: 'menu',
                    onKeyDown: onMenuKeyDown,
                  },
                  h(
                    'button',
                    {
                      type: 'button',
                      key: 'item',
                      ref: itemRef,
                      className: 'dv-menu-item',
                      role: 'menuitemcheckbox',
                      tabIndex: -1,
                      'aria-checked': ui.simplifiedEffects ? 'true' : 'false',
                      onClick: onToggleSimplified,
                    },
                    h('span', { className: 'dv-menu-text', key: 'text' }, t('video.display.simplified')),
                    h(
                      'span',
                      { className: 'dv-menu-check', 'aria-hidden': 'true', key: 'check' },
                      ui.simplifiedEffects ? '✓' : ''
                    )
                  )
                )
              : null
          )
        ),
        h('main', { className: 'dv-main', key: 'main' }, stageContent())
      );
    }
    //#endregion

    //#region plugin
    const inject = ['slots', 'layout', 'locale'];

    function apply(ctx) {
      reportIssue = makeReporter(ctx);
      reportedCodes.clear();
      const initialPrefs = readPrefs();
      uiStore = createUiStore(
        { simplifiedEffects: initialPrefs.simplifiedEffects === true, navigationError: null },
        reportIssue
      );

      ctx.effect(
        function registerDictionaries() {
          try {
            return ctx.locale.register(NS, { zh: ZH, en: EN });
          } catch (error) {
            // Text falls back to dictionary keys; registration still proceeds.
            reportIssue('locale-register-failed', error);
            return function noopDispose() {};
          }
        },
        'dsh-video: dictionaries'
      );

      // Unload safety net: leaving the profile while the video panel is selected
      // must not leave a dead active key behind. Host `retainMainPanels` is the
      // primary mechanism (it reacts to the main-slot entries disappearing); this
      // cleanup only nudges the selection back when the host still reports video.
      ctx.effect(
        function leaveVideoOnUnload() {
          return function cleanupSelection() {
            try {
              const panelInfo = ctx.layout && ctx.layout.panelInfo;
              if (!panelInfo || typeof panelInfo.getSnapshot !== 'function') return;
              const snapshot = panelInfo.getSnapshot();
              if (snapshot && snapshot.activePanelId === PANEL_ID) ctx.layout.selectPanel(null);
            } catch (error) {
              reportOnce('unload-return-failed', error);
            }
          };
        },
        'dsh-video: leave video on unload'
      );

      // Locale-aware sidebar label. The host re-reads this thunk on every
      // projection (and after locale changes); the exact user-requested spelling
      // is also the fallback if the locale service is unavailable.
      let boundText = null;
      function sidebarLabel() {
        try {
          if (boundText === null && ctx.locale && typeof ctx.locale.bind === 'function') {
            boundText = ctx.locale.bind(NS);
          }
          if (typeof boundText === 'function') {
            const text = boundText('nav.label');
            if (typeof text === 'string' && text !== '' && text !== 'nav.label') return text;
          }
        } catch (error) {
          reportOnce('sidebar-label-failed', error);
        }
        return 'Vedio Editor';
      }

      function navigation() {
        return {
          onBack: function onBack() {
            setNavigationError(null);
            try {
              if (typeof ctx.layout.selectPanel !== 'function') {
                throw new Error('layout.selectPanel is unavailable');
              }
              ctx.layout.selectPanel(null);
            } catch (error) {
              setNavigationError('back');
              reportOnce('navigation-failed', error);
            }
          },
        };
      }

      // Ask the host to leave our panel when its entry disappears mid-selection.
      function settleSelection() {
        try {
          const panelInfo = ctx.layout && ctx.layout.panelInfo;
          if (!panelInfo || typeof panelInfo.getSnapshot !== 'function') return;
          const snapshot = panelInfo.getSnapshot();
          if (snapshot && snapshot.activePanelId === PANEL_ID) ctx.layout.selectPanel(null);
        } catch (error) {
          reportOnce('fallback-return-failed', error);
        }
      }

      // 1. One `main` declaration lifetime owns a chain. Inside that chain each
      //    `sidebar.panellist` declaration lifetime re-acquires one atomic pair:
      //    the video panel is registered first, then the sidebar row. A refused
      //    or failed entry disposes the panel synchronously; a lost leading or
      //    sidebar declaration releases both. A later declaration retries, so no
      //    reachable row ever points at a missing main panel.
      let mainController = null;

      function registerPanelAndEntry() {
        const initialMainOccupants = findOccupants(ctx, 'main', 'key', PANEL_ID);
        if (initialMainOccupants === null) {
          reportIssue('main-entries-unavailable');
          return function noopDispose() {};
        }
        if (initialMainOccupants.length > 0) {
          reportIssue('main-key-conflict:' + String(initialMainOccupants.length));
          return function noopDispose() {};
        }

        let closed = false;
        let sidebarRegistered = false;
        let sidebarController = null;
        let cycle = null;

        function releaseCycle(target) {
          if (target === null || target.disposed === true) return;
          target.disposed = true;
          if (cycle === target) cycle = null;
          sidebarRegistered = false;
          // Drop the navigation row first: the video panel must never be left
          // registered without its reachable entry, and the row must never stay
          // clickable after its panel is gone.
          try {
            if (target.sidebarDispose !== null) {
              const dispose = target.sidebarDispose;
              target.sidebarDispose = null;
              dispose();
            }
          } catch (error) {
            reportOnce('sidebar-cleanup-failed', error);
          }
          try {
            if (target.mainDispose !== null) {
              const dispose = target.mainDispose;
              target.mainDispose = null;
              dispose();
            }
          } catch (error) {
            reportOnce('main-cleanup-failed', error);
          }
          settleSelection();
        }

        function acquirePair() {
          if (closed) return function noopDispose() {};
          if (cycle !== null) releaseCycle(cycle);

          const sidebarEntries = findOccupants(ctx, 'sidebar.panellist', null, null);
          if (sidebarEntries === null) {
            reportIssue('sidebar-entries-unavailable');
            reportIssue('sidebar-entry-unavailable');
            return function noopDispose() {};
          }
          const ourSidebarEntries = sidebarEntries.filter(function ours(entry) {
            return entry !== null && typeof entry === 'object' && entry.options && entry.options.id === PANEL_ID;
          });
          if (ourSidebarEntries.length > 0) {
            reportIssue('sidebar-entry-conflict:' + String(ourSidebarEntries.length));
            reportIssue('sidebar-entry-unavailable');
            return function noopDispose() {};
          }
          // Re-check the main key right before committing the pair: a competitor
          // may have registered while declarations were being processed.
          const mainOccupants = findOccupants(ctx, 'main', 'key', PANEL_ID);
          if (mainOccupants === null) {
            reportIssue('main-entries-unavailable');
            return function noopDispose() {};
          }
          if (mainOccupants.length > 0) {
            reportIssue('main-key-conflict:' + String(mainOccupants.length));
            return function noopDispose() {};
          }

          let mainDispose = null;
          let sidebarDispose = null;
          try {
            mainDispose = ctx.slots.register(
              { name: 'main', key: PANEL_ID, locale: NS, inject: navigation },
              VideoWorkspace
            );
          } catch (error) {
            reportIssue('main-register-failed', error);
            return function noopDispose() {};
          }
          try {
            sidebarDispose = ctx.slots.register(
              { name: 'sidebar.panellist', id: PANEL_ID, order: SIDEBAR_ORDER, label: sidebarLabel, locale: NS },
              SidebarVideoIcon
            );
          } catch (error) {
            reportIssue('sidebar-register-failed', error);
            reportIssue('sidebar-entry-unavailable');
            try {
              mainDispose();
            } catch (cleanupError) {
              reportOnce('main-cleanup-failed', cleanupError);
            }
            return function noopDispose() {};
          }

          sidebarRegistered = true;
          const acquired = {
            disposed: false,
            mainDispose: mainDispose,
            sidebarDispose: sidebarDispose,
            inner: null,
          };
          acquired.inner = function releaseSidebarDeclaration() {
            releaseCycle(acquired);
          };
          cycle = acquired;
          return acquired.inner;
        }

        function closeChain() {
          if (closed) return;
          closed = true;
          try {
            if (sidebarController !== null) {
              const dispose = sidebarController;
              sidebarController = null;
              dispose();
            }
          } catch (error) {
            reportOnce('sidebar-cleanup-failed', error);
          }
          releaseCycle(cycle);
        }

        try {
          sidebarController = ctx.slots.inject('sidebar.panellist', acquirePair);
        } catch (error) {
          reportIssue('sidebar-inject-failed', error);
          closeChain();
          return function noopDispose() {};
        }

        if (isSlotDeclared(ctx, 'sidebar.panellist') !== false && sidebarRegistered !== true && cycle === null) {
          // The seat exists but our pair was refused. No video panel was
          // registered in this order, so there is nothing left to retract; a
          // later sidebar declaration retries the acquisition.
          reportIssue('sidebar-entry-unavailable');
        }

        return closeChain;
      }

      try {
        mainController = ctx.slots.inject('main', registerPanelAndEntry);
      } catch (error) {
        reportIssue('main-inject-failed', error);
        return;
      }
    }

    return { inject: inject, apply: apply };
    //#endregion
  },
});
