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
 *     replacement, no Remote, no session events, no project/media persistence;
 *   - the main panel and the sidebar entry are one atomic pair: the panel is
 *     registered first, the entry only after it; any failure, conflict or loss
 *     releases both, and a later declaration retries. The panel can never stay
 *     registered without a reachable navigation entry;
 *   - every registration is owned by the caller fiber through `ctx.slots.inject`
 *     / `ctx.effect`, so disabling the plugin removes it and the host's
 *     `retainMainPanels` mechanism can return the UI to the conversation.
 *
 * Optional browser persistence is limited to the reduced-effects preference,
 * versioned and corruption-safe. Project content is not stored here.
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
      'video.display.label': '显示选项',
      'video.display.simplified': '简化界面效果',
      'video.error.back': '返回对话失败，请重试。',
    };

    const EN = {
      'nav.label': 'Vedio Editor',
      'video.back': 'Back to conversation',
      'video.empty': 'No project yet',
      'video.display.label': 'Display options',
      'video.display.simplified': 'Reduce UI effects',
      'video.error.back': 'Could not return to the conversation. Try again.',
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
  align-items:center;
  justify-content:center;
  gap:12px;
  min-width:0;
  min-height:0;
  padding:24px;
  overflow:auto;
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
@media (prefers-reduced-motion: reduce){
  .dv-root{animation:none;}
}
@container dsh-video (max-width: 520px){
  .dv-topbar{padding-left:12px;padding-right:12px;}
  .dv-back{padding:0 8px;}
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

    //#region components
    function StyleTag() {
      return h('style', {
        'data-dsh-video': 'styles',
        dangerouslySetInnerHTML: { __html: CSS },
      });
    }

    /**
     * Occupant of the `dsh-video` key in the host `main` slot. The host owns
     * navigation selection; this panel only renders the restrained empty state,
     * one lightweight return action and one accessible display-options menu.
     */
    function VideoWorkspace(props) {
      const t = props.t;
      const onBack = props.onBack;
      const ui = usePluginState();
      const [menuOpen, setMenuOpen] = React.useState(false);

      function onKeyDown(event) {
        if (event && event.key === 'Escape' && menuOpen) {
          event.preventDefault();
          setMenuOpen(false);
        }
      }

      function onToggleMenu() {
        setMenuOpen(!menuOpen);
      }

      function onToggleSimplified() {
        setSimplifiedEffects(!ui.simplifiedEffects);
      }

      return h(
        'div',
        {
          className: 'dv-root',
          'data-simplified': ui.simplifiedEffects ? 'true' : 'false',
          'data-panel': PANEL_ID,
          onKeyDown: onKeyDown,
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
                className: 'dv-icon-button',
                'aria-haspopup': 'menu',
                'aria-expanded': menuOpen ? 'true' : 'false',
                'aria-controls': 'dsh-video-display-menu',
                'aria-label': t('video.display.label'),
                title: t('video.display.label'),
                onClick: onToggleMenu,
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
                  },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dv-menu-item',
                      role: 'menuitemcheckbox',
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
        h(
          'main',
          { className: 'dv-main', key: 'main' },
          ui.navigationError === null
            ? null
            : h('p', { className: 'dv-error', role: 'alert', key: 'error' }, t('video.error.back')),
          h('p', { className: 'dv-empty', key: 'empty' }, t('video.empty'))
        )
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
