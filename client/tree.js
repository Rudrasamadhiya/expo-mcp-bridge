'use strict';
// Walks the live React fiber tree and turns it into a compact, token-cheap
// outline of what is on screen. Also resolves refs back to live fibers so the
// agent can act on them (tap, type, scroll).

const TEXT_NAMES = new Set(['Text', 'RCTText', 'RCTVirtualText', 'AnimatedText']);
const INPUT_NAMES = new Set(['TextInput', 'RCTSinglelineTextInputView', 'RCTMultilineTextInputView', 'AndroidTextInput']);
const SCROLL_NAMES = new Set(['ScrollView', 'FlatList', 'SectionList', 'VirtualizedList', 'FlashList', 'KeyboardAwareScrollView', 'AnimatedScrollView', 'AnimatedFlatList']);
const SWITCH_NAMES = new Set(['Switch', 'RCTSwitch', 'AndroidSwitch']);
const IMAGE_NAMES = new Set(['Image', 'ExpoImage', 'RCTImageView']);

const HOST_TEXT = 6;
const HOST_ROOT = 3;
const MAX_LABEL = 60;

function getName(fiber) {
  const t = fiber.type;
  if (!t) return '';
  if (typeof t === 'string') return t;
  if (t.displayName) return t.displayName;
  if (t.name) return t.name;
  if (t.render) return t.render.displayName || t.render.name || '';
  if (t.type) return t.type.displayName || t.type.name || '';
  return '';
}

function flattenStyle(style) {
  if (!style) return null;
  if (Array.isArray(style)) {
    let out = null;
    for (const s of style) {
      const f = flattenStyle(s);
      if (f) out = Object.assign(out || {}, f);
    }
    return out;
  }
  return typeof style === 'object' ? style : null;
}

function isHidden(props) {
  if (!props) return false;
  if (props.accessibilityElementsHidden === true) return true;
  if (props.importantForAccessibility === 'no-hide-descendants') return true;
  if (props['aria-hidden'] === true) return true;
  if (props.activityState === 0) return true; // inactive react-native-screens screen
  if (props.visible === false && props.animationType !== undefined) return true; // closed Modal
  const s = flattenStyle(props.style);
  if (s && (s.display === 'none' || s.opacity === 0)) return true;
  return false;
}

// Icon fonts (@expo/vector-icons etc.) render glyphs from the Unicode
// private-use areas; they are noise to an agent.
const GLYPHS = /[-]|[\uDB80-\uDBFF][\uDC00-\uDFFF]/g;
function stripGlyphs(s) {
  return s.replace(GLYPHS, '');
}

function collectText(fiber, limit = 200) {
  let out = '';
  const stack = [fiber.child];
  while (stack.length && out.length < limit) {
    const f = stack.pop();
    if (!f) continue;
    if (f.sibling) stack.push(f.sibling);
    if (isHidden(f.memoizedProps)) continue;
    if (f.tag === HOST_TEXT) {
      const s = stripGlyphs(String(f.memoizedProps ?? '')).trim();
      if (s) out += (out ? ' ' : '') + s;
    } else if (f.child) {
      stack.push(f.child);
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

function clip(s, n = MAX_LABEL) {
  if (s == null) return '';
  s = stripGlyphs(String(s)).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function a11yLabel(p) {
  return p.accessibilityLabel || p['aria-label'] || '';
}

// Icon-only buttons (back arrows, eye toggles) have no text; name them after
// the first icon inside, e.g. @expo/vector-icons <Ionicons name="arrow-back" />.
function iconName(fiber) {
  const stack = [fiber.child];
  while (stack.length) {
    const f = stack.pop();
    if (!f) continue;
    if (f.sibling) stack.push(f.sibling);
    const p = f.memoizedProps;
    if (p && typeof p === 'object' && typeof f.type !== 'string' && typeof p.name === 'string' && p.name &&
      (p.size !== undefined || p.color !== undefined || /icon/i.test(getName(f)))) return p.name;
    if (f.child) stack.push(f.child);
  }
  return '';
}

function isScrollable(fiber, name) {
  if (SCROLL_NAMES.has(name)) return true;
  const sn = fiber.stateNode;
  return !!(sn && typeof sn === 'object' && (typeof sn.scrollToOffset === 'function' || (typeof sn.scrollTo === 'function' && typeof sn.scrollToEnd === 'function')));
}

// Decide whether this fiber is worth showing to the agent.
function classify(fiber, name, p, ctx) {
  if (INPUT_NAMES.has(name) && (p.onChangeText || p.onChange || p.placeholder !== undefined || p.value !== undefined || p.defaultValue !== undefined)) {
    const node = { role: 'input', label: clip(a11yLabel(p) || p.placeholder || '') };
    const v = p.value ?? p.defaultValue;
    if (v !== undefined) node.value = p.secureTextEntry ? '•'.repeat(String(v).length) : clip(v, 80);
    if (p.secureTextEntry) node.flags = ['secure'];
    if (p.editable === false) (node.flags = node.flags || []).push('readonly');
    return node;
  }
  if (SWITCH_NAMES.has(name) && p.onValueChange) {
    return { role: 'switch', label: clip(a11yLabel(p)), value: String(!!p.value) };
  }
  const press = p.onPress || p.onLongPress;
  if (press && press !== ctx.press) {
    let label = a11yLabel(p) || p.title || collectText(fiber);
    if (!label) {
      const icon = iconName(fiber);
      if (icon) label = 'icon:' + icon;
    }
    const node = { role: 'button', label: clip(label) };
    if (p.disabled || p.accessibilityState?.disabled || p['aria-disabled']) node.flags = ['disabled'];
    if (p.accessibilityState?.selected || p['aria-selected']) (node.flags = node.flags || []).push('selected');
    if (p.accessibilityState?.checked != null) node.value = String(p.accessibilityState.checked);
    return node;
  }
  if (TEXT_NAMES.has(name)) {
    if (ctx.inButton) return { role: 'skip-text' };
    const t = collectText(fiber, 300);
    return t ? { role: 'text', label: clip(t, 120), noRef: true } : { role: 'skip-text' };
  }
  if (isScrollable(fiber, name)) {
    if (ctx.freshScroll) return null; // wrapper chain like FlatList > VirtualizedList > ScrollView
    return { role: 'scroll', label: clip(a11yLabel(p)), flags: p.horizontal ? ['horizontal'] : undefined };
  }
  if (IMAGE_NAMES.has(name) && (a11yLabel(p) || p.testID) && !ctx.inButton) {
    return { role: 'image', label: clip(a11yLabel(p)), noRef: !p.testID };
  }
  if (p.testID && p.testID !== ctx.testID && typeof fiber.type !== 'string') {
    return { role: 'view', label: clip(a11yLabel(p)), noRef: true };
  }
  return null;
}

function findRootFiber(anyFiber) {
  let f = anyFiber;
  while (f && f.return) f = f.return;
  if (f && f.tag === HOST_ROOT && f.stateNode && f.stateNode.current) return f.stateNode.current;
  return f;
}

// Native stacks (react-native-screens) keep every pushed screen mounted; only
// the top one is visible. Walking the rest wastes tokens and confuses agents.
const STACK_NAMES = new Set(['RNSScreenStack', 'ScreenStack', 'NativeScreenStack']);

function lastChild(fiber) {
  let last = null;
  for (let f = fiber.child; f; f = f.sibling) last = f;
  return last;
}

/**
 * Native view of the visible screen in the outermost native stack, for
 * screenshots. Capturing the whole window on Android can replay a stale
 * drawing of the stack, so we capture the top screen's own view instead.
 */
function topScreenView(rootFiber) {
  const stack = [rootFiber.child];
  let stackFiber = null;
  while (stack.length && !stackFiber) {
    const f = stack.pop();
    if (!f) continue;
    if (typeof f.type === 'string' && STACK_NAMES.has(f.type)) { stackFiber = f; break; }
    if (f.sibling) stack.push(f.sibling);
    if (f.child) stack.push(f.child);
  }
  if (!stackFiber) return null;
  const top = lastChild(stackFiber);
  // first host view inside the top screen (RNSScreen on device)
  const inner = [top];
  while (inner.length) {
    const f = inner.pop();
    if (!f) continue;
    if (typeof f.type === 'string' && f.stateNode) {
      const sn = f.stateNode;
      const tag = (sn.canonical && sn.canonical.nativeTag) || sn._nativeTag;
      return tag != null ? tag : (sn.canonical && sn.canonical.publicInstance) || sn;
    }
    if (f !== top && f.sibling) inner.push(f.sibling);
    if (f.child) inner.push(f.child);
  }
  return null;
}

/** First host (native view) fiber at or below `fiber`. */
function hostFiber(fiber) {
  const stack = [fiber];
  while (stack.length) {
    const f = stack.pop();
    if (!f) continue;
    if (typeof f.type === 'string' && f.stateNode) return f;
    if (f !== fiber && f.sibling) stack.push(f.sibling);
    if (f.child) stack.push(f.child);
  }
  return null;
}

function publicInstance(host) {
  const sn = host.stateNode;
  return (sn.canonical && sn.canonical.publicInstance) || sn;
}

/** Native handle usable by react-native-view-shot's captureRef. */
function nativeHandle(host) {
  const sn = host.stateNode;
  const tag = (sn.canonical && sn.canonical.nativeTag) || sn._nativeTag;
  return tag != null ? tag : publicInstance(host);
}

/** Window rect {x, y, w, h} (dp) of an element, or null when it can't be measured. */
function measure(fiber, timeout = 400) {
  const host = hostFiber(fiber);
  if (!host) return Promise.resolve(null);
  const testRect = host.memoizedProps && host.memoizedProps.__testRect; // used by the test suite
  if (testRect) return Promise.resolve(testRect);
  const inst = publicInstance(host);
  if (!inst || typeof inst.measureInWindow !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeout);
    try {
      inst.measureInWindow((x, y, w, h) => { clearTimeout(t); resolve(w || h ? { x, y, w, h } : null); });
    } catch (e) { clearTimeout(t); resolve(null); }
  });
}

/** Native scroll view and its content container for a scroll node. */
function scrollHosts(fiber) {
  const view = hostFiber(fiber);
  if (!view) return null;
  let content = view.child;
  while (content && typeof content.type !== 'string') content = content.child;
  return { view, content };
}

/**
 * Content view of a visible React Native <Modal>. Modals render in their own
 * native window, so screen captures miss them; this lets the recorder capture
 * the modal separately and overlay it.
 */
function visibleModalView(rootFiber) {
  const stack = [rootFiber.child];
  while (stack.length) {
    const f = stack.pop();
    if (!f) continue;
    if (f.sibling) stack.push(f.sibling);
    const p = f.memoizedProps;
    if (getName(f) === 'Modal' && typeof f.type !== 'string' && p && p.visible !== false) {
      const modalHost = hostFiber(f);             // RCTModalHostView (placeholder in the main window)
      let content = modalHost && modalHost.child;  // root of the modal's own window
      while (content && typeof content.type !== 'string') content = content.child;
      if (content && content.stateNode) return nativeHandle(content);
    }
    if (f.child) stack.push(f.child);
  }
  return null;
}

/** Stable ref allocator: the same element keeps the same ref across snapshots. */
function createRefs() {
  return { map: new Map(), next: 0 };
}

/**
 * Build a snapshot of the current UI.
 * Returns { text, nodes } where nodes maps ref -> { fiber, key, role }.
 * Pass opts.refs (from createRefs) to keep refs stable between snapshots.
 */
function snapshot(rootFiber, opts = {}) {
  const lines = [];
  const nodes = new Map();
  const keyCount = new Map();
  const refs = opts.refs || createRefs();
  if (refs.map.size > 3000) { refs.map.clear(); }
  const maxLines = opts.maxLines || 400;

  function walk(fiber, depth, ctx) {
    for (let f = fiber; f; f = f.sibling) {
      if (lines.length >= maxLines) return;
      const p = f.memoizedProps;
      if (p && typeof p === 'object') {
        if (isHidden(p)) continue;
      }
      if (f.tag === HOST_TEXT) {
        if (!ctx.inButton && !ctx.inText) {
          const s = clip(f.memoizedProps, 120);
          if (s) {
            lines.push('  '.repeat(depth) + 'text "' + s + '"');
            if (opts.collect && f.return) opts.collect.push({ fiber: f.return, role: 'text', label: s, style: flattenStyle(f.return.memoizedProps && f.return.memoizedProps.style) });
          }
        }
        continue;
      }
      const name = getName(f);
      if (STACK_NAMES.has(name) && typeof f.type === 'string') {
        const top = lastChild(f);
        if (top) walk(top, depth, ctx);
        continue;
      }
      const props = p && typeof p === 'object' ? p : {};
      const node = classify(f, name, props, ctx);
      if (node && node.role === 'skip-text') continue;
      if (node) {
        let line = '  '.repeat(depth) + node.role;
        if (node.label) line += ' "' + node.label.replace(/"/g, "'") + '"';
        if (node.value !== undefined) line += ' value="' + String(node.value).replace(/"/g, "'") + '"';
        if (node.flags && node.flags.length) line += ' (' + node.flags.join(',') + ')';
        if (props.testID) line += ' #' + props.testID;
        let ref = null;
        if (!node.noRef) {
          const base = node.role + '|' + (props.testID || '') + '|' + (node.label || '');
          const n = (keyCount.get(base) || 0) + 1;
          keyCount.set(base, n);
          const key = base + '#' + n;
          ref = refs.map.get(key);
          if (!ref) { ref = 'e' + ++refs.next; refs.map.set(key, ref); }
          nodes.set(ref, { fiber: f, key, role: node.role });
          line += ' [' + ref + ']';
        }
        lines.push(line);
        if (opts.collect) opts.collect.push({ fiber: f, role: node.role, label: node.label || '', ref, style: flattenStyle(props.style) });
        if (node.role === 'text' || node.role === 'input' || node.role === 'switch') continue;
        walk(f.child, depth + 1, {
          press: node.role === 'button' ? props.onPress || props.onLongPress : ctx.press,
          inButton: ctx.inButton || node.role === 'button',
          testID: props.testID || ctx.testID,
          freshScroll: node.role === 'scroll',
        });
      } else {
        const next = ctx.freshScroll || ctx.testID !== (props.testID || ctx.testID)
          ? Object.assign({}, ctx, { testID: props.testID || ctx.testID })
          : ctx;
        walk(f.child, depth, next);
      }
    }
  }

  walk(rootFiber.child, 0, {});
  if (lines.length >= maxLines) lines.push('… (truncated, ' + maxLines + ' lines max)');
  return { text: lines.join('\n') || '(empty screen)', nodes };
}

/** Re-resolve a target against the *current* tree so handlers are never stale. */
function resolve(rootFiber, target, refs) {
  const fresh = snapshot(rootFiber, { maxLines: 5000, refs });
  if (target.ref) {
    const n = fresh.nodes.get(target.ref);
    if (n) return n;
    throw new Error('ref ' + target.ref + ' is not on screen anymore; take a new snapshot');
  }
  const wantRole = target.role;
  for (const n of fresh.nodes.values()) {
    if (wantRole && n.role !== wantRole) continue;
    const p = n.fiber.memoizedProps || {};
    if (target.testID && p.testID === target.testID) return n;
  }
  if (target.text) {
    const needle = String(target.text).toLowerCase();
    let partial = null;
    for (const n of fresh.nodes.values()) {
      if (wantRole && n.role !== wantRole) continue;
      const label = n.key.split('|')[2].replace(/#\d+$/, '').toLowerCase();
      const p = n.fiber.memoizedProps || {};
      const ph = String(p.placeholder || '').toLowerCase();
      if (label === needle || ph === needle) return n;
      if (!partial && (label.includes(needle) || ph.includes(needle))) partial = n;
    }
    if (partial) return partial;
  }
  throw new Error('no ' + (wantRole || 'element') + ' matching ' + JSON.stringify(target) + '; take a new snapshot');
}

function findHostInstance(fiber, test) {
  const stack = [fiber];
  while (stack.length) {
    const f = stack.pop();
    if (!f) continue;
    const sn = f.stateNode;
    if (sn && typeof sn === 'object' && test(sn)) return sn;
    if (f.sibling && f !== fiber) stack.push(f.sibling);
    if (f.child) stack.push(f.child);
  }
  return null;
}

/** First scroll container on screen (used when the agent does not name one). */
function firstScroll(rootFiber, refs) {
  const s = snapshot(rootFiber, { maxLines: 5000, refs });
  for (const n of s.nodes.values()) if (n.role === 'scroll' && !(n.fiber.memoizedProps || {}).horizontal) return n;
  for (const n of s.nodes.values()) if (n.role === 'scroll') return n;
  return null;
}

/**
 * Line diff between two snapshots (LCS). Returns null when the change is so
 * large that sending the full screen is cheaper or clearer.
 */
function diff(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > 400000) return null;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const out = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) { i++; j++; }
    else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) out.push('+ ' + b[j++]);
    else out.push('- ' + a[i++]);
  }
  if (!out.length) return '';
  // An element that only changed state (same ref) is sent once as "~ new line".
  const refOf = (l) => (/ \[(e\d+)\]$/.exec(l) || [])[1];
  const added = new Set(out.filter((l) => l[0] === '+').map(refOf).filter(Boolean));
  const changed = new Set(out.filter((l) => l[0] === '-' && added.has(refOf(l))).map(refOf));
  const compact = out
    .filter((l) => !(l[0] === '-' && changed.has(refOf(l))))
    .map((l) => (l[0] === '+' && changed.has(refOf(l)) ? '~' + l.slice(1) : l));
  return compact.length > b.length * 0.6 ? null : compact.join('\n');
}

module.exports = { snapshot, resolve, createRefs, diff, topScreenView, visibleModalView, measure, hostFiber, nativeHandle, scrollHosts, flattenStyle, findRootFiber, findHostInstance, firstScroll, getName, collectText };
