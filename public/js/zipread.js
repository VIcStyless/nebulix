// Tiny ZIP reader (Nebulix 3.0): lists entries and extracts "stored" and "deflate" files with the browser's own
// DecompressionStream. Guards against zip bombs: at most `maxEntries` entries and `maxSize` bytes per extracted file
// (the real output is counted while inflating, not just the size the archive claims). No ZIP64, no encryption.
export async function readZip(bytes, { maxEntries = 2000 } = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not_zip');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || p === 0xffffffff) throw new Error('zip64');
  if (count > maxEntries) throw new Error('too_many');
  const dec = new TextDecoder(); const out = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('corrupt');
    const flags = dv.getUint16(p + 8, true); const method = dv.getUint16(p + 10, true); const csize = dv.getUint32(p + 20, true); const size = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true); const xl = dv.getUint16(p + 30, true); const cl = dv.getUint16(p + 32, true); const off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    out.push({ name, dir: name.endsWith('/'), method, size, csize, encrypted: !!(flags & 1), off });
    p += 46 + nl + xl + cl;
  }
  async function extract(e, maxSize = 2 * 1048576) {
    if (e.encrypted) throw new Error('encrypted'); if (e.size > maxSize) throw new Error('too_big');
    if (dv.getUint32(e.off, true) !== 0x04034b50) throw new Error('corrupt');
    const start = e.off + 30 + dv.getUint16(e.off + 26, true) + dv.getUint16(e.off + 28, true); const data = u8.subarray(start, start + e.csize);
    if (e.method === 0) return data.slice();
    if (e.method !== 8) throw new Error('unsupported');
    const rd = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(); const parts = []; let n = 0;
    for (;;) { const { value, done } = await rd.read(); if (done) break; n += value.length; if (n > maxSize) { rd.cancel(); throw new Error('too_big'); } parts.push(value); }
    const res = new Uint8Array(n); let o = 0; for (const x of parts) { res.set(x, o); o += x.length; } return res;
  }
  return { entries: out, extract };
}
