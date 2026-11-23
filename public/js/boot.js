// Runs before first paint: apply the saved theme variables so there is no flash of the default look.
(function () {
  try {
    var v = JSON.parse(localStorage.getItem('nbx.vars') || 'null');
    if (v) { var r = document.documentElement; for (var k in v) r.style.setProperty(k, v[k]); r.dataset.mode = localStorage.getItem('nbx.mode') || 'dark'; }
    var l = localStorage.getItem('nbx.lang'); if (l) document.documentElement.lang = l;
  } catch (e) {}
})();
// 13.8: service worker (installable app, offline page, push notifications).
(function () { try { if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) { addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); }); } } catch (e) {} })();
