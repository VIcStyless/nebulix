'use strict';
// SSRF protection: only public internet targets are reachable through the proxy.
// DNS answers are validated and the validated address is the one actually connected to (no DNS-rebinding window).
const net = require('net');
const dns = require('dns');
const cfg = require('../config');
const { HttpError } = require('../util');

const v4int = (ip) => ip.split('.').reduce((a, o) => ((a << 8) | (+o & 255)) >>> 0, 0);
const V4_BLOCK = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]
  .map(([b, bits]) => [v4int(b), bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0]);

function isPrivateV4(ip) { const n = v4int(ip); return V4_BLOCK.some(([base, mask]) => ((n & mask) >>> 0) === ((base & mask) >>> 0)); }

function expandV6(ip) {
  ip = ip.split('%')[0].toLowerCase();
  let tail = [];
  const m = ip.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) { const o = m[2].split('.').map(Number); tail = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]]; ip = m[1] + '0:0'; }
  const [a, b] = ip.split('::');
  const left = a ? a.split(':') : []; const right = b !== undefined && b ? b.split(':') : [];
  const fill = 8 - left.length - right.length;
  const parts = b === undefined ? left : [...left, ...Array(Math.max(fill, 0)).fill('0'), ...right];
  const g = parts.map((x) => parseInt(x || '0', 16));
  if (tail.length) { g[6] = tail[0]; g[7] = tail[1]; }
  return g;
}
const g2v4 = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

function isPrivateV6(ip) {
  const g = expandV6(ip);
  if (g.length !== 8 || g.some((x) => !Number.isFinite(x))) return true;
  const z5 = g.slice(0, 5).every((x) => x === 0);
  if (z5 && g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1)) return true; // :: and ::1
  if (z5 && (g[5] === 0xffff || g[5] === 0)) return isPrivateV4(g2v4(g[6], g[7])); // mapped / compatible
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateV4(g2v4(g[6], g[7])); // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return true; // ULA
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && (g[1] === 0x0db8 || g[1] === 0)) return true; // documentation, teredo
  if (g[0] === 0x2002) return isPrivateV4(g2v4(g[1], g[2])); // 6to4
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;
  return false;
}
function isPrivateIp(ip) { const f = net.isIP(ip); return f === 4 ? isPrivateV4(ip) : f === 6 ? isPrivateV6(ip) : true; }

const BAD_PORTS = new Set([22, 23, 25, 53, 110, 111, 135, 137, 138, 139, 143, 161, 389, 445, 465, 587, 993, 995, 1433, 1521, 2049, 2375, 2376, 3306, 3389, 5432, 5900, 5984, 6379, 8086, 9200, 11211, 27017]);
const BAD_HOST = /(^|\.)(localhost|local|internal|lan|home|corp|intranet|localdomain|home\.arpa)$/;

function checkUrl(u) {
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) throw new HttpError(400, 'bad_scheme', 'Only http(s) addresses can be opened');
  if (u.username || u.password) throw new HttpError(400, 'bad_url', 'Addresses with embedded credentials are not supported');
  let host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) throw new HttpError(400, 'bad_url', 'Missing host');
  const port = u.port ? parseInt(u.port, 10) : (u.protocol === 'https:' || u.protocol === 'wss:' ? 443 : 80);
  if (BAD_PORTS.has(port) && !cfg.allowPrivateTargets) throw new HttpError(403, 'blocked_target', 'That port is not allowed through the proxy');
  if (cfg.allowPrivateTargets) return { host, port };
  if (net.isIP(host)) { if (isPrivateIp(host)) throw new HttpError(403, 'blocked_target', 'Private and local addresses are blocked'); }
  else if (BAD_HOST.test(host) || !host.includes('.') || host === 'metadata.google.internal') throw new HttpError(403, 'blocked_target', 'Private and local addresses are blocked');
  return { host, port };
}

const cache = new Map();
async function resolveHost(host) {
  const c = cache.get(host);
  if (c && c.exp > Date.now()) return c.addrs;
  const addrs = await dns.promises.lookup(host, { all: true, verbatim: true });
  if (!cfg.allowPrivateTargets && addrs.some((a) => isPrivateIp(a.address))) throw Object.assign(new Error('blocked'), { code: 'EBLOCKED' });
  cache.set(host, { addrs, exp: Date.now() + 60000 });
  if (cache.size > 2000) for (const [k, v] of cache) { if (v.exp < Date.now()) cache.delete(k); }
  return addrs;
}

// Drop-in replacement for dns.lookup used by http(s).request / net.connect
function lookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  resolveHost(hostname).then((addrs) => {
    let list = addrs;
    if (options.family === 4) list = list.filter((a) => a.family === 4);
    else if (options.family === 6) list = list.filter((a) => a.family === 6);
    if (!list.length) return cb(Object.assign(new Error('getaddrinfo ENOTFOUND ' + hostname), { code: 'ENOTFOUND' }));
    if (options.all) cb(null, list.map((a) => ({ address: a.address, family: a.family })));
    else cb(null, list[0].address, list[0].family);
  }, cb);
}

module.exports = { checkUrl, lookup, isPrivateIp, isPrivateV4, isPrivateV6 };
