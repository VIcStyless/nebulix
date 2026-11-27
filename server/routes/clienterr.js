'use strict';
// Nebulix 3.0 phase 23 — error reports from browsers (public/js/errors.js). Only the message, the Nebulix file and line,
// a short stack of Nebulix paths, the page name, the app version and the browser family are accepted; anything that
// looks like an email or a long number is masked again here in case the client missed it. Shown in Admin → Overview.
const metrics = require('../metrics');

const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>').replace(/\d{6,}/g, '<n>').trim().slice(0, max);
const path = (s) => { s = String(s || ''); const m = /^(?:https?:\/\/[^/]+)?(\/(?:js|css)\/[\w./-]{1,160})/.exec(s); return m ? m[1] : ''; };
const BROWSERS = ['chrome', 'edge', 'firefox', 'safari', 'opera', 'brave', 'samsung', 'other'];

module.exports = function register(r) {
  r.post('/api/client-errors', { auth: true, limit: [20, 600000, 'user'], bodyLimit: 16384 }, async (c) => {
    const b = c.body || {};
    const e = {
      kind: b.kind === 'promise' ? 'promise' : 'error', message: clean(b.message, 300), file: path(b.file),
      line: Math.max(0, Math.min(1e6, Math.round(Number(b.line) || 0))), col: Math.max(0, Math.min(1e6, Math.round(Number(b.col) || 0))),
      stack: String(b.stack || '').split('\n').map((l) => { const m = /(\/(?:js|css)\/[\w./-]{1,160}):(\d+):(\d+)/.exec(l); const fn = (/^\s*(?:at\s+)?([\w$.<>]{1,60})[\s@(]/.exec(l) || [])[1] || ''; return m ? (fn && fn !== 'at' ? fn + ' ' : '') + m[1] + ':' + m[2] + ':' + m[3] : ''; }).filter(Boolean).slice(0, 8).join('\n'),
      route: /^[a-z0-9]{1,20}$/.test(b.route) ? b.route : '', version: /^\d{1,3}\.\d{1,3}(\.\d{1,3})?$/.test(b.version) ? b.version : '', browser: BROWSERS.includes(b.browser) ? b.browser : 'other',
    };
    if (!e.message || !e.file) return { ok: true, ignored: true }; // only errors in Nebulix's own code are kept
    metrics.clientError(e, c.user.id);
    return { ok: true };
  });
};
