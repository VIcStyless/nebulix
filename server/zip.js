'use strict';
// Minimal ZIP reader (stored + deflate entries) for Hub games/apps. Limits entry count and total unpacked size
// so a "zip bomb" cannot fill the disk. Returns [{ path, data }] with normalised, safe relative paths.
const zlib = require('zlib');
const { HttpError } = require('./util');

function unzip(buf, { maxEntries = 800, maxTotal = 200 * 1024 * 1024 } = {}, onFile = null) {
  // find the End Of Central Directory record (last 64 KB)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new HttpError(400, 'bad_zip', 'That is not a valid .zip file');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  if (count > maxEntries) throw new HttpError(400, 'bad_zip', `Too many files in the zip (max ${maxEntries})`);
  const out = []; let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new HttpError(400, 'bad_zip', 'Corrupt zip file');
    const method = buf.readUInt16LE(p + 10); const csize = buf.readUInt32LE(p + 20); const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28); const xlen = buf.readUInt16LE(p + 30); const clen = buf.readUInt16LE(p + 32); const local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8'); p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const clean = name.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.' && s !== '..').join('/');
    if (!clean || /^__MACOSX\//.test(clean) || /(^|\/)\.DS_Store$/.test(clean)) continue;
    total += usize; if (total > maxTotal) throw new HttpError(413, 'too_big', 'The unpacked game is too large');
    const lnlen = buf.readUInt16LE(local + 26); const lxlen = buf.readUInt16LE(local + 28); const start = local + 30 + lnlen + lxlen;
    const raw = buf.slice(start, start + csize);
    let data;
    if (method === 0) data = raw; else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: usize + 1024 }); else throw new HttpError(400, 'bad_zip', 'Unsupported zip compression (use normal zip)');
    if (onFile) out.push({ path: clean, data: onFile(clean, data) }); else out.push({ path: clean, data });
  }
  // if everything sits inside one top folder, strip it so index.html is at the root
  const tops = new Set(out.map((f) => f.path.split('/')[0]));
  if (tops.size === 1 && out.every((f) => f.path.includes('/'))) { const top = [...tops][0] + '/'; for (const f of out) f.path = f.path.slice(top.length); }
  return out;
}
// Streaming version for big uploads (up to a few GB): reads the central directory from the file on disk, then inflates
// one entry at a time straight into the blob store. Nothing large is ever held in memory.
async function unzipFile(file, { maxEntries = 20000, maxTotal = 3 * 1024 ** 3 } = {}, onEntry) {
  const fs = require('fs'); const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size; const tailLen = Math.min(size, 65557); const tail = Buffer.alloc(tailLen); fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1; for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new HttpError(400, 'bad_zip', 'That is not a valid .zip file');
    const count = tail.readUInt16LE(eocd + 10); const cdSize = tail.readUInt32LE(eocd + 12); const cdOff = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdOff === 0xffffffff) throw new HttpError(400, 'bad_zip', 'ZIP64 files are not supported: zip folders under 4 GB');
    if (count > maxEntries) throw new HttpError(400, 'bad_zip', `Too many files in the zip (max ${maxEntries})`);
    const cd = Buffer.alloc(cdSize); fs.readSync(fd, cd, 0, cdSize, cdOff);
    const entries = []; let p = 0; let total = 0;
    for (let n = 0; n < count; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new HttpError(400, 'bad_zip', 'Corrupt zip file');
      const method = cd.readUInt16LE(p + 10); const csize = cd.readUInt32LE(p + 20); const usize = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28); const xlen = cd.readUInt16LE(p + 30); const clen = cd.readUInt16LE(p + 32); const local = cd.readUInt32LE(p + 42);
      const name = cd.slice(p + 46, p + 46 + nlen).toString('utf8'); p += 46 + nlen + xlen + clen;
      if (name.endsWith('/')) continue;
      const clean = name.replace(/\\/g, '/').split('/').filter((x) => x && x !== '.' && x !== '..').join('/');
      if (!clean || /^__MACOSX\//.test(clean) || /(^|\/)\.DS_Store$/.test(clean)) continue;
      if (method !== 0 && method !== 8) throw new HttpError(400, 'bad_zip', 'Unsupported zip compression (use normal zip)');
      total += usize; if (total > maxTotal) throw new HttpError(413, 'too_big', 'The unpacked game is too large');
      entries.push({ path: clean, method, csize, usize, local });
    }
    const out = [];
    for (const e of entries) {
      const lh = Buffer.alloc(30); fs.readSync(fd, lh, 0, 30, e.local);
      const start = e.local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const raw = e.csize ? fs.createReadStream(file, { start, end: start + e.csize - 1 }) : require('stream').Readable.from([]);
      const stream = e.method === 8 ? raw.pipe(zlib.createInflateRaw()) : raw;
      if (e.method === 8) raw.on('error', (err) => stream.destroy(err));
      out.push({ path: e.path, data: await onEntry(e.path, stream, e.usize) });
    }
    const tops = new Set(out.map((f) => f.path.split('/')[0]));
    if (tops.size === 1 && out.every((f) => f.path.includes('/'))) { const top = [...tops][0] + '/'; for (const f of out) f.path = f.path.slice(top.length); }
    return out;
  } finally { fs.closeSync(fd); }
}
module.exports = { unzip, unzipFile };
