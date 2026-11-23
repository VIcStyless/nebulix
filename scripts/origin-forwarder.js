#!/usr/bin/env node
'use strict';
// Second public hostname for Nebulix in the cloud.
// Nebulix needs TWO hostnames (the app, and an isolated origin for proxied websites) but a cloud app usually gets one.
// This tiny server is deployed as a second app: it passes every request and WebSocket straight to the main Nebulix
// server over the provider's private network, with the Host header set to this app's public name, so Nebulix treats
// it as the proxy origin. It holds no data and no secrets.
//   TARGET_HOST / TARGET_PORT  → the main app on the private network (e.g. nebulix.internal : 3000)
//   PUBLIC_HOST                → this app's public hostname (e.g. nebulix-px.fly.dev)
const http = require('http');
const net = require('net');

const TARGET_HOST = process.env.TARGET_HOST; const TARGET_PORT = parseInt(process.env.TARGET_PORT, 10) || 3000;
const PUBLIC_HOST = String(process.env.PUBLIC_HOST || '').toLowerCase(); const PORT = parseInt(process.env.PORT, 10) || 8080;
if (!TARGET_HOST || !PUBLIC_HOST) { console.error('origin-forwarder: set TARGET_HOST and PUBLIC_HOST'); process.exit(1); }

const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade']);
function headersFor(req, keepUpgrade) {
  const out = {};
  for (const [k, v] of Object.entries(req.headers)) { if (!keepUpgrade && HOP.has(k)) continue; out[k] = v; }
  out.host = PUBLIC_HOST;
  const ip = req.headers['fly-client-ip'] || req.socket.remoteAddress || '';
  out['x-forwarded-for'] = ip; out['x-forwarded-proto'] = 'https';
  delete out['cf-connecting-ip'];
  return out;
}

const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
const server = http.createServer((req, res) => {
  const up = http.request({ host: TARGET_HOST, port: TARGET_PORT, method: req.method, path: req.url, headers: headersFor(req, false), agent }, (r) => {
    const h = Object.assign({}, r.headers); delete h.connection; delete h['keep-alive'];
    res.writeHead(r.statusCode, r.statusMessage, h); r.pipe(res);
    r.on('error', () => res.destroy());
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('Nebulix is starting up — try again in a moment.'); });
  req.on('aborted', () => up.destroy()); res.on('close', () => up.destroy());
  req.pipe(up);
});

// WebSockets: replay the upgrade request on a raw socket and splice the two together.
server.on('upgrade', (req, socket, head) => {
  const up = net.connect(TARGET_PORT, TARGET_HOST, () => {
    const h = headersFor(req, true);
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (const [k, v] of Object.entries(h)) for (const x of (Array.isArray(v) ? v : [v])) raw += `${k}: ${x}\r\n`;
    up.write(raw + '\r\n'); if (head && head.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
  const kill = () => { up.destroy(); socket.destroy(); };
  up.on('error', kill); socket.on('error', kill); up.on('close', kill); socket.on('close', kill);
});

server.keepAliveTimeout = 65000;
server.listen(PORT, '::', () => console.log(`origin-forwarder: ${PUBLIC_HOST} → ${TARGET_HOST}:${TARGET_PORT} (listening on ${PORT})`));
