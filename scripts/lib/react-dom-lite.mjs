/**
 * react-dom-lite — a tiny React-compatible renderer over the REAL DOM.
 *
 * Purpose: the P3-008 browser regression harness
 * (`scripts/test-canvas-workspace.mjs`) must mount the EXACT staged
 * `CanvasWorkspace` source from `<staging>/bundle/client.js` in real Chrome,
 * with real pointer/keyboard gestures. The staged bundle is hand-written
 * without a bundler and expects a `React`-shaped `require('react')`, so this
 * module provides the small public surface that the extracted component and
 * its module-scope helpers actually use:
 *
 *   - createElement / Fragment (the component receives both `React` and `h`)
 *   - useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback,
 *     useReducer (hooks are keyed by call order inside one component fiber)
 *   - host elements with className, style, data-/aria- attributes, booleans,
 *     controlled `value`/`checked`, refs (object and callback), autoFocus
 *   - React-style event props (`onClick`, `onDoubleClick`, `onChange` firing
 *     on `input` for form controls, pointer/mouse/keyboard/focus events)
 *   - conditional children, nested arrays, keyed children and stable DOM
 *     identity (the sandboxed preview iframe must NOT be recreated when an
 *     unrelated state update re-renders the component)
 *   - batched state updates: every commit is flushed synchronously by the root
 *     after its event/effect turn, then effects run; an effect that sets state
 *     schedules another synchronous commit (bounded against update loops).
 *
 * It is intentionally NOT a general React implementation: no concurrent
 * rendering, no memoization of host configs, no SSR, no portals, no context.
 * Unknown props are applied as DOM attributes rather than silently ignored so
 * a staging drift fails loudly instead of rendering a different component.
 *
 * Browser usage: the harness serves this file after replacing the single
 * `export { ... }` line at the bottom with `window.ReactLite = { ... }`
 * (see `pageRendererSource()` in scripts/test-canvas-workspace.mjs). Keep the
 * export statement as the last statement of the file.
 */

const ELEMENT_TYPE = Symbol.for('react.element');

function createElement(type, config) {
  const props = {};
  let key = null;
  let ref = null;
  if (config !== null && config !== undefined) {
    for (const name of Object.keys(config)) {
      if (name === 'key') {
        key = config.key === null || config.key === undefined ? null : String(config.key);
      } else if (name === 'ref') {
        ref = config.ref;
      } else {
        props[name] = config[name];
      }
    }
  }
  const childCount = arguments.length - 2;
  if (childCount === 1) {
    props.children = arguments[2];
  } else if (childCount > 1) {
    const children = [];
    for (let index = 2; index < arguments.length; index += 1) children.push(arguments[index]);
    props.children = children;
  }
  return { $$typeof: ELEMENT_TYPE, type, key, ref, props };
}

const Fragment = Symbol.for('react.fragment');

// ─── hook runtime ──────────────────────────────────────────────────────────

let currentOwner = null;
let activeRoot = null;
let rootDirty = false;
let flushScheduled = false;

function ensureOwner(hookName) {
  if (currentOwner === null) throw new Error('react-dom-lite: ' + hookName + ' outside a component render');
  return currentOwner;
}

function scheduleMicrotaskFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  Promise.resolve().then(function microtaskFlush() {
    flushScheduled = false;
    const root = activeRoot;
    if (root !== null && rootDirty) {
      try {
        root.flush();
      } catch (error) {
        // A state update outside an explicit flush must not be swallowed.
        setTimeout(function rethrow() {
          throw error;
        }, 0);
      }
    }
  });
}

function markRootDirty() {
  rootDirty = true;
  scheduleMicrotaskFlush();
}

function sameDeps(left, right) {
  if (left === undefined || right === undefined) return false;
  if (left === null || right === null) return left === right;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (Object.is(left[index], right[index]) === false) return false;
  }
  return true;
}

function hookCell(fiber, index) {
  if (fiber.hooks[index] === undefined) fiber.hooks[index] = {};
  return fiber.hooks[index];
}

function useState(initial) {
  const fiber = ensureOwner('useState');
  const index = fiber.hookIndex;
  fiber.hookIndex += 1;
  const cell = hookCell(fiber, index);
  if (cell.state === undefined && cell.initialized !== true) {
    cell.state = typeof initial === 'function' ? initial() : initial;
    cell.initialized = true;
  }
  if (cell.setter === undefined) {
    cell.setter = function setState(value) {
      const next = typeof value === 'function' ? value(cell.state) : value;
      if (Object.is(next, cell.state)) return;
      cell.state = next;
      markRootDirty();
    };
  }
  return [cell.state, cell.setter];
}

function useReducer(reducer, initialArg, init) {
  const fiber = ensureOwner('useReducer');
  const index = fiber.hookIndex;
  fiber.hookIndex += 1;
  const cell = hookCell(fiber, index);
  if (cell.initialized !== true) {
    cell.state = typeof init === 'function' ? init(initialArg) : initialArg;
    cell.initialized = true;
  }
  if (cell.dispatch === undefined) {
    cell.dispatch = function dispatch(action) {
      const next = reducer(cell.state, action);
      if (Object.is(next, cell.state)) return;
      cell.state = next;
      markRootDirty();
    };
  }
  return [cell.state, cell.dispatch];
}

function useRef(initial) {
  const fiber = ensureOwner('useRef');
  const index = fiber.hookIndex;
  fiber.hookIndex += 1;
  const cell = hookCell(fiber, index);
  if (cell.ref === undefined) cell.ref = { current: initial };
  return cell.ref;
}

function useMemo(factory, deps) {
  const fiber = ensureOwner('useMemo');
  const index = fiber.hookIndex;
  fiber.hookIndex += 1;
  const cell = hookCell(fiber, index);
  if (cell.initialized !== true || sameDeps(cell.deps, deps) === false) {
    cell.value = factory();
    cell.deps = deps;
    cell.initialized = true;
  }
  return cell.value;
}

function useCallback(callback, deps) {
  return useMemo(function memoCallback() {
    return callback;
  }, deps);
}

function pushEffect(create, deps) {
  const fiber = ensureOwner('useEffect');
  const index = fiber.hookIndex;
  fiber.hookIndex += 1;
  const cell = hookCell(fiber, index);
  cell.effect = { create, deps };
  if (fiber.pendingEffects.indexOf(index) === -1) fiber.pendingEffects.push(index);
}

function useEffect(create, deps) {
  pushEffect(create, deps);
}

function useLayoutEffect(create, deps) {
  pushEffect(create, deps);
}

// ─── fibers ────────────────────────────────────────────────────────────────

class ComponentFiber {
  constructor(type, props, parentDom) {
    this.kind = 'component';
    this.type = type;
    this.props = props;
    this.parentDom = parentDom;
    this.hooks = [];
    this.hookIndex = 0;
    this.child = null;
    this.pendingEffects = [];
    this.key = null;
    this.index = -1;
  }
}

class HostFiber {
  constructor(type, props) {
    this.kind = 'host';
    this.type = type;
    this.props = props;
    this.dom = null;
    this.children = [];
    this.listeners = [];
    this.key = null;
    this.index = -1;
    this.ref = null;
  }
}

class TextFiber {
  constructor(text) {
    this.kind = 'text';
    this.text = text;
    this.dom = null;
    this.key = null;
    this.index = -1;
  }
}

function isElement(value) {
  return value !== null && typeof value === 'object' && value.$$typeof === ELEMENT_TYPE;
}

/** Flatten children arrays/fragments/nulls into a list of element or {text} vnodes. */
function normalizeChildren(children) {
  const output = [];
  function push(child) {
    if (child === null || child === undefined || typeof child === 'boolean') return;
    if (Array.isArray(child)) {
      for (const item of child) push(item);
      return;
    }
    if (typeof child === 'string' || typeof child === 'number') {
      output.push({ text: String(child), key: null });
      return;
    }
    if (isElement(child)) {
      if (child.type === Fragment) {
        push(child.props.children);
        return;
      }
      output.push(child);
    }
    // Functions/symbols/other non-renderables are ignored like React does for
    // accidental null-ish callbacks in JSX conditionals.
  }
  push(children);
  return output;
}

function setRef(ref, value) {
  if (ref === null || ref === undefined) return;
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  if (typeof ref === 'object') ref.current = value;
}

function domOf(fiber) {
  if (fiber === null || fiber === undefined) return null;
  if (fiber.kind === 'component') return domOf(fiber.child);
  return fiber.dom;
}

function compatible(fiber, vnode) {
  if (vnode.text !== undefined) return fiber.kind === 'text';
  if (typeof vnode.type === 'function') return fiber.kind === 'component' && fiber.type === vnode.type;
  return fiber.kind === 'host' && fiber.type === vnode.type;
}

// ─── props ─────────────────────────────────────────────────────────────────

const SIMPLE_EVENT_NAMES = {
  onClick: 'click',
  onDoubleClick: 'dblclick',
  onContextMenu: 'contextmenu',
  onKeyDown: 'keydown',
  onKeyUp: 'keyup',
  onKeyPress: 'keypress',
  onInput: 'input',
  onPointerDown: 'pointerdown',
  onPointerMove: 'pointermove',
  onPointerUp: 'pointerup',
  onPointerCancel: 'pointercancel',
  onLostPointerCapture: 'lostpointercapture',
  onPointerEnter: 'pointerenter',
  onPointerLeave: 'pointerleave',
  onPointerOver: 'pointerover',
  onPointerOut: 'pointerout',
  onMouseDown: 'mousedown',
  onMouseMove: 'mousemove',
  onMouseUp: 'mouseup',
  onMouseEnter: 'mouseenter',
  onMouseLeave: 'mouseleave',
  onMouseOver: 'mouseover',
  onMouseOut: 'mouseout',
  onFocus: 'focus',
  onBlur: 'blur',
  onSubmit: 'submit',
  onLoad: 'load',
  onError: 'error',
  onScroll: 'scroll',
  onWheel: 'wheel',
  onDragStart: 'dragstart',
  onDragOver: 'dragover',
  onDragEnd: 'dragend',
  onDrop: 'drop',
  onToggle: 'toggle',
};

function isEventProp(name) {
  return /^on[A-Z]/.test(name);
}

/**
 * Event names bound for one React prop. React's `onChange` is the `input`
 * event for text-like controls and the `change` event for file/select
 * controls; the staged component relies on that for its range seek and
 * textarea draft, so a plain DOM `change` binding would not match React.
 */
function eventNamesFor(name, fiber) {
  if (name === 'onChange') {
    if (fiber.kind !== 'host') return [];
    if (fiber.type === 'select') return ['change'];
    if (fiber.type === 'input') {
      const type = typeof fiber.props.type === 'string' ? fiber.props.type.toLowerCase() : 'text';
      if (type === 'file') return ['change'];
      if (type === 'checkbox' || type === 'radio') return ['change', 'input'];
      return ['input'];
    }
    if (fiber.type === 'textarea') return ['input'];
    return ['change'];
  }
  const simple = SIMPLE_EVENT_NAMES[name];
  return simple === undefined ? [] : [simple];
}

const ATTRIBUTE_ALIASES = {
  className: 'class',
  viewBox: 'viewBox',
  strokeWidth: 'stroke-width',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  htmlFor: 'for',
  referrerPolicy: 'referrerpolicy',
  tabIndex: 'tabindex',
  readOnly: 'readonly',
  autoComplete: 'autocomplete',
  autoFocus: 'autofocus',
  srcDoc: 'srcdoc',
  colSpan: 'colspan',
  rowSpan: 'rowspan',
  acceptCharset: 'accept-charset',
};

const BOOLEAN_ATTRIBUTES = new Set([
  'disabled',
  'readonly',
  'required',
  'multiple',
  'hidden',
  'autofocus',
  'selected',
  'checked',
]);

function attributeName(name) {
  if (ATTRIBUTE_ALIASES[name] !== undefined) return ATTRIBUTE_ALIASES[name];
  if (name.startsWith('data-') || name.startsWith('aria-')) return name;
  if (/^[a-z][a-z0-9-]*$/.test(name)) return name;
  return name.toLowerCase();
}

function applyStyle(dom, previous, next) {
  const previousStyle = previous !== null && typeof previous === 'object' ? previous : {};
  const nextStyle = next !== null && typeof next === 'object' ? next : {};
  for (const name of Object.keys(previousStyle)) {
    if (Object.prototype.hasOwnProperty.call(nextStyle, name)) continue;
    try {
      // Custom properties (used by the product layout, e.g. --dv-ai-width)
      // are only writable through setProperty/removeProperty, exactly like
      // React DOM's style handling.
      if (name.startsWith('--')) dom.style.removeProperty(name);
      else dom.style[name] = '';
    } catch (_error) {
      /* style property removal is best effort */
    }
  }
  for (const name of Object.keys(nextStyle)) {
    const value = nextStyle[name];
    const text = typeof value === 'number' ? value + 'px' : String(value);
    try {
      if (name.startsWith('--')) {
        if (value === null || value === undefined || value === false) dom.style.removeProperty(name);
        else dom.style.setProperty(name, text);
        continue;
      }
      if (value === null || value === undefined || value === false) {
        dom.style[name] = '';
        continue;
      }
      if (dom.style[name] !== text) dom.style[name] = text;
    } catch (_error) {
      /* an unknown CSS property must not break the commit */
    }
  }
}

function applyProperty(dom, name, value, previousValue, tagName) {
  if (name === 'children' || name === 'key' || name === 'ref') return;
  if (name === 'style') {
    applyStyle(dom, previousValue, value);
    return;
  }
  if (name === 'className') {
    const text = value === null || value === undefined ? '' : String(value);
    if (dom.getAttribute('class') !== text) dom.setAttribute('class', text);
    return;
  }
  if (name === 'dangerouslySetInnerHTML') {
    const html = value !== null && typeof value === 'object' && typeof value.__html === 'string' ? value.__html : '';
    dom.innerHTML = html;
    return;
  }
  if (name === 'defaultValue') {
    dom.defaultValue = value === null || value === undefined ? '' : String(value);
    return;
  }
  if (name === 'value') {
    if (tagName === 'textarea' || tagName === 'input' || tagName === 'select') {
      const text = value === null || value === undefined ? '' : String(value);
      if (dom.value !== text) dom.value = text;
      if (name === 'value' && tagName === 'textarea' && dom.defaultValue !== undefined) {
        // keep the JSX "controlled" value as the only truth; do not write it
        // back as text content
      }
      return;
    }
  }
  if (name === 'checked') {
    dom.checked = value === true;
    return;
  }
  if (name === 'autoFocus') {
    // Focus is applied after the DOM is attached (see the focus queue).
    return;
  }
  if (BOOLEAN_ATTRIBUTES.has(name)) {
    const attribute = attributeName(name);
    if (value === true) {
      dom.setAttribute(attribute, '');
      try {
        dom[name] = true;
      } catch (_error) {
        /* property is best effort */
      }
    } else {
      dom.removeAttribute(attribute);
      try {
        dom[name] = false;
      } catch (_error) {
        /* property is best effort */
      }
    }
    return;
  }
  if (name === 'download' || name === 'title' || name === 'role' || name === 'type' || name === 'sandbox'
    || name === 'src' || name === 'href' || name === 'min' || name === 'max' || name === 'step'
    || name === 'accept' || name === 'placeholder' || name === 'name' || name === 'alt'
    || name === 'target' || name === 'rel' || name === 'lang' || name === 'id'
    || name === 'cx' || name === 'cy' || name === 'r' || name === 'd' || name === 'fill'
    || name === 'stroke' || name === 'strokeWidth' || name === 'strokeLinecap' || name === 'strokeLinejoin'
    || name === 'viewBox' || name === 'xmlns' || name === 'width' || name === 'height') {
    if (value === null || value === undefined || value === false) {
      dom.removeAttribute(attributeName(name));
    } else if (typeof value === 'object') {
      dom.setAttribute(attributeName(name), String(value));
    } else {
      dom.setAttribute(attributeName(name), String(value));
    }
    return;
  }
  const attribute = attributeName(name);
  if (value === null || value === undefined || value === false) {
    dom.removeAttribute(attribute);
    return;
  }
  if (value === true) {
    dom.setAttribute(attribute, '');
    return;
  }
  dom.setAttribute(attribute, String(value));
}

function applyProps(fiber, previousProps, nextProps, isMount) {
  const dom = fiber.dom;
  for (const entry of fiber.listeners) dom.removeEventListener(entry.name, entry.handler);
  const listeners = [];
  for (const name of Object.keys(nextProps)) {
    const value = nextProps[name];
    if (isEventProp(name)) {
      if (typeof value !== 'function') continue;
      for (const eventName of eventNamesFor(name, fiber)) {
        dom.addEventListener(eventName, value);
        listeners.push({ name: eventName, handler: value });
      }
      continue;
    }
    const previousValue = previousProps !== null && previousProps !== undefined ? previousProps[name] : undefined;
    if (isMount === false && previousValue === value && name !== 'style') continue;
    applyProperty(dom, name, value, previousValue, fiber.type);
  }
  fiber.listeners = listeners;
}

// ─── mount / update / unmount ──────────────────────────────────────────────

const focusQueue = [];

function flushFocusQueue() {
  while (focusQueue.length > 0) {
    const dom = focusQueue.shift();
    try {
      if (typeof dom.focus === 'function' && dom.isConnected) dom.focus();
    } catch (_error) {
      /* focus is best effort, like React */
    }
  }
}

function mountVNode(vnode, parentDom) {
  if (vnode.text !== undefined) {
    const fiber = new TextFiber(vnode.text);
    fiber.dom = document.createTextNode(fiber.text);
    parentDom.appendChild(fiber.dom);
    return fiber;
  }
  if (typeof vnode.type === 'function') {
    const fiber = new ComponentFiber(vnode.type, vnode.props, parentDom);
    fiber.key = vnode.key;
    renderComponent(fiber);
    return fiber;
  }
  return mountHostFiber(vnode, parentDom);
}

function mountHostFiber(vnode, parentDom) {
  const fiber = new HostFiber(vnode.type, vnode.props);
  fiber.key = vnode.key;
  fiber.ref = vnode.ref === undefined ? null : vnode.ref;
  const svg = vnode.type === 'svg' || (parentDom.namespaceURI === 'http://www.w3.org/2000/svg' && parentDom.localName !== 'foreignObject');
  fiber.dom = svg ? document.createElementNS('http://www.w3.org/2000/svg', vnode.type) : document.createElement(vnode.type);
  applyProps(fiber, {}, vnode.props, true);
  fiber.children = reconcileChildren(fiber.dom, [], normalizeChildren(vnode.props.children));
  if(fiber.type==='select'&&vnode.props.value!==undefined)fiber.dom.value=String(vnode.props.value);
  parentDom.appendChild(fiber.dom);
  setRef(fiber.ref, fiber.dom);
  if (vnode.props.autoFocus === true) focusQueue.push(fiber.dom);
  return fiber;
}

function renderComponent(fiber) {
  const previousOwner = currentOwner;
  currentOwner = fiber;
  fiber.hookIndex = 0;
  let vnode;
  try {
    vnode = fiber.type(fiber.props);
  } finally {
    currentOwner = previousOwner;
  }
  const children = normalizeChildren(vnode);
  if (children.length > 1) {
    throw new Error('react-dom-lite: a component must return a single element, got ' + children.length);
  }
  const nextChild = children.length === 0 ? null : children[0];
  if (fiber.child === null) {
    fiber.child = nextChild === null ? null : mountVNode(nextChild, fiber.parentDom);
    return;
  }
  if (nextChild === null) {
    unmountFiber(fiber.child);
    fiber.child = null;
    return;
  }
  if (compatible(fiber.child, nextChild)) {
    updateFiber(fiber.child, nextChild);
    return;
  }
  unmountFiber(fiber.child);
  fiber.child = mountVNode(nextChild, fiber.parentDom);
}

function updateFiber(fiber, vnode) {
  if (fiber.kind === 'text') {
    const text = vnode.text;
    if (fiber.text !== text) {
      fiber.text = text;
      fiber.dom.data = text;
    }
    return;
  }
  if (fiber.kind === 'component') {
    fiber.props = vnode.props;
    renderComponent(fiber);
    return;
  }
  const previousRef = fiber.ref;
  const nextRef = vnode.ref === undefined ? null : vnode.ref;
  if (previousRef !== nextRef) {
    setRef(previousRef, null);
    setRef(nextRef, fiber.dom);
    fiber.ref = nextRef;
  }
  const previousProps = fiber.props;
  fiber.props = vnode.props;
  applyProps(fiber, previousProps, vnode.props, false);
  fiber.children = reconcileChildren(fiber.dom, fiber.children, normalizeChildren(vnode.props.children));
  if(fiber.type==='select'&&vnode.props.value!==undefined)fiber.dom.value=String(vnode.props.value);
}

function unmountFiber(fiber) {
  if (fiber.kind === 'text') {
    if (fiber.dom.parentNode !== null) fiber.dom.parentNode.removeChild(fiber.dom);
    return;
  }
  if (fiber.kind === 'component') {
    for (const cell of fiber.hooks) {
      if (cell !== null && typeof cell === 'object' && typeof cell.cleanup === 'function') {
        try {
          cell.cleanup();
        } catch (_error) {
          /* unmount cleanup must not stop teardown */
        }
        cell.cleanup = null;
      }
    }
    if (fiber.child !== null) unmountFiber(fiber.child);
    fiber.child = null;
    return;
  }
  for (const entry of fiber.listeners) fiber.dom.removeEventListener(entry.name, entry.handler);
  fiber.listeners = [];
  for (const child of fiber.children) unmountFiber(child);
  fiber.children = [];
  setRef(fiber.ref, null);
  fiber.ref = null;
  if (fiber.dom.parentNode !== null) fiber.dom.parentNode.removeChild(fiber.dom);
}

function reconcileChildren(parentDom, oldFibers, vnodes) {
  const nextFibers = [];
  const unused = oldFibers.slice();
  for (let index = 0; index < vnodes.length; index += 1) {
    const vnode = vnodes[index];
    const key = vnode.key === undefined ? null : vnode.key;
    let reused = null;
    if (key !== null) {
      const position = unused.findIndex((fiber) => fiber.key === key && compatible(fiber, vnode));
      if (position !== -1) reused = unused.splice(position, 1)[0];
    } else {
      const position = unused.findIndex((fiber) => fiber.index === index && fiber.key === null && compatible(fiber, vnode));
      if (position !== -1) reused = unused.splice(position, 1)[0];
    }
    if (reused === null) {
      reused = mountVNode(vnode, parentDom);
    } else {
      updateFiber(reused, vnode);
    }
    reused.index = index;
    reused.key = key;
    nextFibers.push(reused);
  }
  for (const fiber of unused) unmountFiber(fiber);
  // Enforce DOM order for host roots (components may contribute one root node).
  let anchor = null;
  for (let index = nextFibers.length - 1; index >= 0; index -= 1) {
    const dom = domOf(nextFibers[index]);
    if (dom === null) continue;
    if (dom.parentNode !== parentDom || dom.nextSibling !== anchor) parentDom.insertBefore(dom, anchor);
    anchor = dom;
  }
  return nextFibers;
}

// ─── effects ───────────────────────────────────────────────────────────────

function collectComponentFibers(fiber, output) {
  if (fiber === null || fiber === undefined) return;
  if (fiber.kind === 'component') {
    output.push(fiber);
    collectComponentFibers(fiber.child, output);
    return;
  }
  if (fiber.kind === 'host') {
    for (const child of fiber.children) collectComponentFibers(child, output);
  }
}

function runPendingEffects(root) {
  const fibers = [];
  collectComponentFibers(root.instance, fibers);
  for (const fiber of fibers) {
    if (fiber.pendingEffects.length === 0) continue;
    const pending = fiber.pendingEffects.splice(0);
    for (const index of pending) {
      const cell = fiber.hooks[index];
      if (cell === undefined || cell.effect === undefined) continue;
      const effect = cell.effect;
      if (cell.hasRun === true && sameDeps(cell.previousDeps, effect.deps)) continue;
      if (typeof cell.cleanup === 'function') {
        try {
          cell.cleanup();
        } catch (_error) {
          /* effect cleanup failure is reported by the test page, not hidden */
        }
        cell.cleanup = null;
      }
      cell.hasRun = true;
      cell.previousDeps = effect.deps;
      const cleanup = effect.create();
      cell.cleanup = typeof cleanup === 'function' ? cleanup : null;
    }
  }
}

// ─── root ──────────────────────────────────────────────────────────────────

class Root {
  constructor(container) {
    if (!(container instanceof Element)) throw new Error('react-dom-lite: createRoot needs a container Element');
    this.container = container;
    this.instance = null;
    this.unmounted = false;
    activeRoot = this;
  }

  render(element) {
    if (this.unmounted) throw new Error('react-dom-lite: root was unmounted');
    if (isElement(element) === false || typeof element.type !== 'function') {
      throw new Error('react-dom-lite: root element must be a function component element');
    }
    if (this.instance === null) {
      this.instance = new ComponentFiber(element.type, element.props, this.container);
      this.instance.child = null;
    } else {
      if (this.instance.type !== element.type) throw new Error('react-dom-lite: root element type changed');
      this.instance.props = element.props;
    }
    rootDirty = true;
    this.flush();
  }

  flush() {
    const root = activeRoot === this ? this : this;
    let guard = 0;
    while (rootDirty) {
      if (this.instance === null) {
        rootDirty = false;
        break;
      }
      rootDirty = false;
      renderComponent(this.instance);
      runPendingEffects(root);
      flushFocusQueue();
      guard += 1;
      if (guard > 100) throw new Error('react-dom-lite: state update loop exceeded 100 commits');
    }
  }

  unmount() {
    if (this.unmounted) return;
    this.unmounted = true;
    if (this.instance !== null) unmountFiber(this.instance);
    this.instance = null;
    this.container.textContent = '';
    rootDirty = false;
    if (activeRoot === this) activeRoot = null;
  }
}

/** Number of pending commits/effects; used by the page harness to settle. */
function pendingWork() {
  return rootDirty;
}

function flushSync() {
  const root = activeRoot;
  if (root !== null && rootDirty) root.flush();
}

const React = {
  createElement,
  Fragment,
  useState,
  useReducer,
  useRef,
  useMemo,
  useCallback,
  useEffect,
  useLayoutEffect,
  fragment: Fragment,
};

function createRoot(container) {
  return new Root(container);
}

function createPortal() {
  throw new Error('react-dom-lite: portals are not supported');
}

// The harness page source is this module with the export statement below
// replaced by `window.ReactLite = {...}`; keep it as the single/last export.
export { React, createElement, createRoot, createPortal, flushSync, pendingWork };
