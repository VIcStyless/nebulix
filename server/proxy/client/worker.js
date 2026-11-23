/* Nebulix worker prelude - prepended to proxied Worker scripts. Config arrives in self.__nx_wcfg. */
(function () {
  'use strict';
  var cfg = self.__nx_wcfg; if (!cfg || self.__nx$) return;
  var PREFIX = cfg.prefix, ORIGIN = self.location.origin, realBase = new URL(cfg.base);
  var SPECIAL = /^(?:#|data:|blob:|javascript:|about:)/i;
  function toProxyAbs(h) { var u; try { u = new URL(h); } catch (e) { return h; } var p = u.protocol; if (p !== 'http:' && p !== 'https:' && p !== 'ws:' && p !== 'wss:') return h; return PREFIX + p.slice(0, -1) + '/' + u.host + u.pathname + u.search + u.hash; }
  function rewrite(url) {
    var s = String(url);
    if (s === '' || SPECIAL.test(s)) return s;
    if (s.indexOf(PREFIX) === 0) return s;
    if (s.indexOf(ORIGIN + PREFIX) === 0) return s.slice(ORIGIN.length);
    var abs; try { abs = new URL(s, realBase).href; } catch (e) { return s; }
    if (abs.indexOf(ORIGIN + '/') === 0) abs = new URL(abs.slice(ORIGIN.length), realBase).href;
    return toProxyAbs(abs);
  }
  var fake = {};
  ['href', 'origin', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'].forEach(function (k) { Object.defineProperty(fake, k, { enumerable: true, get: function () { return realBase[k]; } }); });
  fake.toString = function () { return realBase.href; };
  var G = {}; Object.defineProperty(G, 'location', { get: function () { return fake; } });
  Object.defineProperty(self, '__nx$', { value: G, enumerable: false });
  Object.defineProperty(self, '__nx$loc', { configurable: true, get: function () { return fake; } });
  try { var f = self.fetch; self.fetch = function (i, o) { try { if (typeof i === 'string' || i instanceof URL) i = rewrite(i); else if (i && i.url) i = new Request(rewrite(i.url), i); } catch (e) {} return f.call(this, i, o); }; } catch (e) {}
  try { var xo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, u) { var a = arguments; try { a[1] = rewrite(u); } catch (e) {} return xo.apply(this, a); }; } catch (e) {}
  try { var is = self.importScripts; if (is) self.importScripts = function () { var a = [].slice.call(arguments).map(rewrite); return is.apply(self, a); }; } catch (e) {}
  try {
    var WS = self.WebSocket, sec = ORIGIN.charAt(4) === 's';
    var PWS = function (u, p) { var abs = new URL(String(u), realBase).href.replace(/^http/i, 'ws'); var w = (sec ? 'wss://' : 'ws://') + self.location.host + toProxyAbs(abs); return p === undefined ? new WS(w) : new WS(w, p); };
    PWS.prototype = WS.prototype; self.WebSocket = PWS;
  } catch (e) {}
})();
