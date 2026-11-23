#!/usr/bin/env node
'use strict';
// Make Nebulix reachable from anywhere with a temporary public link.
//
// Nebulix needs TWO hostnames (one for the app, one for the isolated proxy) so a
// website you browse can never touch your account. This script opens two quick
// Cloudflare tunnels, wires them up, and starts the server for you.
//
// Requirements: the "cloudflared" command on your PATH, and an internet connection.
//   Windows : winget install --id Cloudflare.cloudflared   (or download the .exe)
//   macOS   : brew install cloudflared
//   Linux   : see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
//
// No cloudflared? Nebulix still runs locally — just use the http://localhost link.
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'server', 'logfile.js'))();
const PORT = parseInt(process.env.PORT, 10) || 3000;

function have(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'pipe' });
  return r.status === 0;
}
function freePort() { return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }

// Start a cloudflared quick tunnel to a local port and resolve with its public https URL.
function openTunnel(localPort, label) {
  return new Promise((resolve, reject) => {
    const cp = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${localPort}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let done = false; const to = setTimeout(() => { if (!done) { done = true; cp.kill(); reject(new Error(`${label}: timed out waiting for a tunnel URL`)); } }, 40000);
    const onData = (buf) => {
      const m = String(buf).match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/i);
      if (m && !done) { done = true; clearTimeout(to); resolve({ url: m[0], proc: cp }); }
    };
    cp.stdout.on('data', onData); cp.stderr.on('data', onData);
    cp.on('exit', (code) => { if (!done) { done = true; clearTimeout(to); reject(new Error(`${label}: cloudflared exited (code ${code}). Is it installed and are you online?`)); } });
  });
}

// server/index.js only auto-starts when run directly, so start it explicitly here.
function startServer() {
  const nx = require(path.join(ROOT, 'server/index.js'));
  nx.start().then((info) => {
    nx.banner(info);
    const stop = async () => { await info.close(); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    if (process.env.NX_CLIENT === '1') { process.stdin.on('end', stop); process.stdin.on('error', stop); process.stdin.resume(); }
  }).catch((e) => { console.error('\nCould not start Nebulix: ' + e.message + '\n'); process.exit(1); });
}

async function main() {
  if (!have('cloudflared')) {
    console.log('\n"cloudflared" is not installed, so a public link cannot be created right now.');
    console.log('Install it, then run "npm run public" again:');
    console.log('  Windows : winget install --id Cloudflare.cloudflared');
    console.log('  macOS   : brew install cloudflared');
    console.log('  Linux   : https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n');
    console.log('Starting Nebulix locally instead…\n');
    startServer();
    return;
  }

  console.log('\nOpening two Cloudflare tunnels (app + isolated proxy)…');
  let app, proxy;
  try {
    // One tunnel per origin. Both point at the single Nebulix port; Nebulix tells them apart by hostname.
    app = await openTunnel(PORT, 'app');
    proxy = await openTunnel(PORT, 'proxy');
  } catch (e) {
    console.error('\nCould not open a tunnel: ' + e.message + '\nStarting Nebulix locally instead…\n');
    if (app && app.proc) app.proc.kill();
    startServer();
    return;
  }

  process.env.APP_ORIGIN = app.url;
  process.env.PROXY_ORIGIN = proxy.url;
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(PORT);

  const line = '-'.repeat(62);
  console.log(`\n${line}\n  ✦  Your public Nebulix link is ready — share this one:\n`);
  console.log(`        ${app.url}\n`);
  console.log(`  (proxy origin: ${proxy.url} — you don't share this one)`);
  console.log(`${line}`);
  console.log('  These links last until you close this window. Keep it open while friends play.');
  console.log('  Tip: run "npm run make-admin <you>" once so your account is the owner.\n');

  // config.js reads env at require() time, so load the server only now.
  const close = () => { try { app.proc.kill(); } catch {} try { proxy.proc.kill(); } catch {} };
  process.on('SIGINT', close); process.on('SIGTERM', close); process.on('exit', close);
  startServer();
}

main().catch((e) => { console.error(e); process.exit(1); });
