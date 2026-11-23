'use strict';
// Image upload helpers: magic-byte validation, dimension limits, EXIF stripping, content-addressed storage.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const { HttpError } = require('./util');

// Count GIF frames (image descriptors) by walking the block structure; capped to stay cheap on hostile files.
function gifFrames(b) {
  if (b.length < 14) return 1;
  let i = 13; const f = b[10];
  if (f & 0x80) i += 3 * (1 << ((f & 7) + 1));
  let frames = 0; let guard = 0;
  while (i < b.length && guard++ < 200000) {
    const t = b[i];
    if (t === 0x3b) break;
    if (t === 0x21) { i += 2; while (i < b.length && b[i] !== 0) i += b[i] + 1; i++; continue; }
    if (t === 0x2c) {
      frames++; if (frames > 1) return frames;
      const pk = b[i + 9]; i += 10;
      if (pk & 0x80) i += 3 * (1 << ((pk & 7) + 1));
      i++; while (i < b.length && b[i] !== 0) i += b[i] + 1; i++; continue;
    }
    break;
  }
  return Math.max(frames, 1);
}

function imageInfo(b) {
  if (b.length < 24) return null;
  // PNG
  if (b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a && b.toString('latin1', 12, 16) === 'IHDR') {
    return { ext: 'png', mime: 'image/png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  }
  // GIF
  const g = b.toString('latin1', 0, 6);
  if (g === 'GIF87a' || g === 'GIF89a') return { ext: 'gif', mime: 'image/gif', w: b.readUInt16LE(6), h: b.readUInt16LE(8), animated: gifFrames(b) > 1 };
  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { ext: 'jpg', mime: 'image/jpeg', h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
      i += 2 + b.readUInt16BE(i + 2);
    }
    return null;
  }
  // WEBP
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const t = b.toString('latin1', 12, 16);
    if (t === 'VP8X' && b.length >= 30) return { ext: 'webp', mime: 'image/webp', w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), animated: (b[20] & 0x02) !== 0 };
    if (t === 'VP8L' && b.length >= 25) { const v = b.readUInt32LE(21); return { ext: 'webp', mime: 'image/webp', w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) }; }
    if (t === 'VP8 ' && b.length >= 30) return { ext: 'webp', mime: 'image/webp', w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

function stripJpeg(b) {
  const out = [b.subarray(0, 2)]; let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) break;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd9 || m === 0xda) { out.push(b.subarray(i)); i = b.length; break; }
    if ((m >= 0xd0 && m <= 0xd8) || m === 0x01) { out.push(b.subarray(i, i + 2)); i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (!(m === 0xe1 || m === 0xed || m === 0xfe)) out.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return Buffer.concat(out);
}

// Voice notes: only real audio containers are accepted (recorded in the browser with MediaRecorder).
function audioInfo(b) {
  if (b.length < 16) return null;
  if (b.readUInt32BE(0) === 0x1a45dfa3) return { ext: 'webm', mime: 'audio/webm' }; // Matroska/WebM (Chrome, Firefox, Edge)
  if (b.toString('latin1', 0, 4) === 'OggS') return { ext: 'ogg', mime: 'audio/ogg' }; // Ogg/Opus
  if (b.toString('latin1', 4, 8) === 'ftyp') return { ext: 'm4a', mime: 'audio/mp4' }; // MP4/AAC (Safari)
  return null;
}

const LIMITS = { // [free, pro] bytes
  avatar: [2 << 20, 8 << 20], banner: [4 << 20, 10 << 20], chat: [4 << 20, 8 << 20], bg: [3 << 20, 6 << 20], icon: [1 << 20, 2 << 20],
  voice: [3 << 20, 6 << 20], // ~2-4 minutes of Opus
  blob: [4 << 20, 8 << 20], // end-to-end encrypted DM attachments (opaque bytes; the server cannot read them)
};

function store(buf, ext, pro, user) {
  const used = user.uploadBytes || 0;
  if (used + buf.length > QUOTA[pro ? 1 : 0]) throw new HttpError(413, 'quota', 'Upload storage quota reached');
  const name = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32) + '.' + ext;
  const file = path.join(uploadsDir(), name);
  if (!fs.existsSync(file)) { fs.writeFileSync(file, buf); user.uploadBytes = used + buf.length; }
  return name;
}

function saveOther(buf, kind, pro, user) {
  const max = LIMITS[kind][pro ? 1 : 0];
  if (buf.length > max) throw new HttpError(413, 'too_large', `File too large (max ${(max / 1048576) | 0} MB${pro ? '' : ', PRO allows more'})`);
  if (kind === 'voice') {
    const info = audioInfo(buf);
    if (!info) throw new HttpError(400, 'bad_audio', 'That file is not a supported voice recording');
    return { url: '/uploads/' + store(buf, info.ext, pro, user), mime: info.mime, bytes: buf.length };
  }
  if (buf.length < 29) throw new HttpError(400, 'bad_blob', 'Encrypted file is too small'); // 12-byte IV is sent separately; GCM tag is 16 bytes
  return { url: '/uploads/' + store(buf, 'bin', pro, user), bytes: buf.length };
}
const QUOTA = [60 << 20, 400 << 20];

function uploadsDir() { const d = path.join(cfg.dataDir, 'uploads'); fs.mkdirSync(d, { recursive: true }); return d; }

function save(buf, kind, pro, user) {
  const lim = LIMITS[kind];
  if (!lim) throw new HttpError(400, 'bad_kind', 'Unknown upload type');
  if (kind === 'voice' || kind === 'blob') return saveOther(buf, kind, pro, user);
  if (buf.length < 32) throw new HttpError(400, 'bad_image', 'That file is not a valid image');
  if (buf.length > lim[pro ? 1 : 0]) throw new HttpError(413, 'too_large', `Image too large (max ${(lim[pro ? 1 : 0] / 1048576) | 0} MB${pro ? '' : ', PRO allows more'})`);
  const info = imageInfo(buf);
  if (!info) throw new HttpError(400, 'bad_image', 'Only PNG, JPG, GIF or WEBP images are allowed');
  if (!info.w || !info.h || info.w > 4096 || info.h > 4096 || info.w * info.h > 16777216) throw new HttpError(400, 'bad_dimensions', 'Image dimensions are too large (max 4096x4096)');
  if (kind === 'avatar' || kind === 'banner') require('./economy').requirePerk(user, kind, !!info.animated);
  if (info.ext === 'jpg') { try { buf = stripJpeg(buf); } catch {} }
  const used = user.uploadBytes || 0;
  if (used + buf.length > QUOTA[pro ? 1 : 0]) throw new HttpError(413, 'quota', 'Upload storage quota reached');
  const name = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32) + '.' + info.ext;
  const file = path.join(uploadsDir(), name);
  if (!fs.existsSync(file)) { fs.writeFileSync(file, buf); user.uploadBytes = used + buf.length; }
  return { url: '/uploads/' + name, w: info.w, h: info.h, animated: !!info.animated, bytes: buf.length };
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4', bin: 'application/octet-stream' };
const NAME_RE = /^[a-f0-9]{32}\.(png|jpg|gif|webp|webm|ogg|m4a|bin)$/;
const URL_RE = /^\/uploads\/[a-f0-9]{32}\.(png|jpg|gif|webp)$/;
const VOICE_RE = /^\/uploads\/[a-f0-9]{32}\.(webm|ogg|m4a)$/;
const BLOB_RE = /^\/uploads\/[a-f0-9]{32}\.bin$/;

function serve(req, res, name) {
  const m = NAME_RE.exec(name);
  if (!m) { res.writeHead(404); return res.end(); }
  const file = path.join(uploadsDir(), name);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end(); }
    const etag = `"${st.size}-${name.slice(0, 8)}"`;
    const h = {
      'Content-Type': MIME[m[1]], 'Content-Length': st.size, 'Cache-Control': 'public, max-age=31536000, immutable', ETag: etag, 'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-site',
    };
    if (m[1] === 'bin') h['Content-Disposition'] = 'attachment';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, h); return res.end(); }
    const rg = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (rg && (rg[1] || rg[2])) {
      let start = rg[1] ? +rg[1] : Math.max(0, st.size - +rg[2]); let end = rg[1] && rg[2] ? Math.min(+rg[2], st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, Object.assign(h, { 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}` }));
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, h);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// Header info for an already stored upload (used to re-check permissions when a profile image is attached)
function fileInfo(url) {
  if (!URL_RE.test(String(url))) return null;
  try { return imageInfo(fs.readFileSync(path.join(uploadsDir(), url.slice('/uploads/'.length)))); } catch { return null; }
}

module.exports = { save, serve, imageInfo, audioInfo, fileInfo, gifFrames, stripJpeg, URL_RE, VOICE_RE, BLOB_RE, uploadsDir, LIMITS };
