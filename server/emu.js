'use strict';
// Nebulix 13.4 — retro console emulator page, served ONLY on the separate games origin (no cookies, no API, no account):
// it runs EmulatorJS (open source, GPLv3, https://emulatorjs.org) from its public CDN. The Nebulix page sends the game
// file the player chose with postMessage; nothing is uploaded anywhere.
const EJS = 'https://cdn.emulatorjs.org/4.2.3/data/';
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nebulix Retro</title>
<style>html,body{margin:0;height:100%;background:#000;color:#ddd;font:14px system-ui}#game{width:100%;height:100%}#wait{position:fixed;inset:0;display:grid;place-items:center;text-align:center;padding:20px}</style></head>
<body><div id="wait">Waiting for a game…</div><div id="game"></div>
<script>
(function(){var started=false;addEventListener('message',function(e){var d=e.data;if(started||!d||d.nxEmu!==1||!(d.file instanceof Blob))return;started=true;document.getElementById('wait').remove();
window.EJS_player='#game';window.EJS_core=String(d.core||'nes');window.EJS_gameName=String(d.name||'game').slice(0,80);window.EJS_gameUrl=URL.createObjectURL(d.file);
window.EJS_pathtodata=${JSON.stringify(EJS)};window.EJS_startOnLoaded=true;window.EJS_color='#5b8def';window.EJS_language=d.lang==='es'?'es-ES':'en-US';window.EJS_disableDatabases=true;
if(d.bios instanceof Blob)window.EJS_biosUrl=URL.createObjectURL(d.bios);
var s=document.createElement('script');s.src=${JSON.stringify(EJS + 'loader.js')};document.body.appendChild(s)});
if(parent!==window)parent.postMessage({nxEmuReady:1},'*')})();
</script></body></html>`;
const CSP = `default-src 'self' blob: data: ${EJS}; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://cdn.emulatorjs.org; connect-src blob: data: https://cdn.emulatorjs.org; worker-src blob: https://cdn.emulatorjs.org; img-src blob: data: https://cdn.emulatorjs.org; style-src 'unsafe-inline' https://cdn.emulatorjs.org; media-src blob: data:; font-src data: https://cdn.emulatorjs.org; frame-ancestors *`;
function serve(req, res) {
  const body = Buffer.from(PAGE);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache', 'Cross-Origin-Resource-Policy': 'cross-origin' });
  res.end(req.method === 'HEAD' ? undefined : body);
}
module.exports = { serve };
