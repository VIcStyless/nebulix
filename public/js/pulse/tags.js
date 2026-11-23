// Read title / artist / album / cover from audio files without any library: ID3v2 (+v1), FLAC, MP4/M4A.
// Only small slices of the file are read, so even big files are handled instantly.

const dec = (bytes, enc) => {
  try {
    if (enc === 1 || enc === 2) { // UTF-16 (with BOM) / UTF-16BE
      let le = enc === 1, i = 0;
      if (enc === 1 && bytes.length >= 2) { if (bytes[0] === 0xff && bytes[1] === 0xfe) { le = true; i = 2; } else if (bytes[0] === 0xfe && bytes[1] === 0xff) { le = false; i = 2; } }
      let s = ''; for (; i + 1 < bytes.length; i += 2) { const c = le ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1]; if (!c) break; s += String.fromCharCode(c); }
      return s;
    }
    const s = new TextDecoder(enc === 3 ? 'utf-8' : 'latin1').decode(bytes); const z = s.indexOf('\0'); return z >= 0 ? s.slice(0, z) : s;
  } catch { return ''; }
};
const clean = (s) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200);
const syncsafe = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
const be32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const le32 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | ((b[o + 3] << 24) >>> 0);
async function slice(file, a, b) { return new Uint8Array(await file.slice(a, b).arrayBuffer()); }
function zeroEnd(bytes, start, enc) { // index of the terminator for an encoded string
  if (enc === 1 || enc === 2) { for (let i = start; i + 1 < bytes.length; i += 2) if (bytes[i] === 0 && bytes[i + 1] === 0) return i; return bytes.length; }
  for (let i = start; i < bytes.length; i++) if (bytes[i] === 0) return i; return bytes.length;
}
function pictureUrl(data, mime) { try { return URL.createObjectURL(new Blob([data], { type: mime || 'image/jpeg' })); } catch { return null; } }

async function id3v2(file) {
  const head = await slice(file, 0, 10);
  if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return null;
  const ver = head[3]; const size = syncsafe(head, 6); if (size <= 0 || size > 40 * 1048576) return null;
  const b = await slice(file, 10, 10 + size); const out = {};
  let o = 0;
  if (head[5] & 0x40 && ver >= 3) { const ext = ver === 4 ? syncsafe(b, 0) : be32(b, 0) + 4; o += ext; } // extended header
  while (o + (ver === 2 ? 6 : 10) <= b.length) {
    let id, len;
    if (ver === 2) { id = String.fromCharCode(b[o], b[o + 1], b[o + 2]); len = (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5]; o += 6; }
    else { id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); len = ver === 4 ? syncsafe(b, o + 4) : be32(b, o + 4); o += 10; }
    if (!/^[A-Z0-9]{3,4}$/.test(id) || len <= 0 || o + len > b.length) break;
    const f = b.subarray(o, o + len); o += len;
    const key = { TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album', TBPM: 'bpm', TBP: 'bpm', TCON: 'genre', TCO: 'genre', TKEY: 'key', TKE: 'key' }[id];
    if (key && !out[key]) out[key] = clean(dec(f.subarray(1), f[0]));
    else if ((id === 'APIC' || id === 'PIC') && !out.cover) {
      const enc = f[0]; let p = 1, mime;
      if (id === 'PIC') { const fmt = String.fromCharCode(f[1], f[2], f[3]).toLowerCase(); mime = fmt === 'png' ? 'image/png' : 'image/jpeg'; p = 4; }
      else { const z = zeroEnd(f, 1, 0); mime = dec(f.subarray(1, z), 0) || 'image/jpeg'; p = z + 1; if (!mime.includes('/')) mime = 'image/' + mime.toLowerCase(); }
      p += 1; // picture type
      const dz = zeroEnd(f, p, enc); p = dz + (enc === 1 || enc === 2 ? 2 : 1);
      if (p < f.length) out.cover = pictureUrl(f.subarray(p), mime);
    }
  }
  if (out.bpm) out.bpm = parseFloat(out.bpm) || undefined;
  if (out.genre) out.genre = out.genre.replace(/^\((\d+)\)$/, '');
  return out;
}
async function id3v1(file) {
  if (file.size < 128) return null;
  const b = await slice(file, file.size - 128, file.size);
  if (b[0] !== 0x54 || b[1] !== 0x41 || b[2] !== 0x47) return null;
  const s = (a, z) => clean(dec(b.subarray(a, z), 0));
  return { title: s(3, 33), artist: s(33, 63), album: s(63, 93) };
}
async function flac(file) {
  const head = await slice(file, 0, 4); if (String.fromCharCode(...head) !== 'fLaC') return null;
  const out = {}; let o = 4;
  for (let n = 0; n < 64; n++) {
    const h = await slice(file, o, o + 4); if (h.length < 4) break;
    const last = h[0] & 0x80, type = h[0] & 0x7f, len = (h[1] << 16) | (h[2] << 8) | h[3]; o += 4;
    if (type === 4 || (type === 6 && !out.cover)) {
      const b = await slice(file, o, o + len);
      if (type === 4) {
        let p = 4 + le32(b, 0); const cnt = le32(b, p); p += 4;
        for (let i = 0; i < cnt && p + 4 <= b.length; i++) { const l = le32(b, p); p += 4; const c = dec(b.subarray(p, p + l), 3); p += l; const eq = c.indexOf('='); if (eq < 0) continue; const k = c.slice(0, eq).toUpperCase(), v = clean(c.slice(eq + 1)); const m = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', BPM: 'bpm', GENRE: 'genre' }[k]; if (m && !out[m]) out[m] = v; }
      } else {
        let p = 4; const ml = be32(b, p); p += 4; const mime = dec(b.subarray(p, p + ml), 0); p += ml; const dl = be32(b, p); p += 4 + dl + 16; const sz = be32(b, p); p += 4;
        out.cover = pictureUrl(b.subarray(p, p + sz), mime);
      }
    }
    o += len; if (last) break;
  }
  if (out.bpm) out.bpm = parseFloat(out.bpm) || undefined;
  return out;
}
async function mp4(file) {
  const head = await slice(file, 4, 8); if (String.fromCharCode(...head) !== 'ftyp') return null;
  // find the top-level moov atom (it can be at the start or at the end of the file)
  let o = 0, moov = null;
  for (let n = 0; n < 100 && o + 8 <= file.size; n++) {
    const h = await slice(file, o, o + 16); let size = be32(h, 0); const type = String.fromCharCode(h[4], h[5], h[6], h[7]);
    if (size === 1) size = be32(h, 8) * 4294967296 + be32(h, 12); else if (size === 0) size = file.size - o;
    if (size < 8) break;
    if (type === 'moov') { if (size > 32 * 1048576) return null; moov = await slice(file, o, o + size); break; }
    o += size;
  }
  if (!moov) return null;
  const out = {};
  const walk = (b, a, z, depth) => {
    let p = a;
    while (p + 8 <= z) {
      const size = be32(b, p); const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]); if (size < 8 || p + size > z) break;
      const s = p + 8, e = p + size;
      if (['moov', 'udta', 'ilst', 'trak', 'mdia'].includes(type)) walk(b, s, e, depth + 1);
      else if (type === 'meta') walk(b, s + 4, e, depth + 1);
      else if (['©nam', '©ART', '©alb', 'covr', 'tmpo', 'aART'].includes(type)) {
        // child 'data' atom: size(4) 'data'(4) type(4) locale(4) payload
        if (e - s >= 16 && String.fromCharCode(b[s + 4], b[s + 5], b[s + 6], b[s + 7]) === 'data') {
          const kind = be32(b, s + 8) & 0xffffff; const payload = b.subarray(s + 16, s + be32(b, s));
          if (type === 'covr') { if (!out.cover) out.cover = pictureUrl(payload, kind === 14 ? 'image/png' : 'image/jpeg'); }
          else if (type === 'tmpo') out.bpm = (payload[0] << 8) | payload[1] || undefined;
          else { const k = { '©nam': 'title', '©ART': 'artist', aART: 'artist', '©alb': 'album' }[type]; if (k && !out[k]) out[k] = clean(dec(payload, 3)); }
        }
      }
      p = e;
    }
  };
  walk(moov, 8, moov.length, 0);
  return out;
}

// "Artist - Title (Remix).mp3" → { artist, title }
export function fromFilename(name) {
  const base = String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(?:\d{1,3}[\s.\-_]+)?(.+?)\s+[-–—]\s+(.+)$/.exec(base);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: base.replace(/^\d{1,3}[\s.\-_]+/, '') || base };
}

export async function readTags(file) {
  let t = null;
  try { t = (await id3v2(file)) || (await flac(file)) || (await mp4(file)); } catch { t = null; }
  if (!t || (!t.title && !t.artist)) { try { const v1 = await id3v1(file); if (v1) t = Object.assign(v1, t || {}); } catch {} }
  const fn = fromFilename(file.name);
  t = t || {};
  return { title: t.title || fn.title, artist: t.artist || fn.artist || '', album: t.album || '', genre: t.genre || '', bpm: t.bpm && t.bpm > 40 && t.bpm < 260 ? t.bpm : undefined, cover: t.cover || null };
}

// Shrink an embedded cover to a small JPEG data URL (stored with the track, used everywhere).
export async function coverThumb(url, size = 300) {
  if (!url) return null;
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
    const s = Math.min(img.naturalWidth, img.naturalHeight); g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
    return c.toDataURL('image/jpeg', 0.82);
  } catch { return null; } finally { try { URL.revokeObjectURL(url); } catch {} }
}
