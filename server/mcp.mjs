// MCP server: exposes the connected app to AI agents (Claude Code, Cursor,
// Antigravity, ...) as a small set of tools. Responses are kept short on
// purpose: text outlines instead of screenshots, and action tools return the
// updated screen so the agent needs fewer round trips.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { Hub } from './hub.mjs';
import { pressKey, KEYS } from './adb.mjs';

const { version: VERSION } = createRequire(import.meta.url)('../package.json');
const log = (...a) => process.stderr.write('[expo-mcp-bridge] ' + a.join(' ') + '\n');

const target = {
  ref: z.string().optional().describe('ref from the last snapshot, e.g. "e4"'),
  testID: z.string().optional().describe('testID prop of the element'),
  text: z.string().optional().describe('visible label/placeholder (exact match first, then contains)'),
};
const after = {
  snapshot: z.boolean().optional().describe('report the screen afterwards (default true)'),
  full: z.boolean().optional().describe('full screen instead of a diff'),
};

function text(s) {
  return { content: [{ type: 'text', text: s }] };
}

function fail(err) {
  return { content: [{ type: 'text', text: 'Error: ' + (err?.message || String(err)) }], isError: true };
}

function formatScreen(s) {
  if (s.unchanged) return 'Screen unchanged.';
  if (s.diff != null) return 'Changes (+ added, - removed):\n' + s.diff;
  return 'Screen:\n' + s.text;
}

function formatAction(res, done = 'done') {
  const parts = [done];
  if (res.failedStep) parts[0] = `Stopped at step ${res.failedStep.index} (${res.failedStep.action}): ${res.failedStep.error}`;
  if (res.snapshot) parts.push(formatScreen(res.snapshot));
  if (res.errors) parts.push('New errors:\n' + res.errors.join('\n'));
  if (res.failedRequests) parts.push('Failed requests:\n' + res.failedRequests.join('\n'));
  return text(parts.join('\n'));
}

function wrap(fn) {
  return async (args) => {
    try { return await fn(args || {}); } catch (err) { return fail(err); }
  };
}

const fmtTime = (t) => new Date(t).toISOString().slice(11, 23);

/** Register the app_* and device_* tools on an MCP server, backed by a connected Hub. */
export function registerAppTools(server, hub) {

  server.registerTool('app_status', {
    description: 'Check whether the mobile app is connected and show device info. Call first.',
    inputSchema: {},
  }, wrap(async () => {
    if (!hub.current) {
      await hub.waitForDevice(6500); // longer than the app's 2s max reconnect backoff
      if (!hub.current) return text(hub.notConnectedHelp());
    }
    const list = [...hub.devices.values()].map((d) => {
      const i = d.info || {};
      return `${d === hub.current ? '* ' : '  '}${d.id}: ${i.app} — ${i.platform} ${i.osVersion}${i.expoGo ? ' (Expo Go)' : ''}, window ${i.window}, sdk ${i.sdk || '?'}`;
    });
    return text('Connected:\n' + list.join('\n'));
  }));

  server.registerTool('app_snapshot', {
    description: 'Compact text outline of the current screen (buttons, inputs, text, lists) with refs like [e3] to act on. Prefer this over screenshots.',
    inputSchema: { maxLines: z.number().int().optional().describe('default 400') },
  }, wrap(async ({ maxLines }) => {
    const r = await hub.call('snapshot', { maxLines });
    return text(r.text);
  }));

  server.registerTool('app_layout', {
    description: 'Positions (dp, window coordinates) and font sizes of elements on the current screen. For layout checks and visual work; app_snapshot is cheaper for acting.',
    inputSchema: { limit: z.number().int().optional().describe('max elements, default 250') },
  }, wrap(async (a) => {
    const r = await hub.call('layout', a, 30000);
    const lines = r.items.map((i) => `${i.role}${i.label ? ' "' + i.label + '"' : ''}${i.ref ? ' [' + i.ref + ']' : ''} ${i.x},${i.y} ${i.w}x${i.h}${i.fontSize ? ' fs' + i.fontSize : ''}${i.contentH ? ' content' + i.contentH : ''}`);
    return text(`window ${r.window.w}x${r.window.h}\n` + lines.join('\n'));
  }));

  server.registerTool('app_screenshot', {
    description: 'JPEG screenshot of the app. Use only for visual/layout questions; app_snapshot is cheaper for finding elements. With saveTo, writes the file and returns only its path (no image tokens).',
    inputSchema: {
      maxWidth: z.number().int().optional().describe('pixels, default 400'),
      quality: z.number().optional().describe('0-1, default 0.6'),
      saveTo: z.string().optional().describe('file path (.jpg) to save instead of returning the image'),
      area: z.enum(['auto', 'window']).optional().describe('auto (default) = visible screen; window = whole window incl. overlays'),
      fullScroll: z.boolean().optional().describe('capture the whole content of the main scroll view as one tall image'),
    },
  }, wrap(async ({ saveTo, fullScroll, ...a }) => {
    if (fullScroll) {
      const s = await hub.call('capture_scroll', a, 60000);
      const info = `content ${s.contentH}dp tall, viewport ${s.viewport.w}x${s.viewport.h} at y=${s.viewport.y}`;
      if (!saveTo) return { content: [{ type: 'text', text: info }, { type: 'image', data: s.base64, mimeType: 'image/jpeg' }] };
      const file = path.resolve(saveTo);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(s.base64, 'base64'));
      return text(`Saved ${s.width}x${s.height} JPEG (full scroll, ${info}) to ${file}`);
    }
    const r = await hub.call('screenshot', a, 20000);
    if (saveTo) {
      const file = path.resolve(saveTo);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.base64, 'base64'));
      return text(`Saved ${r.width}x${r.height} JPEG (${r.area || 'window'}) to ${file}`);
    }
    return { content: [{ type: 'image', data: r.base64, mimeType: r.mime }] };
  }));

  server.registerTool('app_batch', {
    description: 'Run several actions in one call (fastest way to fill forms or walk a flow). Returns the screen once at the end. Steps: {action:"tap"|"type"|"scroll"|"toggle"|"navigate"|"wait"|"dismiss_keyboard", ...that tool\'s args}.',
    inputSchema: {
      steps: z.array(z.object({ action: z.string() }).passthrough()).min(1).max(30),
      ...after,
    },
  }, wrap(async (a) => {
    const r = await hub.call('batch', a, 60000 + a.steps.length * 5000);
    return formatAction(r, `Ran ${a.steps.length} steps.`);
  }));

  server.registerTool('app_tap', {
    description: 'Press a button/pressable element. Returns what changed on screen plus any new errors.',
    inputSchema: { ...target, long: z.boolean().optional().describe('long press'), ...after },
  }, wrap(async (a) => formatAction(await hub.call('tap', a), 'Tapped.')));

  server.registerTool('app_type', {
    description: 'Set text in an input (replaces by default). Target by ref, testID, or placeholder text.',
    inputSchema: {
      ...target,
      value: z.string(),
      append: z.boolean().optional(),
      submit: z.boolean().optional().describe('fire onSubmitEditing (like pressing enter)'),
      ...after,
    },
  }, wrap(async (a) => formatAction(await hub.call('type', a), 'Typed.')));

  server.registerTool('app_scroll', {
    description: 'Scroll a list/ScrollView (first one on screen if no target).',
    inputSchema: {
      ...target,
      direction: z.enum(['down', 'up', 'left', 'right', 'top', 'bottom']).optional(),
      amount: z.number().optional().describe('pixels, default ~70% of screen'),
      ...after,
    },
  }, wrap(async (a) => formatAction(await hub.call('scroll', a), 'Scrolled.')));

  server.registerTool('app_toggle', {
    description: 'Flip a Switch (or set it with value).',
    inputSchema: { ...target, value: z.boolean().optional(), ...after },
  }, wrap(async (a) => formatAction(await hub.call('toggle', a), 'Toggled.')));

  server.registerTool('app_navigate', {
    description: 'Open a route (expo-router path like "/settings") or a full deep link.',
    inputSchema: { path: z.string(), replace: z.boolean().optional().describe('replace the current screen instead of pushing (keeps the stack shallow)'), ...after },
  }, wrap(async (a) => formatAction(await hub.call('navigate', a), 'Navigated.')));

  server.registerTool('app_wait', {
    description: 'Wait until text or a testID appears (or disappears with gone=true). Cheaper than polling snapshots.',
    inputSchema: {
      text: z.string().optional(),
      testID: z.string().optional(),
      gone: z.boolean().optional(),
      timeout: z.number().int().optional().describe('ms, default 5000, max 30000'),
    },
  }, wrap(async (a) => {
    const r = await hub.call('wait', a, (a.timeout || 5000) + 5000);
    return text(`Condition met after ${r.ms}ms.` + (r.snapshot ? '\n' + formatScreen(r.snapshot) : ''));
  }));

  server.registerTool('app_logs', {
    description: 'Console logs and JS errors captured in the app.',
    inputSchema: {
      level: z.enum(['log', 'info', 'warn', 'error', 'debug']).optional().describe('"error" = errors only, "warn" = warnings and errors'),
      search: z.string().optional(),
      since: z.number().int().optional().describe('only entries after this cursor (returned as "cursor")'),
      limit: z.number().int().optional().describe('default 50'),
      clear: z.boolean().optional(),
    },
  }, wrap(async (a) => {
    const r = await hub.call('logs', a);
    const lines = r.logs.map((l) => `${fmtTime(l.t)} ${l.level.toUpperCase()} ${l.msg}`);
    return text((lines.join('\n') || '(no logs)') + `\ncursor: ${r.last}`);
  }));

  server.registerTool('app_network', {
    description: 'HTTP requests made by the app (fetch/XHR) with status, timing and truncated bodies.',
    inputSchema: {
      failedOnly: z.boolean().optional(),
      search: z.string().optional().describe('substring of URL'),
      since: z.number().int().optional(),
      limit: z.number().int().optional().describe('default 30'),
      bodies: z.boolean().optional().describe('include request/response bodies (default false)'),
    },
  }, wrap(async (a) => {
    const r = await hub.call('network', a);
    const lines = r.requests.map((q) => {
      let s = `${fmtTime(q.t)} ${q.method} ${q.url} -> ${q.error || q.status || 'pending'} ${q.ms}ms`;
      if (a.bodies) {
        if (q.reqBody) s += `\n  req: ${q.reqBody}`;
        if (q.resBody) s += `\n  res: ${q.resBody}`;
      }
      return s;
    });
    return text((lines.join('\n') || '(no requests)') + `\ncursor: ${r.last}`);
  }));

  server.registerTool('app_eval', {
    description: 'Run JavaScript inside the app (dev only) and return the JSON result. Expression or statements with return. `bridge` and `RN` (react-native) are in scope.',
    inputSchema: { code: z.string() },
  }, wrap(async (a) => text((await hub.call('eval', a)).value)));

  server.registerTool('app_reload', {
    description: 'Reload the JS bundle (like pressing r in Metro).',
    inputSchema: {},
  }, wrap(async () => {
    const before = await hub.waitForDevice(6500);
    if (!before) throw new Error(hub.notConnectedHelp());
    const since = (await hub.call('logs', { limit: 1 })).last;
    await hub.call('reload');
    // a fresh bundle can take 30s+ to build after `expo start --clear`
    const d = await hub.waitForNewDevice(before, 90000);
    if (d) return text('Reloaded and reconnected.');
    let hint = '';
    if (hub.current === before) {
      const warn = await hub.call('logs', { level: 'warn', since, search: 'Cannot connect to Metro', limit: 1 }).catch(() => null);
      const earlier = await hub.call('logs', { level: 'warn', search: 'Cannot connect to Metro', limit: 1 }).catch(() => null);
      if (warn?.logs?.length || earlier?.logs?.length) hint = ' The app lost its connection to Metro (was Metro restarted?), so it cannot reload itself: shake the phone and tap Reload.';
    }
    return text('Reload did not happen within 90s; the app is still running the old code.' + (hint || ' Check the Metro terminal for bundling errors, or reload manually.'));
  }));

  server.registerTool('app_dismiss_keyboard', {
    description: 'Hide the on-screen keyboard.',
    inputSchema: {},
  }, wrap(async () => { await hub.call('dismiss_keyboard'); return text('Keyboard dismissed.'); }));

  server.registerTool('device_key', {
    description: `Press a hardware/system key on an Android device via adb (USB or Wi-Fi debugging): ${Object.keys(KEYS).join(', ')}.`,
    inputSchema: { key: z.enum(Object.keys(KEYS)), repeat: z.number().int().min(1).max(20).optional() },
  }, wrap(async ({ key, repeat }) => { await pressKey(key, repeat || 1); return text(`Pressed ${key}${repeat > 1 ? ' x' + repeat : ''}.`); }));

}

export async function startServer() {
  const hub = new Hub({ log });
  await hub.start();
  const server = new McpServer({ name: 'expo-mcp-bridge', version: VERSION });
  registerAppTools(server, hub);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`MCP server ready (v${VERSION})`);

  const shutdown = () => { hub.close(); process.exit(0); };
  process.stdin.on('close', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
