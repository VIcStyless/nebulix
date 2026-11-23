// Tiny ZIP writer (stored, no compression) so whole folders can be uploaded to the Hub as one file.
// Each file is read once to compute its CRC-32; the file data itself is not copied (the Blob references the Files).
const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8, c = 0xffffffff) { for (let i = 0; i < u8.length; i++) c = TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8); return c; }
const enc = new TextEncoder();

// files and folders we never upload (version control, dependencies, OS junk)
export const SKIP = /(^|\/)(\.git|\.svn|\.hg|node_modules|__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i;

// entries: [{ path, file }] → Blob (application/zip)
export async function zipFiles(entries, onProgress) {
  const parts = []; const central = []; let offset = 0; let done = 0; const total = entries.reduce((a, e) => a + e.file.size, 0) || 1;
  const d = new Date(); const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2); const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const { path, file } of entries) {
    const name = enc.encode(path); let c = 0xffffffff;
    // CRC in 4 MB slices so huge files do not need one big buffer
    for (let pos = 0; pos < file.size; pos += 4194304) { c = crc32(new Uint8Array(await file.slice(pos, pos + 4194304).arrayBuffer()), c); }
    const crc = (c ^ 0xffffffff) >>> 0; const size = file.size;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(lh.buffer, name, file);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(ch.buffer, name);
    offset += 30 + name.length + size; done += size; if (onProgress) onProgress(done / total);
  }
  const cdSize = central.reduce((a, b) => a + (b.byteLength || b.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

// a dropped folder (DataTransfer) → [{ path, file }]
export async function filesFromDrop(dt) {
  const out = []; const items = [...(dt.items || [])].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
  if (!items.length) return [...(dt.files || [])].map((f) => ({ path: f.name, file: f }));
  const readAll = (dir) => new Promise((res) => { const r = dir.createReader(); const acc = []; const step = () => r.readEntries((b) => { if (!b.length) return res(acc); acc.push(...b); step(); }, () => res(acc)); step(); });
  async function walk(e, base) {
    const p = base ? base + '/' + e.name : e.name; if (SKIP.test(p)) return;
    if (e.isFile) { const f = await new Promise((res) => e.file(res, () => res(null))); if (f) out.push({ path: p, file: f }); }
    else if (e.isDirectory) for (const c of await readAll(e)) await walk(c, p);
  }
  for (const e of items) await walk(e, '');
  return out;
}
// <input webkitdirectory> → [{ path, file }]
export const filesFromInput = (list) => [...list].map((f) => ({ path: f.webkitRelativePath || f.name, file: f })).filter((x) => !SKIP.test(x.path));
