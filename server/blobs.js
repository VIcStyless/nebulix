'use strict';
// Content-addressed file storage on the data volume (/data/blobs/ab/<sha256>). Shared by Nebulix Code
// repositories, Drive and the Hub (videos, games, apps). Identical files are stored once.
// Streaming upload with a hard size cap, and Range-aware downloads (video seeking).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const { S, isPro } = require('./state');
const { HttpError, rid } = require('./util');

const DIR = path.join(cfg.dataDir, 'blobs');
const TMP = path.join(DIR, 'tmp');
fs.mkdirSync(TMP, { recursive: true });
const SHA = /^[0-9a-f]{64}$/;
const fileOf = (sha) => path.join(DIR, sha.slice(0, 2), sha);

// Storage quota per user (bytes)
const quota = (u) => (isPro(u) ? 5 * 1024 ** 3 : 500 * 1024 ** 2) + require('./boosts').extraStorage(u);
const used = (u) => u.storeBytes || 0;
function charge(u, bytes) {
  if (bytes > 0 && used(u) + bytes > quota(u)) throw new HttpError(413, 'quota', `Not enough storage (${Math.round(used(u) / 1048576)} of ${Math.round(quota(u) / 1048576)} MB used). PRO gets 5 GB.`);
  u.storeBytes = Math.max(0, used(u) + bytes); S.store.touch('users');
}
const usage = (u) => ({ used: used(u), quota: quota(u) });

function exists(sha) { return SHA.test(sha) && fs.existsSync(fileOf(sha)); }
function putBuffer(buf) {
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const f = fileOf(sha);
  if (!fs.existsSync(f)) { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = path.join(TMP, rid(8)); fs.writeFileSync(tmp, buf); fs.renameSync(tmp, f); }
  return { sha, size: buf.length };
}
function readBuffer(sha) { if (!SHA.test(sha)) throw new HttpError(404, 'no_blob', 'File not found'); try { return fs.readFileSync(fileOf(sha)); } catch { throw new HttpError(404, 'no_blob', 'File not found'); } }
// Streams the request body to disk while hashing it; rejects anything over `max` bytes.
function receive(req, max) {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length'] || 0);
    if (len > max) { req.resume(); return reject(new HttpError(413, 'too_big', `File too large (max ${Math.round(max / 1048576)} MB)`)); }
    const tmp = path.join(TMP, rid(8)); const out = fs.createWriteStream(tmp); const hash = crypto.createHash('sha256'); let size = 0; let failed = false;
    const fail = (e) => { if (failed) return; failed = true; out.destroy(); fs.rm(tmp, () => {}); req.resume(); reject(e); };
    req.on('data', (d) => { size += d.length; if (size > max) return fail(new HttpError(413, 'too_big', `File too large (max ${Math.round(max / 1048576)} MB)`)); hash.update(d); if (!out.write(d)) { req.pause(); out.once('drain', () => req.resume()); } });
    req.on('error', fail); out.on('error', fail);
    req.on('end', () => { if (failed) return; out.end(() => {
      if (!size) { fs.rm(tmp, () => {}); return reject(new HttpError(400, 'empty', 'Empty file')); }
      const sha = hash.digest('hex'); const f = fileOf(sha);
      try { fs.mkdirSync(path.dirname(f), { recursive: true }); let fresh = false; if (fs.existsSync(f)) fs.rmSync(tmp); else { fs.renameSync(tmp, f); fresh = true; } resolve({ sha, size, fresh }); } catch (e) { reject(e); }
    }); });
  });
}
// Sends a blob. Uploaded content is never trusted: it is sandboxed and only rendered inline for safe types.
const INLINE = /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm|ogg)|audio\/(mpeg|ogg|wav|webm|mp4)|text\/plain|application\/pdf)$/;
function send(req, res, sha, { type = 'application/octet-stream', name = 'file', inline = true, maxAge = 86400 } = {}) {
  if (!exists(sha)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  const f = fileOf(sha); const size = fs.statSync(f).size;
  const safeType = INLINE.test(type) ? type : (type.startsWith('text/') ? 'text/plain; charset=utf-8' : 'application/octet-stream');
  const h = { 'Content-Type': safeType, 'Accept-Ranges': 'bytes', ETag: '"' + sha.slice(0, 32) + '"', 'Cache-Control': `private, max-age=${maxAge}`, 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Disposition': (inline && INLINE.test(type) ? 'inline' : 'attachment') + '; filename="' + String(name).replace(/[^\w.\- ]+/g, '_').slice(0, 120) + '"' };
  if (req.headers['if-none-match'] === h.ETag) { res.writeHead(304, h); return res.end(); }
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m) {
    let start = m[1] ? +m[1] : size - +m[2]; let end = m[1] && m[2] ? +m[2] : size - 1; if (!m[1]) end = size - 1;
    if (start < 0 || start >= size || end >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, Object.assign(h, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 }));
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(f, { start, end }).pipe(res);
  }
  res.writeHead(200, Object.assign(h, { 'Content-Length': size })); if (req.method === 'HEAD') return res.end();
  fs.createReadStream(f).pipe(res);
}
// Guess a type from the file name (we never trust the browser's)
const EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', pdf: 'application/pdf', txt: 'text/plain', md: 'text/plain', json: 'text/plain', js: 'text/plain', ts: 'text/plain', css: 'text/plain', html: 'text/html', htm: 'text/html', zip: 'application/zip' };
const typeOf = (name) => EXT[String(name).toLowerCase().split('.').pop()] || 'application/octet-stream';
// Text files can be shown in the editor (utf-8 without NUL bytes, < 2 MB)
function isText(buf) { if (buf.length > 2 * 1024 * 1024) return false; const n = Math.min(buf.length, 8000); for (let i = 0; i < n; i++) if (buf[i] === 0) return false; return true; }

// Write any readable stream to the store without holding it in memory; fails past `max` bytes.
function putStream(readable, max = Infinity) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(TMP, rid(8)); const out = fs.createWriteStream(tmp); const hash = crypto.createHash('sha256'); let size = 0; let failed = false;
    const fail = (e) => { if (failed) return; failed = true; out.destroy(); readable.destroy(); fs.rm(tmp, () => {}); reject(e); };
    readable.on('data', (d) => { size += d.length; if (size > max) return fail(new HttpError(413, 'too_big', 'A file inside is larger than it says')); hash.update(d); if (!out.write(d)) { readable.pause(); out.once('drain', () => readable.resume()); } });
    readable.on('error', fail); out.on('error', fail);
    readable.on('end', () => { if (failed) return; out.end(() => {
      const sha = hash.digest('hex'); const f = fileOf(sha);
      try { fs.mkdirSync(path.dirname(f), { recursive: true }); if (fs.existsSync(f)) fs.rmSync(tmp); else fs.renameSync(tmp, f); resolve({ sha, size }); } catch (e) { reject(e); }
    }); });
  });
}
// Stream a stored file with Range support and the caller's headers (used for Hub game files, which can be huge)
function sendRaw(req, res, sha, headers) {
  if (!exists(sha)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  const f = fileOf(sha); const size = fs.statSync(f).size; const h = Object.assign({ 'Accept-Ranges': 'bytes', ETag: '"' + sha.slice(0, 32) + '"' }, headers);
  if (req.headers['if-none-match'] === h.ETag) { res.writeHead(304, h); return res.end(); }
  const m = !h['Content-Encoding'] && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m) {
    let start = m[1] ? +m[1] : size - +m[2]; let end = m[1] && m[2] ? +m[2] : size - 1; if (!m[1]) end = size - 1;
    if (start < 0 || start >= size || end >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, Object.assign(h, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 }));
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(f, { start, end }).pipe(res);
  }
  res.writeHead(200, Object.assign(h, { 'Content-Length': size })); if (req.method === 'HEAD') return res.end();
  fs.createReadStream(f).pipe(res);
}
// remove a blob that only this upload created (e.g. a big .zip once it has been unpacked)
const drop = (sha) => { try { fs.rmSync(pathOf(sha)); } catch {} };
const pathOf = (sha) => { if (!SHA.test(sha)) throw new HttpError(404, 'no_blob', 'File not found'); return fileOf(sha); };
const sizeOf = (sha) => { try { return fs.statSync(pathOf(sha)).size; } catch { return 0; } };
// free space on the data volume (bytes); big uploads keep a reserve so the volume never fills up
function freeBytes() { try { const st = fs.statfsSync(DIR); return st.bavail * st.bsize; } catch { return Infinity; } }
module.exports = { putBuffer, putStream, readBuffer, receive, send, sendRaw, exists, typeOf, isText, charge, usage, quota, SHA, pathOf, sizeOf, freeBytes, drop };
