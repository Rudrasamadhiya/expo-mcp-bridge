// End to end: real <AgentBridge> rendered in Node (fake react-native), real MCP
// server spawned over stdio, driven by a real MCP client like an agent would.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18347;

// --- wire fake react-native + globals before loading the bridge -------------
const Module = require('node:module');
const fakeRN = require('./fake-rn.cjs');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === 'react-native') return path.join(here, 'fake-rn.cjs');
  if (req === 'react-native-view-shot') return path.join(here, 'fake-viewshot.cjs');
  return origResolve.call(this, req, ...rest);
};
globalThis.__DEV__ = true;
globalThis.WebSocket = WebSocket;
globalThis.IS_REACT_ACT_ENVIRONMENT = false;

// fake XHR so network capture has something to patch
class FakeXHR {
  open(m, u) { this.m = m; this.u = u; }
  setRequestHeader() {}
  addEventListener(ev, cb) { this.cb = cb; }
  send() {
    setTimeout(() => {
      this.status = this.u.includes('fail') ? 500 : 200;
      this.responseType = '';
      this.responseText = this.status === 200 ? '{"ok":true}' : '{"error":"boom"}';
      this.cb && this.cb();
    }, 5);
  }
}
globalThis.XMLHttpRequest = FakeXHR;

const React = require('react');
const TR = require('react-test-renderer');
const { AgentBridge } = require('../client/index.js');
const { Text, View, TextInput, Button, ScrollView, Switch, Pressable, Ionicons } = fakeRN;
const h = React.createElement;

function LoginApp() {
  const [email, setEmail] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const [dark, setDark] = React.useState(false);
  const [showPw, setShowPw] = React.useState(false);
  const login = () => {
    const x = new XMLHttpRequest();
    x.open('POST', email.includes('bad') ? 'https://api.test/fail' : 'https://api.test/login');
    x.send('{}');
    if (!email) console.error('Email is required');
    setMsg(email ? 'Welcome ' + email : 'Missing email');
  };
  return h(View, null,
    h(Pressable, { onPress: () => setMsg('went back') }, h(Ionicons, { name: 'chevron-back', size: 28 })),
    h(Ionicons, { name: 'star', size: 12 }),
    h(Text, { style: { fontSize: 28, fontWeight: '700' }, __testRect: { x: 16, y: 60, w: 200, h: 34 } }, 'Sign in'),
    h(TextInput, { placeholder: 'Email', value: email, onChangeText: setEmail, testID: 'email' }),
    h(TextInput, { placeholder: 'Password', value: pw, onChangeText: setPw, secureTextEntry: !showPw }),
    h(Pressable, { onPress: () => setShowPw((s) => !s) }, h(Ionicons, { name: showPw ? 'eye-off' : 'eye', size: 20 })),
    h(Button, { title: 'Log in', onPress: login, testID: 'login-btn' }),
    h(Switch, { value: dark, onValueChange: setDark, accessibilityLabel: 'Dark mode' }),
    msg ? h(Text, { testID: 'msg' }, msg) : null,
    h(View, { accessibilityElementsHidden: true }, h(Text, null, 'hidden screen')),
    h(ScrollView, { __testRect: { x: 0, y: 400, w: 390, h: 300 }, __contentRect: { x: 0, y: 400, w: 390, h: 900 } }, ...Array.from({ length: 3 }, (_, i) => h(Text, { key: i }, 'Row ' + i))),
  );
}

let client, renderer;

before(async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(here, '..', 'server', 'cli.mjs')],
    env: { ...process.env, EXPO_MCP_PORT: String(PORT) },
    stderr: 'pipe',
  });
  client = new Client({ name: 'test', version: '1' });
  await client.connect(transport);
  // native stack: the landing screen stays mounted under the top (login) screen
  const stack = h('RNSScreenStack', null,
    h('RNSScreen', { testID: 'screen-landing' }, h(View, null, h(Text, null, 'Landing page'), h(Button, { title: 'Start learning free', onPress() {} }))),
    h('RNSScreen', { testID: 'screen-login' }, h(LoginApp)));
  renderer = TR.create(h(React.Fragment, null, stack, h(AgentBridge, { host: 'localhost', port: PORT })));
});

after(async () => {
  renderer?.unmount();
  await client?.close();
});

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content.map((c) => c.text ?? `<${c.type}>`).join('\n'), isError: r.isError };
};

test('lists tools', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const n of ['app_status', 'app_snapshot', 'app_tap', 'app_type', 'app_scroll', 'app_logs', 'app_network', 'device_key']) assert.ok(names.includes(n), n);
});

test('status shows connected device', async () => {
  const r = await call('app_status');
  assert.match(r.text, /Connected:[\s\S]*android 34/);
});

test('snapshot is a compact outline', async () => {
  const r = await call('app_snapshot');
  console.log('--- snapshot ---\n' + r.text);
  assert.match(r.text, /text "Sign in"/);
  assert.match(r.text, /input "Email" value="" #email \[e\d+\]/);
  assert.match(r.text, /input "Password" value="" \(secure\)/);
  assert.match(r.text, /button "Log in" #login-btn \[e\d+\]/);
  assert.match(r.text, /switch "Dark mode" value="false"/);
  assert.match(r.text, /scroll \[e\d+\]/);
  assert.doesNotMatch(r.text, /hidden screen/);
  assert.equal((r.text.match(/Log in/g) || []).length, 1, 'button label not duplicated');
});

test('tapping with empty email surfaces the console error', async () => {
  const r = await call('app_tap', { text: 'Log in' });
  assert.match(r.text, /Missing email/);
  assert.match(r.text, /New errors:\nEmail is required/);
});

test('type then tap uses fresh state (no stale closures)', async () => {
  let r = await call('app_type', { text: 'Email', value: 'a@b.co', snapshot: false });
  assert.equal(r.text, 'Typed.');
  r = await call('app_type', { text: 'Password', value: 'secret' });
  assert.match(r.text, /value="••••••"/, 'password masked');
  r = await call('app_tap', { testID: 'login-btn' });
  assert.match(r.text, /Welcome a@b\.co/);
});

test('failed requests are reported after an action', async () => {
  await call('app_type', { testID: 'email', value: 'bad@x.io', snapshot: false });
  const r = await call('app_tap', { testID: 'login-btn' });
  assert.match(r.text, /Failed requests:\nPOST https:\/\/api\.test\/fail -> 500/);
  const net = await call('app_network', { failedOnly: true, bodies: true });
  assert.match(net.text, /res: \{"error":"boom"\}/);
});

test('toggle, scroll, unchanged detection', async () => {
  let r = await call('app_toggle', { text: 'Dark mode' });
  assert.match(r.text, /value="true"/);
  r = await call('app_scroll', { direction: 'down' });
  assert.equal(fakeRN.ScrollView.last, Math.round(844 * 0.7));
  assert.match(r.text, /Screen unchanged/);
});

test('wait, logs, eval, navigate', async () => {
  let r = await call('app_wait', { testID: 'msg', timeout: 1000 });
  assert.match(r.text, /Condition met/);
  r = await call('app_wait', { text: 'never there', timeout: 300 });
  assert.ok(r.isError);
  r = await call('app_logs', { level: 'error' });
  assert.match(r.text, /ERROR Email is required/);
  r = await call('app_eval', { code: '1 + 2' });
  assert.equal(r.text, '3');
  r = await call('app_eval', { code: 'const p = RN.Platform; return { os: p.OS }' });
  assert.equal(r.text, '{"os":"android"}');
  r = await call('app_navigate', { path: '/settings', router: undefined, snapshot: false });
  assert.match(r.text, /Error: cannot build deep link|Navigated/);
});

test('icon-only buttons are named after their icon, glyphs are hidden', async () => {
  let r = await call('app_snapshot');
  assert.match(r.text, /button "icon:chevron-back" \[e\d+\]/);
  assert.match(r.text, /button "icon:eye" \[e\d+\]/);
  assert.doesNotMatch(r.text, //, 'no icon-font glyphs in output');
  assert.doesNotMatch(r.text, /text ""/, 'standalone icon produces no empty text line');
  r = await call('app_tap', { text: 'icon:eye' });
  assert.match(r.text, /button "icon:eye-off"/);
  r = await call('app_tap', { text: 'chevron-back' });
  assert.match(r.text, /text "went back"/);
});

test('native stack: only the top screen is in the snapshot', async () => {
  const r = await call('app_snapshot');
  assert.doesNotMatch(r.text, /Landing page|Start learning free/);
  assert.match(r.text, /text "Sign in"/);
});

test('refs stay stable and actions return small diffs', async () => {
  const full = (await call('app_snapshot')).text;
  const ref = full.match(/switch "Dark mode" value="\w+" \[(e\d+)\]/)[1];
  const r = await call('app_tap', { text: 'icon:eye' }); // toggles eye <-> eye-off every time
  assert.match(r.text, /Changes \(\+ added, - removed\):/);
  assert.match(r.text, /\+ +button "icon:eye(-off)?"/);
  assert.match(r.text, /- +button "icon:eye(-off)?"/);
  assert.match(r.text, /~ +input "Password" value="[^"]*" (\(secure\) )?\[e\d+\]/, 'same-ref change sent once with ~');
  assert.doesNotMatch(r.text, /- +input "Password"/);
  assert.doesNotMatch(r.text, /Sign in/, 'unchanged lines are not repeated');
  const changeLines = r.text.split('\n').filter((l) => /^[+~-] /.test(l)).length;
  const screenLines = full.split('\n').length;
  assert.ok(changeLines <= 3 && changeLines < screenLines / 3, `${changeLines} change lines vs ${screenLines} screen lines`);
  const again = (await call('app_snapshot')).text;
  assert.match(again, new RegExp(`switch "Dark mode" value="\\w+" \\[${ref}\\]`), 'same ref after re-render');
  const forced = await call('app_tap', { text: 'icon:chevron-back', full: true });
  assert.match(forced.text, /Screen (unchanged|:)/);
});

test('app_batch runs a whole flow in one call', async () => {
  let r = await call('app_batch', { steps: [
    { action: 'type', testID: 'email', value: 'z@z.io' },
    { action: 'type', text: 'Password', value: 'pw' },
    { action: 'tap', testID: 'login-btn' },
  ] });
  assert.match(r.text, /^Ran 3 steps\./);
  assert.match(r.text, /Welcome z@z\.io/);
  r = await call('app_batch', { steps: [{ action: 'type', testID: 'email', value: 'q@q.io' }, { action: 'tap', ref: 'e999' }] });
  assert.match(r.text, /^Stopped at step 2 \(tap\): ref e999/);
  assert.match(r.text, /q@q\.io/, 'screen still reported after a failed step');
});

test('screenshot returns an image, or saves it with saveTo', async () => {
  const img = await client.callTool({ name: 'app_screenshot', arguments: {} });
  assert.equal(img.content[0].type, 'image');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const file = path.join(os.tmpdir(), `emb-shot-${process.pid}.jpg`);
  const r = await call('app_screenshot', { saveTo: file });
  assert.match(r.text, /^Saved \d+x\d+ JPEG \(screen\) to /);
  const buf = fs.readFileSync(file);
  assert.equal(buf[0], 0xff); assert.equal(buf[1], 0xd8);
  fs.unlinkSync(file);
});

test('screenshot captures the visible stack screen, not the stale window', async () => {
  const shot = require('./fake-viewshot.cjs');
  await call('app_screenshot', {});
  assert.equal(shot.lastTarget?.props?.testID, 'screen-login', 'captured the top screen view');
  const w = await call('app_screenshot', { area: 'window', saveTo: path.join((await import('node:os')).tmpdir(), `emb-w-${process.pid}.jpg`) });
  assert.match(w.text, /\(window\)/);
  assert.equal(shot.lastTarget, 'window');
});

test('actions settle adaptively (fast when the UI is quick)', async () => {
  const t0 = Date.now();
  await call('app_tap', { text: 'icon:eye' });
  const ms = Date.now() - t0;
  assert.ok(ms < 900, `tap took ${ms}ms`);
});

test('app_layout reports positions and font sizes', async () => {
  const r = await call('app_layout');
  assert.match(r.text, /^window 390x844/);
  assert.match(r.text, /text "Sign in" 16,60 200x34 fs28/);
  assert.match(r.text, /scroll \[e\d+\] 0,400 390x300 content900/);
  assert.doesNotMatch(r.text, /Landing page/, 'only the visible screen');
});

test('fullScroll screenshot captures the whole scroll content', async () => {
  const shot = require('./fake-viewshot.cjs');
  const os = await import('node:os');
  const fs = await import('node:fs');
  const file = path.join(os.tmpdir(), `emb-scroll-${process.pid}.jpg`);
  const r = await call('app_screenshot', { fullScroll: true, saveTo: file });
  assert.match(r.text, /^Saved 400x923 JPEG \(full scroll, content 900dp tall, viewport 390x300 at y=400\)/);
  assert.equal(shot.lastOptions.snapshotContentContainer, true);
  assert.equal(shot.lastTarget?.type, 'RCTScrollView');
  assert.ok(fs.existsSync(file));
  fs.unlinkSync(file);
});

test('record captures timed frames while scrolling', async () => {
  const fake = require('./fake-rn.cjs');
  // drive the in-app command through app_eval to keep the tool surface small
  const r = await call('app_eval', { code: 'bridge.cmd_record({ seconds: 0.6, scroll: 300 }).then(function (x) { return { n: x.frames.length, w: x.width, last: x.frames[x.frames.length - 1].t }; })' });
  const out = JSON.parse(r.text);
  assert.ok(out.n >= 3, `got ${out.n} frames`);
  assert.equal(out.w, 540);
  assert.ok(out.last <= 0.65);
  assert.ok(fake.ScrollView.last > 0, 'scrolled while recording');
});

test('bad ref gives a helpful error', async () => {
  const r = await call('app_tap', { ref: 'e999' });
  assert.ok(r.isError);
  assert.match(r.text, /take a new snapshot/);
});
