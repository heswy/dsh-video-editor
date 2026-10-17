/**
 * dsh-video — Client half.
 *
 * Hand-written DSH client bundle (no bundler, no JSX, no npm dependencies).
 * It contributes exactly three things:
 *
 *   1. a glass mode capsule (`普通 | 视频`) into the host's resident conversation
 *      header (`conversation.header.leading`, additive single seat);
 *   2. a global main panel under the `dsh-video` key, registered in the host
 *      `main` keyed slot and selected only through `ctx.layout.selectPanel`;
 *   3. an honest empty video workspace with the same capsule in its own top bar,
 *      a working return path, and a real "simplified UI effects" preference.
 *
 * Boundaries (P0-B):
 *   - the selected mode is read from the host (`usePanelInfo.activePanelId`), never
 *     duplicated in plugin state;
 *   - no overlay, no host-header replacement, no DOM geometry reads, no sidebar
 *     entry, no Remote, no session events, no project/media persistence;
 *   - every registration is owned by the caller fiber through `ctx.slots.inject`
 *     / `ctx.effect`, so disabling the plugin removes it and the host's
 *     `retainMainPanels` mechanism can return the UI to the conversation;
 *   - if the leading seat or the main key is already occupied, the plugin refuses
 *     to mount (diagnostic error) instead of shadowing another occupant.
 *
 * Optional browser persistence is limited to the simplified-effects preference,
 * versioned and corruption-safe. Project content is not stored here.
 */
window.__ModuleLoader__.load({
  id: 'dsh-video',
  factory(require) {
    'use strict';

    //#region constants
    const React = require('react');
    const h = React.createElement;

    /** Main-panel key, Loader row id and Client module id are all equal. */
    const PANEL_ID = 'dsh-video';
    /** Locale namespace registered for this plugin's UI text. */
    const NS = 'dshVideo';
    /** Browser preference key (version lives in the key and in the payload). */
    const PREFS_KEY = 'dsh-video.ui.v1';
    const PREFS_VERSION = 1;
    //#endregion

    //#region locale dictionaries
    const ZH = {
      'mode.label': '模式切换',
      'mode.normal': '普通',
      'mode.video': '视频',
      'video.brand': 'DSH Video',
      'video.empty.badge': '空工作区',
      'video.empty.title': '从一个想法，开始一支影片。',
      'video.empty.body':
        '视频工作区已经接入 DSH。当前阶段只验证模式切换、主题与状态保持；工程创建、预览、时间线与导出会在后续阶段加入。',
      'video.empty.note': '现在没有可打开的工程，也没有可预览的媒体，所以这里保持安静。',
      'video.empty.pending': '工程创建将在后续阶段开放',
      'video.empty.back': '返回普通模式',
      'video.simplify.label': '简化界面效果',
      'video.simplify.hint': '关闭玻璃模糊并缩短过渡',
      'video.stage.label': '视频工作区',
      'video.status.left': 'DSH Video · 原生工作区',
      'video.status.right': '尚未包含工程、预览与导出',
    };

    const EN = {
      'mode.label': 'Mode',
      'mode.normal': 'Normal',
      'mode.video': 'Video',
      'video.brand': 'DSH Video',
      'video.empty.badge': 'Empty workspace',
      'video.empty.title': 'Start a film from a single idea.',
      'video.empty.body':
        'The video workspace is wired into DSH. This phase only verifies the mode switch, theming, and state retention; project creation, preview, timeline, and export arrive in later phases.',
      'video.empty.note': 'There is no project to open and no media to preview yet, so this space stays quiet.',
      'video.empty.pending': 'Project creation opens in a later phase',
      'video.empty.back': 'Back to normal',
      'video.simplify.label': 'Reduce UI effects',
      'video.simplify.hint': 'Turn off glass blur and shorten transitions',
      'video.stage.label': 'Video workspace',
      'video.status.left': 'DSH Video · native workspace',
      'video.status.right': 'No project, preview, or export yet',
    };
    //#endregion

    //#region styles
    // Only inspected theme tokens (--dsw-alias-*) are used for colors, mixed with
    // color-mix/opacity. Host-published vars --dsh-frame-leading-clearance and
    // --dsh-content-font-size are used for window-chrome avoidance and font scale.
    const CSS = `
.dv-mode-wrap{
  display:inline-flex;
  align-items:center;
  flex:none;
  min-width:0;
  -webkit-app-region:no-drag;
  margin-inline-start:max(0px, calc(var(--dsh-frame-leading-clearance, 0px) - 20px));
}
.dv-mode{
  /* The capsule scales with the host content font size instead of pinning a
     pixel font: text and the space it needs grow together. Width/height stay
     within sane bounds; narrow windows collapse secondary chrome instead of
     shrinking this primary navigation text. */
  --dv-mode-width:clamp(176px, 13.5em, 248px);
  --dv-mode-height:clamp(40px, 2.86em, 56px);
  --dv-dur-thumb:220ms;
  --dv-dur-fast:140ms;
  --dv-dur-med:180ms;
  --dv-dur-slow:260ms;
  --dv-ease:cubic-bezier(.2,.8,.2,1);
  position:relative;
  display:inline-grid;
  grid-template-columns:1fr 1fr;
  align-items:stretch;
  box-sizing:border-box;
  flex:none;
  width:var(--dv-mode-width);
  height:var(--dv-mode-height);
  padding:4px;
  border-radius:999px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2, rgba(127,127,140,.45)) 62%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-bg-overlay, #26262b) 74%, transparent);
  -webkit-backdrop-filter:blur(18px) saturate(1.25);
  backdrop-filter:blur(18px) saturate(1.25);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.09), 0 8px 24px -14px rgba(0,0,0,.42);
  isolation:isolate;
  font-family:inherit;
  font-size:var(--dsh-content-font-size, 14px);
  user-select:none;
  -webkit-user-select:none;
  -webkit-app-region:no-drag;
}
.dv-mode-thumb{
  position:absolute;
  top:4px;
  bottom:4px;
  left:4px;
  width:calc(50% - 4px);
  border-radius:999px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2, rgba(127,127,140,.45)) 52%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-2, #303036) 94%, transparent);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.10), 0 2px 10px -4px rgba(0,0,0,.38);
  transform:translate3d(0,0,0);
  transition:transform var(--dv-dur-thumb) var(--dv-ease);
  pointer-events:none;
  z-index:0;
}
.dv-mode[data-thumb="video"] .dv-mode-thumb{transform:translate3d(100%,0,0);}
.dv-mode[data-ready="false"] .dv-mode-thumb{transition:none;}
.dv-mode-btn{
  -webkit-appearance:none;
  appearance:none;
  position:relative;
  z-index:1;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  height:100%;
  margin:0;
  padding:0;
  border:0;
  border-radius:999px;
  background:transparent;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font:inherit;
  font-size:.93em;
  font-weight:500;
  letter-spacing:.01em;
  line-height:1;
  white-space:nowrap;
  cursor:pointer;
  transition:color var(--dv-dur-fast) var(--dv-ease), transform var(--dv-dur-fast) var(--dv-ease);
  -webkit-app-region:no-drag;
}
.dv-mode-btn::after{content:"";position:absolute;inset:-7px 0;border-radius:inherit;}
.dv-mode-btn:hover{color:var(--dsw-alias-label-primary, #f2f2f5);}
.dv-mode-btn:active{transform:scale(.97);}
.dv-mode[data-active="normal"] .dv-mode-btn[data-mode="normal"],
.dv-mode[data-active="video"] .dv-mode-btn[data-mode="video"]{color:var(--dsw-alias-label-primary, #f2f2f5);}
.dv-mode-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #5b8cff);outline-offset:2px;}
.dv-mode[data-simplified="true"]{--dv-dur-thumb:0ms;--dv-dur-fast:0ms;--dv-dur-med:0ms;--dv-dur-slow:0ms;}
.dv-mode[data-simplified="true"]{
  -webkit-backdrop-filter:none;
  backdrop-filter:none;
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-2, #303036) 96%, var(--dsw-alias-bg-base, #1a1a1c));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.06), 0 2px 8px -6px rgba(0,0,0,.35);
}

.dv-root{
  --dv-dur-fast:120ms;
  --dv-dur-med:180ms;
  --dv-dur-slow:260ms;
  --dv-ease:cubic-bezier(.2,.8,.2,1);
  box-sizing:border-box;
  position:relative;
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
}
.dv-root *,.dv-root *::before,.dv-root *::after{box-sizing:border-box;}
.dv-root[data-simplified="true"]{--dv-dur-fast:0ms;--dv-dur-med:0ms;--dv-dur-slow:0ms;}

.dv-topbar{
  display:flex;
  align-items:center;
  gap:12px;
  flex:none;
  height:clamp(52px, 3.72em, 72px);
  padding-inline-start:max(20px, var(--dsh-frame-leading-clearance, 0px));
  padding-inline-end:16px;
  border-bottom:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 62%, transparent);
  background:linear-gradient(to bottom, color-mix(in srgb, var(--dsw-alias-bg-base, #1a1a1c) 55%, transparent), transparent);
}
.dv-brand{
  display:inline-flex;
  align-items:center;
  gap:8px;
  flex:none;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font-size:.76em;
  font-weight:500;
  letter-spacing:.1em;
  text-transform:uppercase;
  white-space:nowrap;
}
.dv-brand-dot{
  width:6px;
  height:6px;
  border-radius:50%;
  flex:none;
  background:var(--dsw-alias-brand-primary, #5b8cff);
  box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #5b8cff) 16%, transparent);
}
.dv-spacer{flex:1;min-width:0;}

.dv-simplify{
  display:inline-flex;
  align-items:center;
  gap:8px;
  flex:none;
  height:clamp(34px, 2.4em, 48px);
  padding:0 12px;
  border-radius:999px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2, rgba(127,127,140,.45)) 55%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-bg-overlay, #26262b) 66%, transparent);
  -webkit-backdrop-filter:blur(16px) saturate(1.2);
  backdrop-filter:blur(16px) saturate(1.2);
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font:inherit;
  font-size:.82em;
  line-height:1;
  cursor:pointer;
  transition:color var(--dv-dur-fast) var(--dv-ease), background var(--dv-dur-fast) var(--dv-ease);
  -webkit-app-region:no-drag;
}
.dv-simplify:hover{color:var(--dsw-alias-label-primary, #f2f2f5);}
.dv-simplify:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #5b8cff);outline-offset:2px;}
.dv-simplify-track{
  position:relative;
  flex:none;
  width:26px;
  height:16px;
  border-radius:999px;
  background:color-mix(in srgb, var(--dsw-alias-state-idle-primary, #7a7a83) 62%, transparent);
  transition:background var(--dv-dur-fast) var(--dv-ease);
}
.dv-simplify-knob{
  position:absolute;
  top:2px;
  left:2px;
  width:12px;
  height:12px;
  border-radius:50%;
  background:var(--dsw-alias-bg-layer-1, #f4f4f6);
  box-shadow:0 1px 2px rgba(0,0,0,.28);
  transition:transform var(--dv-dur-fast) var(--dv-ease);
}
.dv-simplify[aria-checked="true"] .dv-simplify-track{background:color-mix(in srgb, var(--dsw-alias-brand-primary, #5b8cff) 72%, transparent);}
.dv-simplify[aria-checked="true"] .dv-simplify-knob{transform:translate3d(10px,0,0);}
.dv-root[data-simplified="true"] .dv-simplify,
.dv-root[data-simplified="true"] .dv-button-primary{
  -webkit-backdrop-filter:none;
  backdrop-filter:none;
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f4f4f6) 12%, var(--dsw-alias-bg-base, #1a1a1c));
}

.dv-main{
  display:flex;
  flex:1;
  min-height:0;
  min-width:0;
  padding:16px;
  gap:12px;
}
.dv-stage{
  position:relative;
  display:flex;
  align-items:center;
  justify-content:center;
  flex:1;
  min-width:0;
  min-height:0;
  padding:24px;
  padding:clamp(24px, 5cqi, 56px);
  border-radius:18px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 88%, transparent);
  background:
    radial-gradient(120% 92% at 50% 0%, color-mix(in srgb, var(--dsw-alias-brand-primary, #5b8cff) 7%, transparent), transparent 62%),
    linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-layer-1, #f4f4f6) 8%, transparent), transparent 58%),
    var(--dsw-alias-bg-layer-1, #232327);
  overflow:auto;
  overscroll-behavior:contain;
}
.dv-stage::after{
  content:"";
  position:absolute;
  inset:0;
  border-radius:inherit;
  pointer-events:none;
  background:radial-gradient(90% 60% at 50% 118%, color-mix(in srgb, var(--dsw-alias-label-primary, #f2f2f5) 5%, transparent), transparent 70%);
}
.dv-empty{
  position:relative;
  z-index:1;
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:12px;
  width:min(100%, 560px);
  text-align:center;
}
.dv-empty-badge{
  display:inline-flex;
  align-items:center;
  gap:8px;
  padding:4px 8px;
  border-radius:999px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2, rgba(127,127,140,.45)) 48%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-bg-layer-2, #303036) 46%, transparent);
  color:var(--dsw-alias-label-secondary, #a4a4ad);
  font-size:.78em;
  font-weight:500;
  letter-spacing:.06em;
  text-transform:uppercase;
}
.dv-empty-badge::before{
  content:"";
  width:5px;
  height:5px;
  border-radius:50%;
  background:var(--dsw-alias-brand-primary, #5b8cff);
  opacity:.85;
}
.dv-empty-title{
  margin:4px 0 0;
  font-size:1.85em;
  font-size:clamp(1.5em, 3.6cqi, 1.95em);
  font-weight:500;
  line-height:1.28;
  letter-spacing:-.01em;
  color:var(--dsw-alias-label-primary, #f2f2f5);
}
.dv-empty-body{
  margin:0;
  max-width:46ch;
  font-size:1em;
  line-height:1.6;
  color:var(--dsw-alias-label-secondary, #a4a4ad);
}
.dv-empty-note{
  margin:0;
  max-width:44ch;
  font-size:.86em;
  line-height:1.55;
  color:color-mix(in srgb, var(--dsw-alias-label-secondary, #a4a4ad) 82%, transparent);
}
.dv-empty-actions{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  justify-content:center;
  gap:8px 12px;
  margin-top:4px;
}
.dv-button-primary{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  height:clamp(38px, 2.7em, 52px);
  padding:0 18px;
  border-radius:999px;
  border:1px solid color-mix(in srgb, var(--dsw-alias-border-l2, rgba(127,127,140,.45)) 58%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-bg-overlay, #26262b) 82%, transparent);
  -webkit-backdrop-filter:blur(16px) saturate(1.2);
  backdrop-filter:blur(16px) saturate(1.2);
  color:var(--dsw-alias-label-primary, #f2f2f5);
  font:inherit;
  font-size:.92em;
  font-weight:500;
  line-height:1;
  cursor:pointer;
  transition:transform var(--dv-dur-fast) var(--dv-ease), background var(--dv-dur-fast) var(--dv-ease);
  -webkit-app-region:no-drag;
}
.dv-button-primary:hover{background:color-mix(in srgb, var(--dsw-alias-bg-layer-2, #303036) 92%, transparent);}
.dv-button-primary:active{transform:scale(.985);}
.dv-button-primary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #5b8cff);outline-offset:2px;}
.dv-pending{
  display:inline-flex;
  align-items:center;
  gap:8px;
  color:color-mix(in srgb, var(--dsw-alias-label-secondary, #a4a4ad) 88%, transparent);
  font-size:.82em;
}
.dv-pending::before{
  content:"";
  width:5px;
  height:5px;
  border-radius:50%;
  background:var(--dsw-alias-state-idle-primary, #7a7a83);
}

.dv-statusbar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  flex:none;
  height:clamp(34px, 2.4em, 48px);
  padding-inline:16px;
  border-top:1px solid color-mix(in srgb, var(--dsw-alias-border-l1, rgba(127,127,140,.28)) 52%, transparent);
  color:color-mix(in srgb, var(--dsw-alias-label-secondary, #a4a4ad) 78%, transparent);
  font-size:.78em;
  letter-spacing:.02em;
  white-space:nowrap;
  overflow:hidden;
}
.dv-statusbar > span{overflow:hidden;text-overflow:ellipsis;}

@keyframes dv-fade-in{from{opacity:0}to{opacity:1}}
@keyframes dv-rise{from{opacity:0;transform:translate3d(0,6px,0)}to{opacity:1;transform:none}}
.dv-root[data-intro="first"] .dv-stage{animation:dv-rise var(--dv-dur-slow) var(--dv-ease) both;}
.dv-root[data-intro="first"] .dv-empty{animation:dv-rise var(--dv-dur-slow) 60ms var(--dv-ease) both;}
.dv-root[data-intro="repeat"] .dv-stage,
.dv-root[data-intro="repeat"] .dv-empty{animation:dv-fade-in var(--dv-dur-med) var(--dv-ease) both;}

@container dsh-video (max-width: 760px){
  .dv-topbar{height:48px;gap:10px;}
  .dv-brand{display:none;}
  .dv-main{padding:12px;}
  .dv-stage{padding:20px;border-radius:14px;}
  .dv-empty{gap:12px;}
  .dv-statusbar{font-size:.74em;}
}
@container dsh-video (max-width: 520px){
  .dv-simplify-label{display:none;}
  .dv-simplify{width:34px;padding:0;justify-content:center;}
  .dv-statusbar > span:last-child{display:none;}
}

@media (prefers-reduced-motion: reduce){
  .dv-root .dv-stage,
  .dv-root .dv-empty,
  .dv-mode-thumb,
  .dv-mode-btn,
  .dv-simplify,
  .dv-simplify-track,
  .dv-simplify-knob,
  .dv-button-primary{animation:none !important;transition-duration:1ms !important;}
}
@media (prefers-reduced-transparency: reduce){
  .dv-mode,.dv-simplify,.dv-button-primary{
    -webkit-backdrop-filter:none;
    backdrop-filter:none;
  }
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))){
  .dv-mode,.dv-simplify,.dv-button-primary{
    -webkit-backdrop-filter:none;
    backdrop-filter:none;
    background:color-mix(in srgb, var(--dsw-alias-bg-layer-2, #303036) 96%, var(--dsw-alias-bg-base, #1a1a1c));
  }
}
`;

    /** One style element per mounted plugin surface; unmounting removes it. */
    function StyleTag() {
      return h('style', {
        'data-dsh-video': 'styles',
        dangerouslySetInnerHTML: { __html: CSS },
      });
    }
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

    /**
     * Plugin-scope store shared by both mount points; survives panel unmounts.
     * `thumbOrigin` is a short-lived presentation hint only: navigation records
     * which segment the user is leaving, the next mount consumes it for the
     * slide-in and clears it. The authoritative selected mode always comes from
     * the host active panel.
     */
    let uiStore = null;

    function getStore() {
      if (uiStore === null) {
        uiStore = createUiStore(
          { simplifiedEffects: false, introPlayed: false, thumbOrigin: null },
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

    function markIntroPlayed() {
      const store = getStore();
      if (store.getSnapshot().introPlayed === true) return;
      store.setPatch({ introPlayed: true });
    }

    /** One animation frame, with a cancellable disposer; timer fallback. */
    function nextFrame(callback) {
      if (typeof requestAnimationFrame === 'function') {
        const frame = requestAnimationFrame(callback);
        return function cancelFrame() {
          if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
        };
      }
      const timer = setTimeout(callback, 0);
      return function cancelTimer() {
        clearTimeout(timer);
      };
    }

    /** Simplified effects or the host reduced-motion preference disable the slide. */
    function motionAllowed() {
      try {
        if (getStore().getSnapshot().simplifiedEffects === true) return false;
        if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
          const query = window.matchMedia('(prefers-reduced-motion: reduce)');
          if (query && query.matches === true) return false;
        }
      } catch (_error) {
        return true;
      }
      return true;
    }
    //#endregion

    //#region host helpers
    /** Feature-detected slot enumeration, used only for conflict diagnostics. */
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
     * entry (single slots); otherwise the entry's options[field] must equal value.
     * Returns null when the runtime cannot answer.
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

    //#region components
    /**
     * The single mode capsule shared by the conversation header seat and the
     * video top bar. The active segment comes from the host's active main panel.
     */
    function ModeSwitch(props) {
      const t = props.t;
      const usePanelInfo = props.usePanelInfo;
      const onSelectMode = props.onSelectMode;
      const ui = usePluginState();
      const activePanelId = usePanelInfo(function selectActive(info) {
        return info.activePanelId;
      });
      // Authoritative selection always comes from the host. `thumbOrigin` only
      // decides where the glass thumb visually starts on this mount; it can never
      // make a segment look selected on its own.
      const active = activePanelId === PANEL_ID ? 'video' : 'normal';
      const [initialThumb] = React.useState(function readThumbOrigin() {
        const origin = getStore().getSnapshot().thumbOrigin;
        return origin === 'normal' || origin === 'video' ? origin : null;
      });
      const [thumbAt, setThumbAt] = React.useState(
        initialThumb === null || initialThumb === active ? active : initialThumb
      );
      const [ready, setReady] = React.useState(false);

      React.useEffect(function startThumbTransition() {
        const store = getStore();
        // A hint belongs to exactly one mount; clear it even when it is stale.
        if (store.getSnapshot().thumbOrigin !== null) store.setPatch({ thumbOrigin: null });
        if (initialThumb === null || initialThumb === active) {
          setReady(true);
          return function noopTransition() {};
        }
        let cancelMove = null;
        const cancelEnable = nextFrame(function enableTransition() {
          setReady(true);
          cancelMove = nextFrame(function moveThumb() {
            setThumbAt(active);
          });
        });
        return function cancelThumbTransition() {
          cancelEnable();
          if (cancelMove !== null) cancelMove();
        };
      }, []);

      function activate(mode) {
        if (mode === active) return;
        onSelectMode(mode);
      }

      function onKeyDown(event) {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          activate('normal');
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          activate('video');
        }
      }

      return h(
        'div',
        {
          className: 'dv-mode',
          role: 'group',
          'aria-label': t('mode.label'),
          'data-active': active,
          'data-thumb': thumbAt,
          'data-ready': ready ? 'true' : 'false',
          'data-simplified': ui.simplifiedEffects ? 'true' : 'false',
          onKeyDown: onKeyDown,
        },
        h(StyleTag, { key: 'style' }),
        h('span', { className: 'dv-mode-thumb', 'aria-hidden': true, key: 'thumb' }),
        h(
          'button',
          {
            type: 'button',
            key: 'normal',
            className: 'dv-mode-btn',
            'data-mode': 'normal',
            'aria-pressed': active === 'normal' ? 'true' : 'false',
            onClick: function onClickNormal() {
              activate('normal');
            },
          },
          t('mode.normal')
        ),
        h(
          'button',
          {
            type: 'button',
            key: 'video',
            className: 'dv-mode-btn',
            'data-mode': 'video',
            'aria-pressed': active === 'video' ? 'true' : 'false',
            onClick: function onClickVideo() {
              activate('video');
            },
          },
          t('mode.video')
        )
      );
    }

    /** Additive occupant of `conversation.header.leading` (root slot, single). */
    function LeadingModeSwitch(props) {
      const t = props.t;
      const usePanelInfo = props.usePanelInfo;
      const onSelectMode = props.onSelectMode;
      return h(
        'div',
        { className: 'dv-mode-wrap' },
        h(ModeSwitch, { t: t, usePanelInfo: usePanelInfo, onSelectMode: onSelectMode })
      );
    }

    function SimplifiedToggle(props) {
      const t = props.t;
      const value = props.value === true;
      return h(
        'button',
        {
          type: 'button',
          className: 'dv-simplify',
          role: 'switch',
          'aria-checked': value ? 'true' : 'false',
          'aria-label': t('video.simplify.label'),
          title: t('video.simplify.hint'),
          onClick: function onClickToggle() {
            setSimplifiedEffects(!value);
          },
        },
        h('span', { className: 'dv-simplify-track', 'aria-hidden': true, key: 'track' }, h('span', { className: 'dv-simplify-knob' })),
        h('span', { className: 'dv-simplify-label', key: 'label' }, t('video.simplify.label'))
      );
    }

    function EmptyWorkspace(props) {
      const t = props.t;
      return h(
        'div',
        { className: 'dv-empty' },
        h('span', { className: 'dv-empty-badge' }, t('video.empty.badge')),
        h('h1', { className: 'dv-empty-title' }, t('video.empty.title')),
        h('p', { className: 'dv-empty-body' }, t('video.empty.body')),
        h('p', { className: 'dv-empty-note' }, t('video.empty.note')),
        h(
          'div',
          { className: 'dv-empty-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'dv-button-primary',
              onClick: function onBack() {
                props.onSelectMode('normal');
              },
            },
            t('video.empty.back')
          ),
          h('span', { className: 'dv-pending' }, t('video.empty.pending'))
        )
      );
    }

    /** Occupant of the `dsh-video` key in the host `main` slot. */
    function VideoWorkspace(props) {
      const t = props.t;
      const usePanelInfo = props.usePanelInfo;
      const onSelectMode = props.onSelectMode;
      const ui = usePluginState();
      const [playIntro] = React.useState(function readInitialIntro() {
        return getStore().getSnapshot().introPlayed !== true;
      });

      React.useEffect(function recordIntro() {
        markIntroPlayed();
      }, []);

      return h(
        'div',
        {
          className: 'dv-root',
          'data-simplified': ui.simplifiedEffects ? 'true' : 'false',
          'data-intro': playIntro ? 'first' : 'repeat',
        },
        h(
          'header',
          { className: 'dv-topbar', 'data-window-drag': true, key: 'topbar' },
          h(ModeSwitch, { t: t, usePanelInfo: usePanelInfo, onSelectMode: onSelectMode }),
          h('span', { className: 'dv-brand', key: 'brand' }, h('span', { className: 'dv-brand-dot' }), t('video.brand')),
          h('span', { className: 'dv-spacer', key: 'spacer' }),
          h(SimplifiedToggle, { t: t, value: ui.simplifiedEffects, key: 'simplify' })
        ),
        h(
          'main',
          { className: 'dv-main', key: 'main' },
          h(
            'section',
            { className: 'dv-stage', 'aria-label': t('video.stage.label') },
            h(EmptyWorkspace, { t: t, onSelectMode: onSelectMode })
          )
        ),
        h(
          'footer',
          { className: 'dv-statusbar', key: 'statusbar' },
          h('span', null, t('video.status.left')),
          h('span', null, t('video.status.right'))
        )
      );
    }
    //#endregion

    //#region plugin
    const inject = ['slots', 'layout', 'locale'];

    function apply(ctx) {
      reportIssue = makeReporter(ctx);
      reportedCodes.clear();
      uiStore = createUiStore(
        Object.assign({ introPlayed: false, thumbOrigin: null }, readPrefs()),
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

      function navigation() {
        return {
          onSelectMode: function onSelectMode(mode) {
            const nextPanel = mode === 'video' ? PANEL_ID : null;
            const leavingMode = mode === 'video' ? 'normal' : 'video';
            try {
              if (typeof ctx.layout.selectPanel !== 'function') {
                throw new Error('layout.selectPanel is unavailable');
              }
              // Presentation hint only; navigation itself never waits for motion.
              if (motionAllowed()) getStore().setPatch({ thumbOrigin: leavingMode });
              ctx.layout.selectPanel(nextPanel);
            } catch (error) {
              getStore().setPatch({ thumbOrigin: null });
              reportOnce('navigation-failed:' + String(mode), error);
            }
          },
        };
      }

      let mainController = null;

      function disposeMainController() {
        try {
          if (mainController !== null) {
            const dispose = mainController;
            mainController = null;
            dispose();
          }
        } catch (error) {
          reportOnce('main-cleanup-failed', error);
        }
      }

      // 3. Bind both mount points to the main panel's declaration lifetime. Real
      //    slots.inject waits (it does not throw) while a slot is undeclared, so
      //    the normal-mode entry may only exist while a registered video main panel
      //    does. Every (re)declaration re-checks live occupants before registering.
      function registerMainAndEntry() {
        const mainOccupants = findOccupants(ctx, 'main', 'key', PANEL_ID);
        if (mainOccupants === null) {
          reportIssue('main-entries-unavailable');
          return function noopDispose() {};
        }
        if (mainOccupants.length > 0) {
          reportIssue('main-key-conflict:' + String(mainOccupants.length));
          return function noopDispose() {};
        }
        let mainEntryDispose = null;
        try {
          mainEntryDispose = ctx.slots.register(
            { name: 'main', key: PANEL_ID, locale: NS, inject: navigation },
            VideoWorkspace
          );
        } catch (error) {
          reportIssue('main-register-failed', error);
          return function noopDispose() {};
        }

        let leadingController = null;
        let leadingRegistered = false;
        let disposed = false;
        function disposeEntry() {
          if (disposed) return;
          disposed = true;
          try {
            if (leadingController !== null) {
              const dispose = leadingController;
              leadingController = null;
              dispose();
            }
          } catch (error) {
            reportOnce('leading-cleanup-failed', error);
          }
          try {
            if (mainEntryDispose !== null) {
              const dispose = mainEntryDispose;
              mainEntryDispose = null;
              dispose();
            }
          } catch (error) {
            reportOnce('main-cleanup-failed', error);
          }
        }

        function registerLeadingSwitch() {
          const leadingOccupants = findOccupants(ctx, 'conversation.header.leading', null, null);
          if (leadingOccupants === null) {
            reportIssue('leading-entries-unavailable');
            return function noopDispose() {};
          }
          if (leadingOccupants.length > 0) {
            reportIssue('leading-seat-conflict:' + String(leadingOccupants.length));
            return function noopDispose() {};
          }
          try {
            const dispose = ctx.slots.register(
              { name: 'conversation.header.leading', locale: NS, inject: navigation },
              LeadingModeSwitch
            );
            leadingRegistered = true;
            return dispose;
          } catch (error) {
            reportIssue('leading-register-failed', error);
            return function noopDispose() {};
          }
        }

        try {
          leadingController = ctx.slots.inject('conversation.header.leading', registerLeadingSwitch);
        } catch (error) {
          reportIssue('leading-inject-failed', error);
          disposeEntry();
          return function noopDispose() {};
        }

        if (isSlotDeclared(ctx, 'conversation.header.leading') !== false && leadingRegistered !== true) {
          // The seat is currently declared but our entry could not be registered.
          // Never expose the video panel without its normal-mode entry.
          reportIssue('leading-entry-unavailable');
          disposeEntry();
          return function noopDispose() {};
        }

        return disposeEntry;
      }

      try {
        mainController = ctx.slots.inject('main', registerMainAndEntry);
      } catch (error) {
        reportIssue('main-inject-failed', error);
        return;
      }

      if (isSlotDeclared(ctx, 'main') !== false) {
        const liveMain = findOccupants(ctx, 'main', 'key', PANEL_ID);
        if (liveMain !== null && liveMain.length === 0) {
          reportIssue('main-registration-missing');
          disposeMainController();
        }
      }
    }

    return { inject: inject, apply: apply };
    //#endregion
  },
});
