/* Nebulix proxy runtime - injected as the first script of every proxied page.
   Virtualises URLs, location, cookies and storage so pages behave as if they were on their real origin. */
(function () {
  'use strict';
  var me = document.currentScript;
  if (!me || window.__nx$) return;
  var cfg;
  try { cfg = JSON.parse(decodeURIComponent(me.getAttribute('data-cfg'))); } catch (e) { return; }
  var PREFIX = cfg.prefix, ORIGIN = location.origin, APP = cfg.app;
  var realBase0 = new URL(cfg.base), realOrigin = realBase0.origin;
  var L = location;
  var SPECIAL = /^(?:#|data:|blob:|javascript:|mailto:|tel:|sms:|about:|magnet:|intent:)/i;
  function safe(fn) { try { fn(); } catch (e) { /* never break the page */ } }

  // ---------- URL helpers ----------
  function toProxyAbs(href) {
    var u; try { u = new URL(href); } catch (e) { return href; }
    var p = u.protocol;
    if (p !== 'http:' && p !== 'https:' && p !== 'ws:' && p !== 'wss:') return href;
    return PREFIX + p.slice(0, -1) + '/' + u.host + u.pathname + u.search + u.hash;
  }
  function fromProxy(url) {
    var u; try { u = new URL(String(url), ORIGIN); } catch (e) { return String(url); }
    if (u.origin !== ORIGIN) return u.href;
    if (u.pathname.indexOf(PREFIX) !== 0) return new URL(u.pathname + u.search + u.hash, realBase0).href;
    var rest = u.pathname.slice(PREFIX.length), i = rest.indexOf('/');
    if (i < 0) return u.href;
    var j = rest.indexOf('/', i + 1);
    return rest.slice(0, i) + '://' + (j < 0 ? rest.slice(i + 1) : rest.slice(i + 1, j)) + (j < 0 ? '/' : rest.slice(j)) + u.search + u.hash;
  }
  function curUrl() { return fromProxy(L.href); }
  function baseHref() { try { return cfg.baseHref ? new URL(cfg.baseHref, curUrl()).href : curUrl(); } catch (e) { return curUrl(); } }
  function rewrite(url, base) {
    if (url == null) return url;
    var s = String(url);
    if (s === '' || SPECIAL.test(s)) return s;
    if (s.charAt(0) === '/' && s.charAt(1) !== '/' && s.indexOf(PREFIX) === 0) return s;
    if (s.indexOf(ORIGIN + PREFIX) === 0) return s.slice(ORIGIN.length);
    var abs; try { abs = new URL(s, base || baseHref()).href; } catch (e) { return s; }
    if (abs.indexOf(ORIGIN + PREFIX) === 0) return abs.slice(ORIGIN.length);
    if (abs.indexOf(ORIGIN + '/') === 0) abs = new URL(abs.slice(ORIGIN.length), realBase0).href;
    return toProxyAbs(abs);
  }
  function unproxy(v) { return typeof v === 'string' && v.indexOf(ORIGIN + PREFIX) === 0 ? fromProxy(v) : v; }
  function rewriteSrcset(v) { return String(v).replace(/(\S+)(\s+[\d.]+[wx])?(\s*,\s*|\s*$)/g, function (m, u, d, sep) { return (SPECIAL.test(u) ? u : rewrite(u)) + (d || '') + sep; }); }
  function rewriteCssText(c) {
    return String(c).replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, function (m, q, u) { return /^(data:|#|blob:)/i.test(u.trim()) ? m : 'url(' + q + rewrite(u.trim()) + q + ')'; });
  }
  function post(m) { if (window.parent === window) return; (cfg.apps || [APP]).forEach(function (o) { try { window.parent.postMessage(m, o); } catch (e) {} }); }

  // ---------- fake location ----------
  var fake = {};
  function navigate(u, replace) {
    if (/^\s*javascript:/i.test(String(u))) return;
    var abs; try { abs = new URL(String(u), baseHref()).href; } catch (e) { return; }
    var cur = curUrl(), hi = abs.indexOf('#');
    // Nebulix keeps the back/forward list itself, so pages never add entries to the browser's real history
    if (hi >= 0 && abs.slice(0, hi) === cur.split('#')[0]) { L.replace(L.href.split('#')[0] + abs.slice(hi)); return; }
    L.replace(rewrite(abs)); void replace;
  }
  ['href', 'origin', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'].forEach(function (k) {
    Object.defineProperty(fake, k, {
      enumerable: true, configurable: true,
      get: function () { return new URL(curUrl())[k]; },
      set: function (v) { if (k === 'href') { navigate(v); return; } var u = new URL(curUrl()); u[k] = v; navigate(u.href); }
    });
  });
  fake.assign = function (u) { navigate(u); };
  fake.replace = function (u) { navigate(u, true); };
  fake.reload = function () { L.reload(); };
  fake.toString = function () { return curUrl(); };
  fake.valueOf = fake.toString;
  fake[Symbol.toPrimitive] = function () { return curUrl(); };
  var G = {};
  Object.defineProperty(G, 'location', { get: function () { return fake; }, set: function (v) { navigate(v); } });
  G.realOrigin = realOrigin; G.rewrite = rewrite; G.fromProxy = fromProxy; G.cfg = cfg;
  Object.defineProperty(window, '__nx$', { value: G, enumerable: false });
  var locAcc = { configurable: true, get: function () { return fake; }, set: function (v) { navigate(v); } };
  safe(function () { Object.defineProperty(window, '__nx$loc', locAcc); });
  safe(function () { Object.defineProperty(Document.prototype, '__nx$loc', locAcc); });

  function defGetter(proto, prop, fn) {
    var d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.get) return;
    Object.defineProperty(proto, prop, { configurable: true, enumerable: d.enumerable, get: fn, set: d.set });
  }
  safe(function () { defGetter(Document.prototype, 'URL', curUrl); defGetter(Document.prototype, 'documentURI', curUrl); });
  safe(function () { defGetter(Node.prototype, 'baseURI', baseHref); });
  safe(function () { defGetter(Document.prototype, 'referrer', function () { return cfg.ref || ''; }); });
  safe(function () { defGetter(Document.prototype, 'domain', function () { return new URL(curUrl()).hostname; }); });
  safe(function () { Object.defineProperty(window, 'origin', { configurable: true, get: function () { return realOrigin; } }); });

  // ---------- network ----------
  var _fetch = window.fetch;
  if (_fetch) {
    window.fetch = function (input, init) {
      try {
        if (typeof input === 'string' || (typeof URL !== 'undefined' && input instanceof URL)) input = rewrite(String(input));
        else if (input && input.url) input = new Request(rewrite(input.url), input);
      } catch (e) {}
      return _fetch.call(this, input, init);
    };
  }
  safe(function () {
    var xo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) { var a = arguments; try { a[1] = rewrite(u); } catch (e) {} return xo.apply(this, a); };
    var rd = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseURL');
    if (rd && rd.get) Object.defineProperty(XMLHttpRequest.prototype, 'responseURL', { configurable: true, enumerable: true, get: function () { var v = rd.get.call(this); return v ? fromProxy(v) : v; } });
  });
  safe(function () {
    var WS = window.WebSocket;
    var secure = ORIGIN.charAt(4) === 's';
    function PWS(url, proto) {
      var abs = new URL(String(url), baseHref()).href.replace(/^http/i, 'ws');
      var wsUrl = (secure ? 'wss://' : 'ws://') + L.host + toProxyAbs(abs);
      return proto === undefined ? new WS(wsUrl) : new WS(wsUrl, proto);
    }
    PWS.prototype = WS.prototype; PWS.CONNECTING = 0; PWS.OPEN = 1; PWS.CLOSING = 2; PWS.CLOSED = 3;
    window.WebSocket = PWS;
    var ud = Object.getOwnPropertyDescriptor(WS.prototype, 'url');
    if (ud && ud.get) Object.defineProperty(WS.prototype, 'url', { configurable: true, enumerable: true, get: function () { return fromProxy(ud.get.call(this).replace(/^ws/i, 'http')).replace(/^http/i, 'ws'); } });
  });
  safe(function () {
    var ES = window.EventSource; if (!ES) return;
    function PES(url, o) { return new ES(rewrite(url), o); }
    PES.prototype = ES.prototype; PES.CONNECTING = 0; PES.OPEN = 1; PES.CLOSED = 2; window.EventSource = PES;
  });
  safe(function () { var sb = navigator.sendBeacon; if (sb) navigator.sendBeacon = function (u, d) { return sb.call(navigator, rewrite(u), d); }; });
  ['Worker', 'SharedWorker'].forEach(function (nm) {
    safe(function () {
      var W = window[nm]; if (!W) return;
      window[nm] = function (url, opts) { var u = String(url); if (!/^(blob|data):/i.test(u)) u = rewrite(u); return opts === undefined ? new W(u) : new W(u, opts); };
      window[nm].prototype = W.prototype;
    });
  });
  safe(function () {
    var wo = window.open;
    window.open = function (url, target, features) {
      var u = url == null || url === '' ? 'about:blank' : String(url);
      if (u === 'about:blank') return wo.call(window, u, target, features);
      var abs; try { abs = new URL(u, baseHref()).href; } catch (e) { return null; }
      post({ nx: 1, t: 'open', url: abs });
      return { closed: false, close: function () {}, focus: function () {}, blur: function () {}, postMessage: function () {}, location: { href: abs } };
    };
  });

  // ---------- DOM URL properties ----------
  function hookProp(proto, prop, kind) {
    safe(function () {
      var d = Object.getOwnPropertyDescriptor(proto, prop);
      if (!d || !d.get || !d.set) return;
      Object.defineProperty(proto, prop, {
        configurable: true, enumerable: d.enumerable,
        get: function () { return unproxy(d.get.call(this)); },
        set: function (v) { d.set.call(this, kind === 'srcset' ? rewriteSrcset(v) : rewrite(v)); }
      });
    });
  }
  [['HTMLAnchorElement', 'href'], ['HTMLAreaElement', 'href'], ['HTMLLinkElement', 'href'], ['HTMLImageElement', 'src'], ['HTMLScriptElement', 'src'],
   ['HTMLIFrameElement', 'src'], ['HTMLMediaElement', 'src'], ['HTMLSourceElement', 'src'], ['HTMLTrackElement', 'src'], ['HTMLEmbedElement', 'src'],
   ['HTMLObjectElement', 'data'], ['HTMLInputElement', 'src'], ['HTMLFormElement', 'action'], ['HTMLVideoElement', 'poster'], ['HTMLInputElement', 'formAction'], ['HTMLButtonElement', 'formAction']]
    .forEach(function (x) { if (window[x[0]]) hookProp(window[x[0]].prototype, x[1]); });
  hookProp(HTMLImageElement.prototype, 'srcset', 'srcset');
  hookProp(HTMLSourceElement.prototype, 'srcset', 'srcset');
  safe(function () {
    ['origin', 'protocol', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'].forEach(function (k) {
      var d = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, k); if (!d || !d.get) return;
      Object.defineProperty(HTMLAnchorElement.prototype, k, {
        configurable: true, enumerable: true,
        get: function () { try { return new URL(this.href)[k]; } catch (e) { return d.get.call(this); } },
        set: function (v) { try { var u = new URL(this.href); u[k] = v; this.href = u.href; } catch (e) {} }
      });
    });
  });
  var URLATTR = { href: 1, src: 1, action: 1, poster: 1, data: 1, formaction: 1, background: 1, 'xlink:href': 1 };
  var sa = Element.prototype.setAttribute, ga = Element.prototype.getAttribute;
  safe(function () {
    Element.prototype.setAttribute = function (name, value) {
      try {
        var n = String(name).toLowerCase();
        if (URLATTR[n] && !(n === 'data' && this.tagName !== 'OBJECT')) value = rewrite(value);
        else if (n === 'srcset' || n === 'imagesrcset') value = rewriteSrcset(value);
        else if (n === 'style') value = rewriteCssText(value);
        else if (n === 'integrity' || n === 'nonce') return;
      } catch (e) {}
      return sa.call(this, name, value);
    };
    Element.prototype.getAttribute = function (name) {
      var v = ga.call(this, name);
      try { if (v && URLATTR[String(name).toLowerCase()] && v.indexOf(PREFIX) === 0) return fromProxy(v); } catch (e) {}
      return v;
    };
  });

  // elements created through innerHTML & friends bypass the setters: fix them after insertion
  var FIX = ['href', 'src', 'action', 'poster', 'formaction', 'srcset'];
  function needsFix(v) { return v && !SPECIAL.test(v) && v.indexOf(PREFIX) !== 0 && v.indexOf(ORIGIN + PREFIX) !== 0; }
  function fixEl(el) {
    if (el.nodeType !== 1) return;
    for (var i = 0; i < FIX.length; i++) {
      var v = ga.call(el, FIX[i]);
      if (needsFix(v)) sa.call(el, FIX[i], FIX[i] === 'srcset' ? rewriteSrcset(v) : rewrite(v));
    }
    if (el.tagName === 'STYLE' && el.textContent && el.textContent.indexOf('url(') >= 0 && !el.__nxs) { el.__nxs = 1; el.textContent = rewriteCssText(el.textContent); }
    var st = ga.call(el, 'style');
    if (st && st.indexOf('url(') >= 0 && st.indexOf(PREFIX) < 0) sa.call(el, 'style', st);
  }
  safe(function () {
    var mo = new MutationObserver(function (recs) {
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        if (r.type === 'attributes') { fixEl(r.target); continue; }
        for (var j = 0; j < r.addedNodes.length; j++) {
          var n = r.addedNodes[j];
          if (n.nodeType !== 1) continue;
          fixEl(n);
          if (n.querySelectorAll) { var all = n.querySelectorAll('[href],[src],[action],[poster],[srcset],style,[style]'); for (var k = 0; k < all.length; k++) fixEl(all[k]); }
        }
      }
    });
    mo.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'src', 'action', 'poster', 'srcset', 'formaction'] });
  });

  // ---------- cookies (document.cookie is mirrored with the server-side jar) ----------
  var jar = {};
  (cfg.cookies || '').split('; ').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) jar[kv.slice(0, i)] = kv.slice(i + 1); });
  safe(function () {
    Object.defineProperty(Document.prototype, 'cookie', {
      configurable: true, enumerable: true,
      get: function () { return Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; '); },
      set: function (v) {
        v = String(v);
        var first = v.split(';')[0], i = first.indexOf('=');
        var name = i < 0 ? '' : first.slice(0, i).trim(), val = i < 0 ? first.trim() : first.slice(i + 1).trim();
        var ex = /;\s*expires=([^;]+)/i.exec(v), ma = /;\s*max-age=(-?\d+)/i.exec(v);
        if ((ma && parseInt(ma[1], 10) <= 0) || (!ma && ex && Date.parse(ex[1]) < Date.now())) delete jar[name]; else jar[name] = val;
        try { _fetch.call(window, PREFIX + '__cookie', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: curUrl(), cookie: v }) }); } catch (e) {}
      }
    });
  });

  // ---------- storage isolation (all proxied sites share one browser origin; keep them apart) ----------
  var pre = realOrigin + '\u0001';
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    safe(function () {
      var real = window[name]; void real.length;
      function keys() { var o = []; for (var i = 0; i < real.length; i++) { var k = real.key(i); if (k.indexOf(pre) === 0) o.push(k.slice(pre.length)); } return o; }
      var api = {
        getItem: function (k) { return real.getItem(pre + k); },
        setItem: function (k, v) { real.setItem(pre + k, v); },
        removeItem: function (k) { real.removeItem(pre + k); },
        clear: function () { keys().forEach(function (k) { real.removeItem(pre + k); }); },
        key: function (i) { var k = keys()[i]; return k === undefined ? null : k; }
      };
      var p = new Proxy(api, {
        get: function (t, k) { if (k === 'length') return keys().length; if (typeof k === 'symbol') return k === Symbol.toStringTag ? 'Storage' : undefined; if (Object.prototype.hasOwnProperty.call(api, k)) return api[k]; var v = real.getItem(pre + k); return v === null ? undefined : v; },
        set: function (t, k, v) { real.setItem(pre + String(k), String(v)); return true; },
        deleteProperty: function (t, k) { real.removeItem(pre + String(k)); return true; },
        has: function (t, k) { return Object.prototype.hasOwnProperty.call(api, k) || real.getItem(pre + String(k)) !== null; },
        ownKeys: function () { return keys(); },
        getOwnPropertyDescriptor: function (t, k) { var v = real.getItem(pre + String(k)); return v === null ? undefined : { value: v, writable: true, enumerable: true, configurable: true }; }
      });
      Object.defineProperty(window, name, { configurable: true, get: function () { return p; } });
    });
  });
  safe(function () {
    if (!window.indexedDB) return;
    var io = IDBFactory.prototype.open, dd = IDBFactory.prototype.deleteDatabase;
    IDBFactory.prototype.open = function (n) { var a = arguments; a[0] = pre + n; return io.apply(this, a); };
    IDBFactory.prototype.deleteDatabase = function (n) { var a = arguments; a[0] = pre + n; return dd.apply(this, a); };
    if (IDBFactory.prototype.databases) {
      var db = IDBFactory.prototype.databases;
      IDBFactory.prototype.databases = function () { return db.call(this).then(function (l) { return l.filter(function (x) { return x.name.indexOf(pre) === 0; }).map(function (x) { return { name: x.name.slice(pre.length), version: x.version }; }); }); };
    }
    defGetter(IDBDatabase.prototype, 'name', (function () { var d = Object.getOwnPropertyDescriptor(IDBDatabase.prototype, 'name'); return function () { var v = d.get.call(this); return v.indexOf(pre) === 0 ? v.slice(pre.length) : v; }; })());
  });
  safe(function () { var BC = window.BroadcastChannel; if (!BC) return; function PBC(n) { return new BC(pre + n); } PBC.prototype = BC.prototype; window.BroadcastChannel = PBC; });
  safe(function () {
    if (!window.caches) return;
    var co = CacheStorage.prototype.open, ch = CacheStorage.prototype.has, cd = CacheStorage.prototype.delete;
    CacheStorage.prototype.open = function (n) { return co.call(this, pre + n); };
    CacheStorage.prototype.has = function (n) { return ch.call(this, pre + n); };
    CacheStorage.prototype.delete = function (n) { return cd.call(this, pre + n); };
  });
  safe(function () { if (navigator.serviceWorker) navigator.serviceWorker.register = function () { return Promise.reject(new DOMException('Service workers are disabled in Nebulix', 'SecurityError')); }; });

  // ---------- find in page (driven by the app's find bar over postMessage) ----------
  var nxFind = (function () {
    var marks = [], cur = -1, styleEl = null;
    var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1, MARK: 1, HEAD: 1 };
    function ensureStyle() {
      if (styleEl && styleEl.isConnected) return;
      styleEl = document.createElement('style');
      styleEl.textContent = '.__nxfind{background:#ffe066;color:#000;border-radius:2px;padding:0 1px}.__nxfind.__nxcur{background:#ff9f1a;box-shadow:0 0 0 2px rgba(255,159,26,.6)}';
      (document.head || document.documentElement).appendChild(styleEl);
    }
    function clear() {
      for (var i = 0; i < marks.length; i++) { var m = marks[i], p = m.parentNode; if (!p) continue; try { p.replaceChild(document.createTextNode(m.textContent), m); p.normalize(); } catch (e) {} }
      marks = []; cur = -1;
    }
    function wrapNode(node, needle) {
      var text = node.nodeValue, low = text.toLowerCase(), idx, from = 0, frag = document.createDocumentFragment(), any = false;
      while ((idx = low.indexOf(needle, from)) >= 0 && marks.length < 2000) {
        any = true;
        if (idx > from) frag.appendChild(document.createTextNode(text.slice(from, idx)));
        var mk = document.createElement('mark'); mk.className = '__nxfind'; mk.textContent = text.slice(idx, idx + needle.length);
        frag.appendChild(mk); marks.push(mk); from = idx + needle.length;
      }
      if (!any) return;
      if (from < text.length) frag.appendChild(document.createTextNode(text.slice(from)));
      if (node.parentNode) node.parentNode.replaceChild(frag, node);
    }
    function paintCur(scroll) {
      for (var i = 0; i < marks.length; i++) marks[i].className = '__nxfind' + (i === cur ? ' __nxcur' : '');
      if (scroll && cur >= 0 && marks[cur]) try { marks[cur].scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
    }
    function report() { post({ nx: 1, t: 'find', count: marks.length, index: marks.length ? cur + 1 : 0 }); }
    function search(q) {
      clear();
      if (!q) { report(); return; }
      ensureStyle();
      var needle = q.toLowerCase(), body = document.body; if (!body) { report(); return; }
      var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          if (!n.nodeValue || n.nodeValue.toLowerCase().indexOf(needle) < 0) return NodeFilter.FILTER_REJECT;
          var p = n.parentNode; if (!p || SKIP[p.nodeName]) return NodeFilter.FILTER_REJECT;
          if (p.offsetParent === null && p.nodeName !== 'BODY') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var nodes = [], n;
      while ((n = walker.nextNode()) && nodes.length < 5000) nodes.push(n);
      for (var i = 0; i < nodes.length && marks.length < 2000; i++) wrapNode(nodes[i], needle);
      cur = marks.length ? 0 : -1; paintCur(true); report();
    }
    function step(dir) { if (!marks.length) return; cur = (cur + dir + marks.length) % marks.length; paintCur(true); report(); }
    return { search: search, step: step, clear: function () { clear(); report(); } };
  })();

  // ---------- dark mode (a "dark reader"-style smart invert, toggled from the app) ----------
  var nxDark = (function () {
    var el = null, on = false;
    var CSS = 'html{filter:invert(1) hue-rotate(180deg)!important;background:#0e0e0e!important}'
      + 'img,picture,video,canvas,svg,iframe,embed,object,[style*="background-image"],[style*="background: url"],[style*="background:url"]{filter:invert(1) hue-rotate(180deg)!important}';
    function mount() { if (!el) { el = document.createElement('style'); el.id = '__nxdark'; el.textContent = CSS; } if (!el.isConnected) (document.head || document.documentElement).appendChild(el); }
    function apply(v) { on = !!v; if (on) mount(); else if (el && el.parentNode) el.parentNode.removeChild(el); }
    return { apply: apply, reapply: function () { if (on) mount(); } };
  })();

  // ---------- selection toolbar (translate / search / copy over selected text; the app does the work) ----------
  var nxTr = (function () {
    var bar = null, tip = null, styleEl = null, lastText = '', curRect = null;
    var labels = { translate: 'Translate', search: 'Search', copy: 'Copy', copied: 'Copied' };
    var bTr, bSe, bCo;
    function ensure() {
      if (styleEl && styleEl.isConnected) return;
      styleEl = document.createElement('style'); styleEl.id = '__nxtrst';
      styleEl.textContent = '#__nxtrbar,#__nxtrtip{position:fixed;z-index:2147483646;transform:translate(-50%,8px);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;box-sizing:border-box}'
        + '#__nxtrbar{display:none;background:#111;border-radius:10px;padding:3px;box-shadow:0 6px 20px rgba(0,0,0,.5);gap:1px}'
        + '#__nxtrbar button{background:none;border:0;color:#fff;font:600 12px system-ui,sans-serif;padding:6px 10px;border-radius:7px;cursor:pointer}'
        + '#__nxtrbar button:hover{background:rgba(255,255,255,.14)}'
        + '#__nxtrtip{max-width:min(340px,80vw);background:#141414;color:#f4f4f5;border-radius:11px;padding:9px 12px;font-size:13.5px;line-height:1.45;box-shadow:0 10px 30px rgba(0,0,0,.55);display:none}'
        + '#__nxtrtip b{display:block;font-size:10px;letter-spacing:.05em;opacity:.55;margin-bottom:3px;font-weight:700}';
      (document.head || document.documentElement).appendChild(styleEl);
    }
    function mkBtn(key, fn) { var b = document.createElement('button'); b.type = 'button'; b.textContent = labels[key]; b.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }); b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); fn(); }); return b; }
    function mk() {
      ensure();
      if (!bar) { bar = document.createElement('div'); bar.id = '__nxtrbar'; bTr = mkBtn('translate', doTr); bSe = mkBtn('search', doSe); bCo = mkBtn('copy', doCo); bar.appendChild(bTr); bar.appendChild(bSe); bar.appendChild(bCo); document.documentElement.appendChild(bar); }
      if (!tip) { tip = document.createElement('div'); tip.id = '__nxtrtip'; document.documentElement.appendChild(tip); }
    }
    function place(el, r) { el.style.left = Math.max(80, Math.min(window.innerWidth - 80, r.left + r.width / 2)) + 'px'; el.style.top = Math.min(window.innerHeight - 60, r.bottom) + 'px'; }
    function inField(n) { while (n && n !== document) { if (n.nodeType === 1 && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.isContentEditable)) return true; n = n.parentNode; } return false; }
    function hide() { if (bar) bar.style.display = 'none'; if (tip) tip.style.display = 'none'; }
    function onUp() {
      setTimeout(function () {
        var s = window.getSelection(); var txt = s ? String(s).trim() : '';
        if (!txt || txt.length > 800 || !s.rangeCount || (s.anchorNode && inField(s.anchorNode))) { hide(); return; }
        var r = s.getRangeAt(0).getBoundingClientRect(); if (!r || !r.width) { hide(); return; }
        mk(); lastText = txt; curRect = r; tip.style.display = 'none'; place(bar, r); bar.style.display = 'inline-flex';
      }, 1);
    }
    function doTr() { if (!lastText) return; bar.style.display = 'none'; mk(); tip.textContent = '…'; if (curRect) place(tip, curRect); tip.style.display = 'block'; post({ nx: 1, t: 'translate', text: lastText }); }
    function doSe() { if (!lastText) return; hide(); post({ nx: 1, t: 'search', text: lastText }); }
    function doCo() { if (!lastText) return; var ok = function () { bCo.textContent = labels.copied; setTimeout(hide, 650); }; try { navigator.clipboard.writeText(lastText).then(ok, hide); } catch (e) { hide(); } }
    function translated(res) {
      mk(); if (!curRect) return;
      if (res.error) { tip.textContent = res.error; }
      else { tip.innerHTML = ''; var b = document.createElement('b'); b.textContent = (res.from ? String(res.from).toUpperCase() + ' → ' : '') + (res.to ? String(res.to).toUpperCase() : ''); var d = document.createElement('div'); d.textContent = res.text || ''; tip.appendChild(b); tip.appendChild(d); }
      place(tip, curRect); tip.style.display = 'block';
    }
    document.addEventListener('mouseup', onUp, true);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    document.addEventListener('mousedown', function (e) { if (bar && bar.contains(e.target)) return; if (tip && tip.contains(e.target)) return; hide(); }, true);
    return { translated: translated, setLabels: function (l) { if (!l) return; for (var k in l) if (l[k]) labels[k] = l[k]; if (bTr) { bTr.textContent = labels.translate; bSe.textContent = labels.search; bCo.textContent = labels.copy; } } };
  })();

  // ---------- media speed control (driven from the app toolbar; applies to proxied <video>/<audio>) ----------
  var nxMedia = (function () {
    var lastHas = null, rate = 1;
    function all() { return [].slice.call(document.querySelectorAll('video,audio')); }
    function target() {
      var m = all(); var playing = m.filter(function (x) { return !x.paused && !x.ended; }); if (playing.length) return playing[0];
      var vids = m.filter(function (x) { return x.tagName === 'VIDEO' && x.offsetParent; }); if (vids.length) return vids.sort(function (a, b) { return (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight); })[0];
      return m[0] || null;
    }
    function has() { return all().some(function (x) { return x.readyState > 0 || x.currentSrc || x.getAttribute('src') || x.querySelector('source'); }); }
    function report() { var t = target(); post({ nx: 1, t: 'media', has: has(), rate: rate, muted: t ? !!t.muted : false, paused: t ? !!t.paused : true, time: t ? (t.currentTime || 0) : 0, dur: t && isFinite(t.duration) ? t.duration : 0 }); }
    function check() {
      all().forEach(function (x) {
        if (rate !== 1 && x.playbackRate !== rate) try { x.playbackRate = rate; } catch (e) {}
        if (x.tagName === 'VIDEO' && !x.__nxpipl) { x.__nxpipl = 1; x.addEventListener('enterpictureinpicture', function () { post({ nx: 1, t: 'pip', active: true }); }); x.addEventListener('leavepictureinpicture', function () { post({ nx: 1, t: 'pip', active: false }); }); }
      });
      var h = has(); if (h !== lastHas) { lastHas = h; report(); }
    }
    function setSpeed(v) { rate = v || 1; all().forEach(function (x) { try { x.playbackRate = rate; } catch (e) {} }); report(); }
    function cmd(d) {
      var t;
      if (d.cmd === 'speed') { setSpeed(Number(d.v) || 1); return; }
      if (d.cmd === 'skip') { t = target(); if (t) try { t.currentTime = Math.max(0, Math.min((t.duration || 1e9), (t.currentTime || 0) + (Number(d.v) || 0))); } catch (e) {} }
      else if (d.cmd === 'mute') { t = target(); if (t) try { t.muted = !t.muted; } catch (e) {} }
      else if (d.cmd === 'playpause') { t = target(); if (t) { try { if (t.paused) t.play(); else t.pause(); } catch (e) {} } setTimeout(report, 60); return; }
      report();
    }
    return { check: check, cmd: cmd };
  })();

  // ---------- picture-in-picture (a button appears over videos on hover; the in-page click is a real gesture) ----------
  var nxPip = (function () {
    if (!('pictureInPictureEnabled' in document) || !document.pictureInPictureEnabled) return { setLabel: function () {} };
    var btn = null, cur = null, styleEl = null, label = 'Picture-in-picture', hideT = 0;
    function ensure() { if (styleEl && styleEl.isConnected) return; styleEl = document.createElement('style'); styleEl.id = '__nxpipst'; styleEl.textContent = '#__nxpip{position:fixed;z-index:2147483646;display:none;align-items:center;gap:5px;background:rgba(0,0,0,.72);color:#fff;border:0;border-radius:8px;padding:6px 10px;font:600 12px system-ui,-apple-system,sans-serif;cursor:pointer}#__nxpip:hover{background:#000}'; (document.head || document.documentElement).appendChild(styleEl); }
    function mk() { ensure(); if (btn) return; btn = document.createElement('button'); btn.id = '__nxpip'; btn.type = 'button'; btn.textContent = '⎘ ' + label; btn.addEventListener('mousedown', stop); btn.addEventListener('click', function (e) { stop(e); toggle(); }); btn.addEventListener('mouseenter', function () { clearTimeout(hideT); }); btn.addEventListener('mouseleave', schedule); document.documentElement.appendChild(btn); }
    function stop(e) { e.preventDefault(); e.stopPropagation(); }
    function eligible(v) { return v && v.tagName === 'VIDEO' && !v.disablePictureInPicture && v.readyState > 0 && v.videoWidth > 0 && v.clientWidth >= 140 && v.clientHeight >= 90; }
    function pos() { if (!cur || !btn) return; var r = cur.getBoundingClientRect(); btn.style.left = (r.right - btn.offsetWidth - 10) + 'px'; btn.style.top = (r.top + 10) + 'px'; }
    function show(v) { mk(); cur = v; clearTimeout(hideT); btn.style.display = 'inline-flex'; pos(); pos(); }
    function schedule() { clearTimeout(hideT); hideT = setTimeout(function () { if (btn) btn.style.display = 'none'; cur = null; }, 260); }
    function toggle() { if (!cur) return; try { if (document.pictureInPictureElement) document.exitPictureInPicture(); else cur.requestPictureInPicture().catch(function () {}); } catch (e) {} }
    document.addEventListener('mouseover', function (e) { if (eligible(e.target)) show(e.target); else if (btn && e.target === btn) clearTimeout(hideT); }, true);
    document.addEventListener('mouseout', function (e) { if (e.target === cur || e.target === btn) { var to = e.relatedTarget; if (to === btn || to === cur) { clearTimeout(hideT); return; } schedule(); } }, true);
    document.addEventListener('scroll', function () { if (cur && btn && btn.style.display !== 'none') pos(); }, true);
    window.addEventListener('resize', schedule);
    return { setLabel: function (l) { label = l || label; if (btn) btn.textContent = '⎘ ' + label; } };
  })();

  // ---------- history, messaging ----------
  var lastSig = '';
  function iconUrl() { var l = document.querySelector('link[rel~="icon"]'); try { return l ? l.href : new URL('/favicon.ico', curUrl()).href; } catch (e) { return ''; } }
  function notify(force) {
    nxDark.reapply(); nxMedia.check();
    var sig = curUrl() + '|' + document.title + '|' + document.readyState;
    if (!force && sig === lastSig) return;
    lastSig = sig;
    post({ nx: 1, t: 'nav', url: curUrl(), title: document.title || '', icon: iconUrl(), loading: document.readyState !== 'complete' });
  }
  safe(function () { History.prototype.__nxReplace = History.prototype.replaceState; });
  ['pushState', 'replaceState'].forEach(function (k) {
    safe(function () {
      var o = History.prototype[k];
      History.prototype[k] = function (s, t, u) {
        var a = arguments;
        if (u != null && u !== '') { try { a[2] = rewrite(u, curUrl()); } catch (e) {} }
        var r = (k === 'pushState' ? History.prototype.__nxReplace : o).apply(this, a); notify(); return r;
      };
    });
  });
  safe(function () {
    var pm = window.postMessage;
    window.postMessage = function (msg, target) {
      var a = arguments;
      if (typeof target === 'string' && target !== '*' && target !== '/') a[1] = '*';
      else if (target && typeof target === 'object' && target.targetOrigin && target.targetOrigin !== '*' && target.targetOrigin !== '/') a[1] = Object.assign({}, target, { targetOrigin: '*' });
      return pm.apply(this, a);
    };
    defGetter(MessageEvent.prototype, 'origin', (function () {
      var d = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'origin');
      return function () { var o = d.get.call(this); try { var s = this.source; if (o === ORIGIN && s && s.__nx$) return s.__nx$.realOrigin; } catch (e) {} return o; };
    })());
  });
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href],area[href]') : null;
    if (!a) return;
    var t = (ga.call(a, 'target') || '').toLowerCase();
    if (!t || t === '_self') return;
    var href = a.href;
    if (SPECIAL.test(href)) return;
    if (t === '_top' || t === '_parent') { e.preventDefault(); navigate(href); return; }
    if (t === '_blank' || !(window.frames && window.frames[t])) { e.preventDefault(); post({ nx: 1, t: 'open', url: href }); }
  }, true);
  window.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href],area[href]') : null;
    if (!a || a.hasAttribute('download')) return;
    var t = (ga.call(a, 'target') || '').toLowerCase(); if (t && t !== '_self') return;
    var raw = ga.call(a, 'href') || ''; if (/^\s*(javascript:|mailto:|tel:|sms:|data:|blob:|magnet:|intent:)/i.test(raw)) return;
    e.preventDefault(); navigate(a.href, true);
  }, false);
  window.addEventListener('submit', function (e) {
    var f = e.target; if (e.defaultPrevented || !f || f.tagName !== 'FORM') return;
    if ((f.getAttribute('method') || 'get').toLowerCase() !== 'get' || (f.target && f.target !== '_self')) return;
    try { var u = new URL(f.action || curUrl(), baseHref()); var fd = new FormData(f); if (e.submitter && e.submitter.name) fd.append(e.submitter.name, e.submitter.value || ''); u.search = new URLSearchParams(fd).toString(); e.preventDefault(); navigate(u.href, true); } catch (x) {}
  }, false);
  document.addEventListener('submit', function (e) {
    var f = e.target; if (f && f.tagName === 'FORM' && /^_(blank|top|parent)$/i.test(f.target || '')) f.target = '_self';
  }, true);
  document.addEventListener('securitypolicyviolation', function (e) { try { console.debug('[Nebulix] blocked a direct (non-proxied) request to', e.blockedURI); } catch (x) {} });
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var d = e.data; if (!d || d.nx !== 1) return;
    if (d.t === 'cmd') {
      if (d.cmd === 'back') history.back(); else if (d.cmd === 'forward') history.forward();
      else if (d.cmd === 'reload') L.reload(); else if (d.cmd === 'stop') window.stop();
    } else if (d.t === 'zoom') { document.documentElement.style.zoom = String(d.v || 1); }
    else if (d.t === 'find') { if (d.close) nxFind.clear(); else if (typeof d.step === 'number') nxFind.step(d.step); else nxFind.search(String(d.q || '')); }
    else if (d.t === 'dark') { nxDark.apply(d.on); }
    else if (d.t === 'translated') { nxTr.translated(d); }
    else if (d.t === 'sellabels') { nxTr.setLabels(d.labels); }
    else if (d.t === 'media') { nxMedia.cmd(d); }
    else if (d.t === 'piplabel') { nxPip.setLabel(String(d.label || '')); }
  });
  ['popstate', 'hashchange', 'load', 'DOMContentLoaded', 'readystatechange'].forEach(function (ev) { (ev === 'readystatechange' ? document : window).addEventListener(ev, function () { notify(); }); });
  setInterval(notify, 1000);

  // ---------- Chrome-extension compatibility shim (content scripts only) ----------
  G.ext = function (id, meta, fn, runAt) {
    var chrome = makeChrome(id, meta || {});
    var run = function () { try { fn.call(window, chrome, chrome); } catch (e) { try { console.error('[Nebulix ext ' + (meta && meta.name || id) + ']', e); } catch (x) {} } };
    if (runAt === 'document_start' || document.readyState === 'complete') run();
    else if (runAt === 'document_end') { if (document.readyState !== 'loading') run(); else document.addEventListener('DOMContentLoaded', run); }
    else if (document.readyState !== 'loading') setTimeout(run, 0); else document.addEventListener('DOMContentLoaded', function () { setTimeout(run, 0); });
  };
  function makeChrome(id, meta) {
    var P = 'nx-ext:' + id + ':';
    function norm(keys) { if (keys == null) return null; if (typeof keys === 'string') return [keys]; if (Array.isArray(keys)) return keys; return Object.keys(keys); }
    function area() {
      function call(fn, cb) { try { var r = fn(); if (cb) { setTimeout(function () { cb(r); }, 0); return undefined; } return Promise.resolve(r); } catch (e) { if (cb) cb(); return Promise.resolve(); } }
      return {
        get: function (keys, cb) {
          return call(function () {
            var out = {}, ks = norm(keys), defs = keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
            if (ks === null) { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k.indexOf(P) === 0) ks = (ks || []).concat(k.slice(P.length)); } ks = ks || []; }
            ks.forEach(function (k) { var v = localStorage.getItem(P + k); out[k] = v === null ? defs[k] : JSON.parse(v); if (out[k] === undefined) delete out[k]; });
            return out;
          }, cb);
        },
        set: function (o, cb) { return call(function () { Object.keys(o).forEach(function (k) { localStorage.setItem(P + k, JSON.stringify(o[k])); }); }, cb); },
        remove: function (keys, cb) { return call(function () { norm(keys).forEach(function (k) { localStorage.removeItem(P + k); }); }, cb); },
        clear: function (cb) { return call(function () { var rm = []; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k.indexOf(P) === 0) rm.push(k); } rm.forEach(function (k) { localStorage.removeItem(k); }); }, cb); }
      };
    }
    var noop = function () {}; var ev = { addListener: noop, removeListener: noop, hasListener: function () { return false; } };
    var url = function (p) { p = String(p).replace(/^\//, ''); return (meta.files && meta.files[p]) || ''; };
    return {
      runtime: { id: id, getURL: url, getManifest: function () { return meta.manifest || {}; }, lastError: null, onMessage: ev, onInstalled: ev, connect: function () { return { postMessage: noop, disconnect: noop, onMessage: ev, onDisconnect: ev }; }, sendMessage: function () { var cb = arguments[arguments.length - 1]; if (typeof cb === 'function') setTimeout(cb, 0); return Promise.resolve(); } },
      extension: { getURL: url }, storage: { local: area(), sync: area(), onChanged: ev },
      i18n: { getMessage: function (k) { return (meta.messages && meta.messages[k] && meta.messages[k].message) || k; }, getUILanguage: function () { return navigator.language; } }
    };
  }

  post({ nx: 1, t: 'ready' });
  notify(true);
})();
