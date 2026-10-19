'use strict';
// Captures console output, JS errors and network traffic into small ring
// buffers so the agent can pull them on demand instead of reading Metro logs.

const MAX_LOGS = 300;
const MAX_REQ = 150;
const BODY_LIMIT = 400;

const logs = [];
const requests = [];
let seq = 0;
let installed = false;

function push(buf, item, max) {
  buf.push(item);
  if (buf.length > max) buf.splice(0, buf.length - max);
}

function fmt(arg) {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack || arg.message;
  try {
    const s = JSON.stringify(arg);
    return s === undefined ? String(arg) : s;
  } catch (e) {
    return String(arg);
  }
}

function addLog(level, args) {
  let msg = args.map(fmt).join(' ');
  if (msg.length > 2000) msg = msg.slice(0, 2000) + '…';
  push(logs, { id: ++seq, t: Date.now(), level, msg }, MAX_LOGS);
}

function isInternalUrl(url) {
  return /\/(symbolicate|logs|message|status|inspector|json)(\?|$)|\.bundle(\?|$)|\/hot(\?|$)/.test(url || '');
}

function installConsole() {
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const orig = console[level];
    if (typeof orig !== 'function') continue;
    console[level] = function (...args) {
      try { addLog(level, args); } catch (e) {}
      return orig.apply(this, args);
    };
  }
  const EU = global.ErrorUtils;
  if (EU && EU.getGlobalHandler) {
    const prev = EU.getGlobalHandler();
    EU.setGlobalHandler((err, isFatal) => {
      try { addLog(isFatal ? 'fatal' : 'error', [err]); } catch (e) {}
      if (prev) prev(err, isFatal);
    });
  }
}

function installNetwork() {
  const XHR = global.XMLHttpRequest;
  if (!XHR || !XHR.prototype) return;
  const open = XHR.prototype.open;
  const send = XHR.prototype.send;
  const setHeader = XHR.prototype.setRequestHeader;
  XHR.prototype.open = function (method, url, ...rest) {
    this.__mcp = { method: String(method || 'GET').toUpperCase(), url: String(url), headers: {} };
    return open.call(this, method, url, ...rest);
  };
  XHR.prototype.setRequestHeader = function (k, v) {
    if (this.__mcp && Object.keys(this.__mcp.headers).length < 20) this.__mcp.headers[k] = /auth|cookie|token/i.test(k) ? '<redacted>' : String(v);
    return setHeader.call(this, k, v);
  };
  XHR.prototype.send = function (body) {
    const info = this.__mcp;
    if (info && !isInternalUrl(info.url)) {
      const entry = { id: ++seq, t: Date.now(), method: info.method, url: info.url, status: 0, ms: 0, reqHeaders: info.headers };
      if (typeof body === 'string') entry.reqBody = body.length > BODY_LIMIT ? body.slice(0, BODY_LIMIT) + '…' : body;
      push(requests, entry, MAX_REQ);
      const done = () => {
        entry.ms = Date.now() - entry.t;
        entry.status = this.status;
        try {
          const rt = this.responseType;
          if (!rt || rt === 'text') {
            const txt = this.responseText || '';
            entry.resBody = txt.length > BODY_LIMIT ? txt.slice(0, BODY_LIMIT) + '…' : txt;
          } else {
            entry.resBody = '<' + rt + '>';
          }
        } catch (e) {}
        if (!entry.status) entry.error = 'network error / no response';
      };
      this.addEventListener && this.addEventListener('loadend', done);
    }
    return send.call(this, body);
  };
}

function install() {
  if (installed) return;
  installed = true;
  try { installConsole(); } catch (e) {}
  try { installNetwork(); } catch (e) {}
}

function getLogs({ level, since = 0, limit = 50, search } = {}) {
  const levels = level ? new Set(level === 'error' ? ['error', 'fatal'] : level === 'warn' ? ['warn', 'error', 'fatal'] : [level]) : null;
  let out = logs.filter((l) => l.id > since && (!levels || levels.has(l.level)) && (!search || l.msg.includes(search)));
  if (out.length > limit) out = out.slice(-limit);
  return out;
}

function getRequests({ since = 0, limit = 30, failedOnly, search } = {}) {
  let out = requests.filter((r) => r.id > since && (!failedOnly || r.error || r.status >= 400) && (!search || r.url.includes(search)));
  if (out.length > limit) out = out.slice(-limit);
  return out;
}

function lastSeq() {
  return seq;
}

function clear() {
  logs.length = 0;
  requests.length = 0;
}

module.exports = { install, getLogs, getRequests, lastSeq, clear };
