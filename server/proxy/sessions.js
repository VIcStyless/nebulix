'use strict';
// Proxy sessions: the sid in every proxied URL maps to a cookie jar, preferences and a request log.
const cfg = require('../config');
const { rid, now } = require('../util');
const { Jar } = require('./cookies');

const sessions = new Map();
const TTL = 12 * 3600 * 1000;
const DEFAULT_PREFS = { adblock: true, jsRewrite: true, stripTracking: true, cache: true, ua: 'auto', vpn: false };

function create(uid, prefs, ip) {
  // limit sessions per owner
  const owned = [...sessions.values()].filter((s) => s.uid === uid).sort((a, b) => a.last - b.last);
  while (owned.length >= cfg.maxProxySessionsPerUser) { const old = owned.shift(); sessions.delete(old.sid); }
  const s = { sid: rid(18), uid, created: now(), last: now(), prefs: Object.assign({}, DEFAULT_PREFS, prefs || {}), jar: new Jar(), log: [], stats: { req: 0, bytes: 0, blocked: 0, cached: 0, ads: 0 }, ext: [], ip, tunnels: 0, rate: { n: 0, t: now() } };
  sessions.set(s.sid, s);
  return s;
}
function get(sid) {
  const s = sessions.get(sid);
  if (!s) return null;
  if (now() - s.last > TTL) { sessions.delete(sid); return null; }
  s.last = now();
  return s;
}
function ofUser(uid) { return [...sessions.values()].filter((s) => s.uid === uid); }
function count() { return sessions.size; }

setInterval(() => { for (const [k, s] of sessions) if (now() - s.last > TTL) sessions.delete(k); }, 5 * 60000).unref();

module.exports = { create, get, ofUser, count, DEFAULT_PREFS, sessions };
