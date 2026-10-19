'use strict';
// In-app side of expo-mcp-bridge. Mount <AgentBridge /> once near the root of
// your app; in development it dials the MCP server on your computer and lets
// the AI agent see and drive the app. In production it renders children only.

const React = require('react');
const RN = require('react-native');
const tree = require('./tree');
const capture = require('./capture');

const DEV = typeof __DEV__ === 'undefined' ? true : __DEV__;
const DEFAULT_PORT = 8347;
const VERSION = require('../package.json').version;

if (DEV) capture.install();

// Optional peers. The try/catch must wrap require() directly so Metro treats
// them as optional dependencies instead of failing the bundle.
let Constants = null;
let ViewShot = null;
try { Constants = require('expo-constants').default; } catch (e) {}
try { ViewShot = require('react-native-view-shot'); } catch (e) {}

function detectHost() {
  const C = Constants;
  const hostUri = C && ((C.expoConfig && C.expoConfig.hostUri) || (C.expoGoConfig && C.expoGoConfig.debuggerHost) || (C.manifest && C.manifest.debuggerHost));
  if (hostUri) return String(hostUri).split(':')[0];
  const SC = RN.NativeModules && RN.NativeModules.SourceCode;
  const url = SC && ((SC.getConstants && SC.getConstants().scriptURL) || SC.scriptURL);
  const m = /^\w+:\/\/([^:/?]+)/.exec(url || '');
  if (m) return m[1];
  return RN.Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function settle(ms) {
  return new Promise((resolve) => {
    RN.InteractionManager.runAfterInteractions(() => setTimeout(resolve, ms));
  });
}

function safeStringify(value, limit = 4000) {
  const seen = new WeakSet();
  let s;
  try {
    s = JSON.stringify(value, (k, v) => {
      if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
      if (typeof v === 'bigint') return String(v);
      if (v && typeof v === 'object') {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
        if (v.$$typeof || v.stateNode !== undefined) return '[React internal]';
      }
      return v;
    });
  } catch (e) {
    s = String(value);
  }
  if (s === undefined) s = String(value);
  return s.length > limit ? s.slice(0, limit) + '…' : s;
}

const fakeEvent = (extra) => Object.assign({ nativeEvent: {}, persist() {}, preventDefault() {}, stopPropagation() {} }, extra);

class AgentBridge extends React.Component {
  constructor(props) {
    super(props);
    this.ws = null;
    this.closed = false;
    this.retry = 0;
    this.refRegistry = tree.createRefs();
    this.lastSnapshotText = null; // what the agent last saw; diffs are relative to it
    this.scrollOffsets = new Map();
  }

  componentDidMount() {
    if (!DEV || this.props.enabled === false) return;
    this.connect();
  }

  componentWillUnmount() {
    this.closed = true;
    clearTimeout(this.timer);
    if (this.ws) this.ws.close();
  }

  render() {
    return this.props.children === undefined ? null : this.props.children;
  }

  root() {
    const me = this._reactInternals || this._reactInternalFiber;
    if (!me) throw new Error('bridge not mounted');
    return tree.findRootFiber(me);
  }

  connect() {
    if (this.closed) return;
    const host = this.props.host || detectHost();
    const port = this.props.port || DEFAULT_PORT;
    const ws = new WebSocket('ws://' + host + ':' + port);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ type: 'hello', info: this.info() }));
    };
    ws.onmessage = (e) => this.onMessage(e.data);
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws !== ws || this.closed) return;
      this.ws = null;
      const delay = Math.min(500 * 2 ** this.retry++, 2000);
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }

  info() {
    const win = RN.Dimensions.get('window');
    const C = Constants || {};
    const cfg = C.expoConfig || {};
    return {
      bridge: VERSION,
      app: cfg.name || 'unknown',
      slug: cfg.slug,
      sdk: cfg.sdkVersion,
      platform: RN.Platform.OS,
      osVersion: String(RN.Platform.Version),
      device: C.deviceName,
      window: Math.round(win.width) + 'x' + Math.round(win.height),
      scale: win.scale,
      expoGo: C.executionEnvironment === 'storeClient',
    };
  }

  async onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || !msg.id) return;
    let reply;
    try {
      const fn = this['cmd_' + msg.cmd];
      if (!fn) throw new Error('unknown command ' + msg.cmd);
      reply = { id: msg.id, ok: true, result: await fn.call(this, msg.args || {}) };
    } catch (err) {
      reply = { id: msg.id, ok: false, error: (err && err.message) || String(err) };
    }
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(reply));
  }

  // ---- helpers -----------------------------------------------------------

  snapText(maxLines) {
    return tree.snapshot(this.root(), { maxLines, refs: this.refRegistry }).text;
  }

  takeSnapshot(maxLines) {
    const text = this.snapText(maxLines);
    const unchanged = text === this.lastSnapshotText;
    this.lastSnapshotText = text;
    return { text, unchanged };
  }

  /** Screen as the agent should receive it after an action: unchanged, a diff, or full. */
  screenUpdate(args) {
    const text = this.snapText(args.maxLines);
    const before = this.lastSnapshotText;
    this.lastSnapshotText = text;
    if (text === before) return { unchanged: true };
    if (before != null && !args.full) {
      const d = tree.diff(before, text);
      if (d) return { diff: d };
    }
    return { text };
  }

  /** Wait until the UI stops changing (min ~120ms, at most maxMs). */
  async settleStable(maxMs) {
    const t0 = Date.now();
    await settle(0);
    let prev = null;
    while (true) {
      await wait(100);
      let cur;
      try { cur = this.snapText(5000); } catch (e) { cur = null; }
      const elapsed = Date.now() - t0;
      if ((cur === prev && elapsed >= 120) || elapsed >= maxMs) return elapsed;
      prev = cur;
    }
  }

  async afterAction(args, startSeq, extra) {
    await this.settleStable(args.settleMs == null ? 1500 : args.settleMs);
    const out = Object.assign({}, extra);
    if (args.snapshot !== false) out.snapshot = this.screenUpdate(args);
    const errors = capture.getLogs({ level: 'error', since: startSeq, limit: 5 });
    if (errors.length) out.errors = errors.map((l) => l.msg.slice(0, 500));
    const failed = capture.getRequests({ since: startSeq, failedOnly: true, limit: 5 });
    if (failed.length) out.failedRequests = failed.map((r) => r.method + ' ' + r.url + ' -> ' + (r.error || r.status));
    return out;
  }

  target(args) {
    if (!args.ref && !args.testID && !args.text) throw new Error('give ref, testID or text');
    return { ref: args.ref, testID: args.testID, text: args.text, role: args.role };
  }

  // ---- commands ----------------------------------------------------------

  cmd_ping() {
    return { pong: true, info: this.info() };
  }

  cmd_snapshot(args) {
    return this.takeSnapshot(args.maxLines);
  }

  async cmd_screenshot(args) {
    if (!ViewShot || !ViewShot.captureScreen) {
      throw new Error('react-native-view-shot is not installed. Run: npx expo install react-native-view-shot');
    }
    const win = RN.Dimensions.get('window');
    const maxW = args.maxWidth || 400;
    const w = Math.min(maxW, Math.round(win.width * (win.scale || 1))); // up to the device's real pixels
    const h = Math.round((win.height / win.width) * w);
    const opts = { format: 'jpg', quality: args.quality || 0.6, result: 'base64', width: w, height: h };
    // Prefer the visible screen's own view: whole-window capture can return a
    // stale frame on Android native stacks. Fall back to the window.
    let data = null;
    let area = 'window';
    if (args.area !== 'window' && ViewShot.captureRef) {
      const view = tree.topScreenView(this.root());
      if (view != null) {
        try { data = await ViewShot.captureRef(view, opts); area = 'screen'; } catch (e) { data = null; }
      }
    }
    if (!data) data = await ViewShot.captureScreen(opts);
    return { base64: data, mime: 'image/jpeg', width: w, height: h, area };
  }

  async cmd_tap(args) {
    const start = capture.lastSeq();
    const t = this.target(args);
    let node = tree.resolve(this.root(), t, this.refRegistry);
    let f = node.fiber;
    let p = f.memoizedProps || {};
    const key = args.long ? 'onLongPress' : 'onPress';
    while (f && !(f.memoizedProps && f.memoizedProps[key])) f = f.return;
    if (!f) throw new Error('element has no ' + key + ' handler');
    p = f.memoizedProps;
    if (p.disabled || (p.accessibilityState && p.accessibilityState.disabled)) throw new Error('element is disabled');
    if (p.onPressIn) p.onPressIn(fakeEvent());
    p[key](fakeEvent());
    if (p.onPressOut) p.onPressOut(fakeEvent());
    return this.afterAction(args, start);
  }

  async cmd_type(args) {
    const start = capture.lastSeq();
    const t = this.target(Object.assign({}, args, { role: 'input' }));
    const node = tree.resolve(this.root(), t, this.refRegistry);
    const p = node.fiber.memoizedProps || {};
    if (p.editable === false) throw new Error('input is not editable');
    const current = p.value != null ? String(p.value) : '';
    const text = args.append ? current + args.value : String(args.value);
    if (p.onFocus) p.onFocus(fakeEvent());
    if (p.onChangeText) p.onChangeText(text);
    if (p.onChange) p.onChange(fakeEvent({ nativeEvent: { text } }));
    const host = tree.findHostInstance(node.fiber, (sn) => typeof sn.setNativeProps === 'function');
    if (host && p.value == null) {
      try { host.setNativeProps({ text }); } catch (e) {}
    }
    if (args.submit) {
      await settle(50);
      const fresh = tree.resolve(this.root(), t, this.refRegistry).fiber.memoizedProps || {};
      if (fresh.onSubmitEditing) fresh.onSubmitEditing(fakeEvent({ nativeEvent: { text } }));
    }
    if (p.onBlur && args.submit) p.onBlur(fakeEvent());
    return this.afterAction(args, start);
  }

  async cmd_scroll(args) {
    const start = capture.lastSeq();
    const root = this.root();
    const node = args.ref || args.testID || args.text
      ? tree.resolve(root, this.target(Object.assign({}, args, { role: 'scroll' })), this.refRegistry)
      : tree.firstScroll(root, this.refRegistry);
    if (!node) throw new Error('no scrollable view on screen');
    const inst = tree.findHostInstance(node.fiber, (sn) => typeof sn.scrollToOffset === 'function' || typeof sn.scrollTo === 'function');
    if (!inst) throw new Error('scroll view instance not found');
    const horizontal = !!(node.fiber.memoizedProps || {}).horizontal;
    const win = RN.Dimensions.get('window');
    const page = args.amount || Math.round((horizontal ? win.width : win.height) * 0.7);
    const dir = args.direction || 'down';
    if (dir === 'bottom' && inst.scrollToEnd) {
      inst.scrollToEnd({ animated: false });
    } else {
      const metrics = inst._scrollMetrics || (inst._listRef && inst._listRef._scrollMetrics);
      let offset = metrics && typeof metrics.offset === 'number' ? metrics.offset : this.scrollOffsets.get(node.key) || 0;
      if (dir === 'top') offset = 0;
      else if (dir === 'up' || dir === 'left') offset = Math.max(0, offset - page);
      else offset += page;
      this.scrollOffsets.set(node.key, offset);
      if (inst.scrollToOffset) inst.scrollToOffset({ offset, animated: false });
      else inst.scrollTo(horizontal ? { x: offset, animated: false } : { y: offset, animated: false });
    }
    return this.afterAction(args, start);
  }

  async cmd_toggle(args) {
    const start = capture.lastSeq();
    const node = tree.resolve(this.root(), this.target(Object.assign({}, args, { role: 'switch' })), this.refRegistry);
    const p = node.fiber.memoizedProps || {};
    const next = args.value == null ? !p.value : !!args.value;
    p.onValueChange(next);
    return this.afterAction(args, start);
  }

  async cmd_navigate(args) {
    const start = capture.lastSeq();
    const path = String(args.path || '/');
    const router = this.props.router;
    if (router && args.replace && router.replace) {
      router.replace(path);
    } else if (router && router.push) {
      router.push(path);
    } else if (/^[a-z][\w+.-]*:\/\//i.test(path)) {
      await RN.Linking.openURL(path);
    } else {
      const base = (Constants && Constants.linkingUri) || '';
      if (!base) throw new Error('cannot build deep link; pass router={router} to <AgentBridge />');
      const url = base.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
      await RN.Linking.openURL(url);
    }
    return this.afterAction(Object.assign({ settleMs: 3000 }, args), start);
  }

  async cmd_wait(args) {
    const timeout = Math.min(args.timeout || 5000, 30000);
    const deadline = Date.now() + timeout;
    const needle = args.text && String(args.text).toLowerCase();
    while (Date.now() < deadline) {
      const snap = this.snapText(5000);
      const low = snap.toLowerCase();
      const found = (needle && low.includes(needle)) || (args.testID && snap.includes('#' + args.testID));
      if (args.gone ? !found : found) {
        const out = { found: !args.gone, ms: timeout - (deadline - Date.now()) };
        if (args.snapshot !== false) out.snapshot = this.screenUpdate(args);
        return out;
      }
      await wait(150);
    }
    throw new Error('timed out after ' + timeout + 'ms waiting for ' + (args.gone ? 'disappearance of ' : '') + JSON.stringify(args.text || args.testID));
  }

  /** Run several actions in one round trip; report the screen once at the end. */
  async cmd_batch(args) {
    const start = capture.lastSeq();
    const steps = Array.isArray(args.steps) ? args.steps : [];
    const allowed = ['tap', 'type', 'scroll', 'toggle', 'navigate', 'wait', 'dismiss_keyboard'];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i] || {};
      const cmd = step.action || step.cmd;
      if (!allowed.includes(cmd)) throw new Error('step ' + (i + 1) + ': unknown action ' + JSON.stringify(cmd) + ' (use ' + allowed.join(', ') + ')');
      try {
        await this['cmd_' + cmd](Object.assign({ settleMs: cmd === 'navigate' ? 3000 : 800 }, step, { snapshot: false }));
      } catch (err) {
        const out = await this.afterAction(Object.assign({ settleMs: 0 }, args), start);
        out.failedStep = { index: i + 1, action: cmd, error: (err && err.message) || String(err) };
        return out;
      }
    }
    return this.afterAction(Object.assign({ settleMs: 300 }, args), start, { steps: steps.length });
  }

  /** Elements of the visible screen with window rects (dp) and text styles. */
  async cmd_layout(args) {
    const collect = [];
    tree.snapshot(this.root(), { maxLines: args.maxLines || 400, refs: this.refRegistry, collect });
    const win = RN.Dimensions.get('window');
    const r = (n) => Math.round(n);
    const list = collect.slice(0, args.limit || 250);
    const rects = await Promise.all(list.map((c) => tree.measure(c.fiber)));
    const items = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const rect = rects[i];
      if (!rect) continue;
      const item = { role: c.role, label: c.label, x: r(rect.x), y: r(rect.y), w: r(rect.w), h: r(rect.h) };
      if (c.ref) item.ref = c.ref;
      if (c.style && c.style.fontSize) item.fontSize = c.style.fontSize;
      if (c.style && c.style.fontWeight) item.fontWeight = String(c.style.fontWeight);
      if (c.role === 'scroll') {
        const hosts = tree.scrollHosts(c.fiber);
        const cr = hosts && hosts.content ? await tree.measure(hosts.content) : null;
        if (cr) item.contentH = r(cr.h);
      }
      items.push(item);
    }
    return { window: { w: r(win.width), h: r(win.height) }, items };
  }

  /** The whole scrollable content as one tall image (for smooth scroll animations). */
  async cmd_capture_scroll(args) {
    if (!ViewShot || !ViewShot.captureRef) throw new Error('react-native-view-shot is not installed. Run: npx expo install react-native-view-shot');
    const root = this.root();
    const node = args.ref ? tree.resolve(root, { ref: args.ref }, this.refRegistry) : tree.firstScroll(root, this.refRegistry);
    if (!node) throw new Error('no scrollable view on screen');
    const hosts = tree.scrollHosts(node.fiber);
    if (!hosts || !hosts.content) throw new Error('scroll content not found');
    const [vr, cr] = await Promise.all([tree.measure(hosts.view), tree.measure(hosts.content)]);
    if (!vr || !cr) throw new Error('could not measure the scroll view');
    const maxW = args.maxWidth || 400;
    const maxH = args.maxHeight || 8000;
    const pixelRatio = RN.Dimensions.get('window').scale || 1;
    const scale = Math.min(pixelRatio, maxW / vr.w, maxH / cr.h);
    const w = Math.round(vr.w * scale);
    const h = Math.round(cr.h * scale);
    const data = await ViewShot.captureRef(tree.nativeHandle(hosts.view), {
      format: 'jpg', quality: args.quality || 0.7, result: 'base64', snapshotContentContainer: true, width: w, height: h,
    });
    const r = (n) => Math.round(n);
    return { base64: data, width: w, height: h, scale, viewport: { x: r(vr.x), y: r(vr.y), w: r(vr.w), h: r(vr.h) }, contentH: r(cr.h) };
  }

  /**
   * Screen recording: captures frames of the visible screen for `seconds`
   * (real timestamps), optionally scrolling smoothly or tapping mid-way.
   */
  async cmd_record(args) {
    if (!ViewShot || !ViewShot.captureRef) throw new Error('react-native-view-shot is not installed. Run: npx expo install react-native-view-shot');
    const seconds = Math.max(0.5, Math.min(Number(args.seconds) || 4, 15));
    const win = RN.Dimensions.get('window');
    const w = Math.min(args.maxWidth || 540, Math.round(win.width * (win.scale || 1)));
    const h = Math.round((win.height / win.width) * w);
    const opts = { format: 'jpg', quality: args.quality || 0.6, result: 'base64', width: w, height: h };
    // The scroll view is looked up when scrolling starts, so it can belong to a
    // page that opens during the recording.
    let scroll; // undefined = not looked up yet, null = none on screen
    const makeScroller = () => {
      const node = tree.firstScroll(this.root(), this.refRegistry);
      const inst = node && tree.findHostInstance(node.fiber, (sn) => typeof sn.scrollToOffset === 'function' || typeof sn.scrollTo === 'function');
      if (!inst) return null;
      const distance = typeof args.scroll === 'number' ? args.scroll : win.height * 1.5;
      return (p) => {
        const y = distance * (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
        if (inst.scrollToOffset) inst.scrollToOffset({ offset: y, animated: false });
        else inst.scrollTo({ y, animated: false });
      };
    };
    const scrollFrom = args.scrollFrom != null ? args.scrollFrom : 0.15; // fraction of the recording
    const scrollTo = args.scrollTo != null ? args.scrollTo : 0.85;
    if (args.navigate) {
      // record the page opening: loading state, entrance animations and all
      setTimeout(() => {
        this.cmd_navigate({ path: args.navigate, replace: args.replace !== false, snapshot: false, settleMs: 0 }).catch(() => {});
      }, (args.navigateAt != null ? args.navigateAt : 0.4) * 1000);
    }
    if (args.tap) {
      const target = typeof args.tap === 'string' ? { text: args.tap } : args.tap;
      setTimeout(() => { this.cmd_tap(Object.assign({}, target, { snapshot: false, settleMs: 0 })).catch(() => {}); }, (args.tapAt || seconds / 2) * 1000);
    }
    const frames = [];
    const t0 = Date.now();
    const interval = 1000 / Math.min(args.fps || 15, 30);
    while (Date.now() - t0 < seconds * 1000 && frames.length < 240) {
      const due = t0 + frames.length * interval;
      if (Date.now() < due) await wait(due - Date.now());
      const t = (Date.now() - t0) / 1000;
      if (t > seconds) break;
      if (args.scroll) {
        const p = (t / seconds - scrollFrom) / (scrollTo - scrollFrom);
        if (p >= 0) {
          if (scroll === undefined) scroll = makeScroller();
          if (scroll) scroll(Math.min(1, p));
        }
      }
      const view = tree.topScreenView(this.root());
      let data;
      try { data = view != null ? await ViewShot.captureRef(view, opts) : await ViewShot.captureScreen(opts); } catch (e) { data = await ViewShot.captureScreen(opts); }
      const frame = { t: Math.round(t * 1000) / 1000, data };
      const modal = tree.visibleModalView(this.root());
      if (modal != null) {
        // modals live in their own window: capture them as a transparent overlay
        try { frame.overlay = await ViewShot.captureRef(modal, Object.assign({}, opts, { format: 'png' })); } catch (e) {}
      }
      frames.push(frame);
    }
    return { width: w, height: h, seconds, fps: Math.round((frames.length / seconds) * 10) / 10, frames };
  }

  cmd_dismiss_keyboard() {
    RN.Keyboard.dismiss();
    return { ok: true };
  }

  cmd_logs(args) {
    const out = { logs: capture.getLogs(args), last: capture.lastSeq() };
    if (args.clear) capture.clear();
    return out;
  }

  cmd_network(args) {
    return { requests: capture.getRequests(args), last: capture.lastSeq() };
  }

  async cmd_eval(args) {
    if (this.props.allowEval === false) throw new Error('eval disabled via allowEval={false}');
    const code = String(args.code || '');
    let fn;
    try {
      fn = new Function('bridge', 'RN', 'return (' + code + '\n)');
    } catch (e) {
      fn = new Function('bridge', 'RN', code);
    }
    let value = fn(this, RN);
    if (value && typeof value.then === 'function') value = await value;
    return { value: safeStringify(value) };
  }

  cmd_reload() {
    setTimeout(() => {
      if (RN.DevSettings && RN.DevSettings.reload) RN.DevSettings.reload();
      else if (RN.NativeModules.DevSettings) RN.NativeModules.DevSettings.reload();
    }, 50);
    return { reloading: true };
  }
}

AgentBridge.displayName = 'AgentBridge';

module.exports = { AgentBridge, default: AgentBridge };
