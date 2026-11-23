// Tiny ZIP reader (store + deflate) using the browser's DecompressionStream. Enough to read a Chrome extension's files.
// Returns a Map of path -> Uint8Array. No dependencies.
const td = new TextDecoder();

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('deflate-unsupported');
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await stream.arrayBuffer());
}

export async function readZip(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // locate End Of Central Directory (scan back from the end; comment can be up to 64 KB)
  const sig = 0x06054b50; let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65536); i--) { if (dv.getUint32(i, true) === sig) { eocd = i; break; } }
  if (eocd < 0) throw new Error('not-a-zip');
  const count = dv.getUint16(eocd + 10, true); let off = dv.getUint32(eocd + 16, true);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true), extraLen = dv.getUint16(off + 30, true), commentLen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = td.decode(b.subarray(off + 46, off + 46 + nameLen));
    // local header: data starts after its own name+extra fields
    const lNameLen = dv.getUint16(lho + 26, true), lExtraLen = dv.getUint16(lho + 28, true);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const comp = b.subarray(dataStart, dataStart + compSize);
    if (!name.endsWith('/')) {
      try { out.set(name, method === 0 ? comp.slice() : await inflateRaw(comp)); } catch { /* skip unreadable entry */ }
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  if (!out.size) throw new Error('empty-zip');
  return out;
}

// A .crx file is a small header followed by a normal zip. Strip the header, then read the zip.
export async function readCrx(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b[0] === 0x43 && b[1] === 0x72 && b[2] === 0x32 && b[3] === 0x34) { // "Cr24"
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); const ver = dv.getUint32(4, true);
    let zipAt;
    if (ver === 2) { const pub = dv.getUint32(8, true), sigv = dv.getUint32(12, true); zipAt = 16 + pub + sigv; }
    else { const hlen = dv.getUint32(8, true); zipAt = 12 + hlen; } // v3
    return readZip(b.subarray(zipAt));
  }
  return readZip(b); // already a zip
}

export const zipSupported = () => typeof DecompressionStream !== 'undefined';
