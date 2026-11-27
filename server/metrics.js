'use strict';
// Nebulix 3.0 — server metrics for the admin Overview: request/error counters per minute, memory, event-loop lag and
// online users sampled every minute into a 24 h ring buffer (in memory; resets on restart), plus the last 100 server
// errors (route pattern + message only: no bodies, no query strings, no user data).
const { monitorEventLoopDelay } = require('perf_hooks');

const SLOTS = 24 * 60; const series = []; let cur = fresh();
const errors = []; const started = Date.now();
const lag = monitorEventLoopDelay({ resolution: 20 }); lag.enable();
function fresh() { return { t: Math.floor(Date.now() / 60000) * 60000, req: 0, api: 0, e4: 0, e5: 0, ms: 0 }; }
function roll(online) {
  const mem = process.memoryUsage();
  series.push({ t: cur.t, req: cur.req, api: cur.api, e4: cur.e4, e5: cur.e5, avgMs: cur.api ? Math.round(cur.ms / cur.api) : 0, rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576),
    lag: Math.round(lag.mean / 1e6 * 10) / 10, lagMax: Math.round(lag.max / 1e6), online: online || 0 });
  if (series.length > SLOTS) series.shift(); lag.reset(); cur = fresh();
}
let onlineFn = () => 0;
const timer = setInterval(() => { try { roll(onlineFn()); } catch {} }, 60000); timer.unref && timer.unref();
module.exports = {
  setOnline(fn) { onlineFn = fn; },
  // every HTTP request (static, API, proxy host): counted when the response finishes
  track(req, res) { const t0 = Date.now(); res.on('finish', () => { cur.req++; const s = res.statusCode; if (s >= 500) cur.e5++; else if (s >= 400 && s !== 404) cur.e4++; if (req.__nxApi) { cur.api++; cur.ms += Date.now() - t0; } }); },
  api(req) { req.__nxApi = true; },
  error(pattern, method, e) { errors.unshift({ t: Date.now(), route: method + ' ' + pattern, message: String((e && e.message) || e).slice(0, 300), where: String((e && e.stack) || '').split('\n').slice(1, 3).map((l) => l.trim().replace(/\(.*[\\/](server[\\/][^)]+)\)/, '($1)')).join(' · ').slice(0, 300) }); if (errors.length > 100) errors.length = 100; },
  snapshot(minutes = 120) { const live = { t: cur.t, req: cur.req, api: cur.api, e4: cur.e4, e5: cur.e5, avgMs: cur.api ? Math.round(cur.ms / cur.api) : 0, rss: Math.round(process.memoryUsage().rss / 1048576), heap: Math.round(process.memoryUsage().heapUsed / 1048576), lag: Math.round(lag.mean / 1e6 * 10) / 10 || 0, lagMax: Math.round(lag.max / 1e6) || 0, online: onlineFn() || 0, partial: true };
    return { series: series.slice(-Math.max(1, Math.min(SLOTS, minutes))).concat([live]), since: started }; },
  errors() { return errors.slice(); },
  clearErrors() { errors.length = 0; },
};
