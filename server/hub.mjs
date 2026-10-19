// WebSocket hub: the phone/emulator running <AgentBridge /> dials in here.
import { WebSocketServer } from 'ws';
import os from 'node:os';

export const DEFAULT_PORT = Number(process.env.EXPO_MCP_PORT) || 8347;

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

export class Hub {
  constructor({ port = DEFAULT_PORT, log = () => {} } = {}) {
    this.port = port;
    this.log = log;
    this.devices = new Map();
    this.current = null;
    this.pending = new Map();
    this.nextId = 1;
    this.nextDevice = 1;
    this.startError = null;
    this.waiters = [];
  }

  start() {
    return new Promise((resolve) => {
      const wss = new WebSocketServer({ port: this.port, host: '0.0.0.0' });
      this.wss = wss;
      wss.on('listening', () => {
        this.log(`listening on ws://0.0.0.0:${this.port} (LAN: ${lanAddresses().join(', ') || 'none'})`);
        resolve(true);
      });
      wss.on('error', (err) => {
        this.startError = err.code === 'EADDRINUSE'
          ? `Port ${this.port} is already in use (another agent session running expo-mcp-bridge?). Close it or set EXPO_MCP_PORT and <AgentBridge port={...} />.`
          : err.message;
        this.log(this.startError);
        resolve(false);
      });
      wss.on('connection', (ws, req) => this.onConnection(ws, req));
    });
  }

  onConnection(ws, req) {
    const device = { id: 'd' + this.nextDevice++, ws, info: null, address: req.socket.remoteAddress, connectedAt: Date.now() };
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (msg.type === 'hello') {
        device.info = msg.info;
        this.devices.set(device.id, device);
        this.current = device;
        this.log(`device connected: ${msg.info?.app} on ${msg.info?.platform} (${device.address})`);
        this.waiters.splice(0).forEach((w) => w(device));
        return;
      }
      const p = msg.id && this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error));
    });
    ws.on('close', () => {
      this.devices.delete(device.id);
      if (this.current === device) this.current = [...this.devices.values()].pop() || null;
      for (const [id, p] of this.pending) {
        if (p.device === device) {
          this.pending.delete(id);
          clearTimeout(p.timer);
          p.reject(new Error('app disconnected (reloading or closed?). Retry in a moment.'));
        }
      }
    });
  }

  waitForDevice(ms) {
    if (this.current) return Promise.resolve(this.current);
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== done);
        resolve(null);
      }, ms);
      const done = (d) => { clearTimeout(t); resolve(d); };
      this.waiters.push(done);
    });
  }

  /** Wait for a connection other than `old` (e.g. the app coming back after a reload). */
  waitForNewDevice(old, ms) {
    const deadline = Date.now() + ms;
    return new Promise((resolve) => {
      const tick = () => {
        if (this.current && this.current !== old) return resolve(this.current);
        if (Date.now() >= deadline) return resolve(null);
        setTimeout(tick, 250);
      };
      tick();
    });
  }

  notConnectedHelp() {
    if (this.startError) return this.startError;
    return [
      'No app connected.',
      '1. Mount <AgentBridge /> in your root layout (import { AgentBridge } from "expo-mcp-bridge").',
      '2. Start the app with `npx expo start` (LAN mode, not --tunnel) and open it in Expo Go.',
      '3. Phone and computer must be on the same Wi-Fi. Allow Node.js through the firewall for port ' + this.port + '.',
      `   This computer: ${lanAddresses().join(', ') || 'no LAN address'}. USB Android: run \`adb reverse tcp:${this.port} tcp:${this.port}\` and pass host="localhost".`,
    ].join('\n');
  }

  async call(cmd, args = {}, timeoutMs = 15000) {
    const device = await this.waitForDevice(6500); // app retries every <=2s; allow for a slow network
    if (!device) throw new Error(this.notConnectedHelp());
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`app did not answer "${cmd}" within ${timeoutMs}ms (JS thread busy or app in background?)`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, device });
      device.ws.send(JSON.stringify({ id, cmd, args }));
    });
  }

  close() {
    this.wss?.close();
  }
}
