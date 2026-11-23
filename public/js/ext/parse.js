// Turn a Chrome extension (a set of files) into the content-script bundle Nebulix can run.
// Nebulix runs an extension's content scripts and CSS inside proxied pages — it is not a full Chrome extension host,
// so background service workers, popups and most chrome.* APIs do not apply. We extract what is runnable and say what we skipped.
const td = new TextDecoder();
const asText = (v) => (typeof v === 'string' ? v : td.decode(v));

// files: Map<path, Uint8Array|string>. Paths may share a common top folder (e.g. from a zip) — normalize that away.
export function parseExtension(files) {
  const map = new Map(); for (const [k, v] of files) map.set(k.replace(/\\/g, '/').replace(/^\.?\//, ''), v);
  // find manifest.json, allowing it to sit under a single top-level folder
  let manifestPath = [...map.keys()].find((k) => k === 'manifest.json') || [...map.keys()].find((k) => /(^|\/)manifest\.json$/.test(k) && k.split('/').length <= 2);
  if (!manifestPath) throw new Error('no-manifest');
  const base = manifestPath.includes('/') ? manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1) : '';
  const get = (p) => { const key = (base + p.replace(/^\.?\//, '')).replace(/\/+/g, '/'); return map.has(key) ? asText(map.get(key)) : (map.has(p) ? asText(map.get(p)) : null); };

  let mf; try { mf = JSON.parse(asText(map.get(manifestPath)).replace(/^﻿/, '')); } catch { throw new Error('bad-manifest'); }
  const name = String(mf.name || 'Extension').slice(0, 80);
  const warn = [];
  const cs = Array.isArray(mf.content_scripts) ? mf.content_scripts : [];
  const matches = new Set(), excludes = new Set(); const css = [], js = []; let runAt = 'document_idle';
  for (const block of cs) {
    (block.matches || []).forEach((m) => matches.add(m)); (block.exclude_matches || []).forEach((m) => excludes.add(m));
    if (block.run_at) runAt = block.run_at;
    for (const f of block.css || []) { const c = get(f); if (c) css.push(c); else warn.push(f); }
    for (const f of block.js || []) { const c = get(f); if (c) js.push(c); else warn.push(f); }
  }
  if (!cs.length) throw new Error('no-content-scripts');
  if (!css.length && !js.length) throw new Error('no-runnable');
  if (!matches.size) matches.add('*://*/*');

  // things Nebulix cannot run — surface them so the user isn't surprised
  if (mf.background) warn.push(mf.manifest_version === 3 ? 'background service worker' : 'background page');
  if (mf.action || mf.browser_action || mf.page_action) warn.push('toolbar popup');
  if (Array.isArray(mf.web_accessible_resources) && mf.web_accessible_resources.length) warn.push('web-accessible resources');

  // bundle small referenced files (icons, etc.) that content scripts might fetch via runtime.getURL
  const files_out = {}; let n = 0;
  for (const [k, v] of map) { if (n >= 30) break; if (/\.(json|png|svg|woff2?|txt)$/i.test(k) && !/manifest\.json$/.test(k)) { const rel = base && k.startsWith(base) ? k.slice(base.length) : k; const s = asText(v); if (s.length <= 180000) { files_out[rel] = s; n++; } } }

  return {
    extension: {
      name, version: String(mf.version || '1.0'), description: String(mf.description || ''),
      manifest: { manifest_version: mf.manifest_version === 3 ? 3 : 2, permissions: [].concat(mf.permissions || [], mf.host_permissions || []).filter((x) => typeof x === 'string') },
      matches: [...matches], excludes: [...excludes], css, js, runAt, files: files_out, on: true,
    },
    warnings: [...new Set(warn)],
    stats: { scripts: js.length, styles: css.length, bytes: js.concat(css).reduce((a, s) => a + s.length, 0) },
  };
}
