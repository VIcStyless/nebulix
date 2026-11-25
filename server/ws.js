'use strict';
// Minimal RFC 6455 WebSocket server implementation (no dependencies).
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WSConn extends EventEmitter {
  constructor(socket, opts = {}) {
    super();
    this.socket = socket; this.max = opts.maxPayload || 1 << 16;
    this.buf = Buffer.alloc(0); this.frag = null; this.fragOp = 0; this.fragLen = 0;
    this.alive = true; this.closed = false; this.data = {};
    socket.setNoDelay(true);
    socket.setTimeout(0);
    socket.on('data', (d) => this._data(d));
    socket.on('close', () => this._end());
    // upgraded sockets are half-open capable: a peer that goes away sends FIN ('end') and no 'close' follows
    // until we end our side, so finish immediately instead of waiting for the heartbeat.
    socket.on('end', () => this.terminate());
    socket.on('error', () => this._end());
    this.hb = setInterval(() => {
      if (!this.alive) return this.terminate();
      this.alive = false; this._frame(0x9, Buffer.alloc(0));
    }, 25000);
    this.hb.unref();
  }

  _data(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    try { while (!this.closed && this._parse()); } catch { this.close(1002); }
  }

  _parse() {
    const b = this.buf;
    if (b.length < 2) return false;
    const fin = (b[0] & 0x80) !== 0; const op = b[0] & 0x0f; const masked = (b[1] & 0x80) !== 0;
    if (b[0] & 0x70) throw new Error('rsv bits');
    let len = b[1] & 0x7f; let off = 2;
    if (len === 126) { if (b.length < 4) return false; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) return false; if (b.readUInt32BE(2)) throw new Error('too big'); len = b.readUInt32BE(6); off = 10; }
    if (!masked) throw new Error('unmasked');
    if (len > this.max) throw new Error('too big');
    if (op >= 0x8 && (!fin || len > 125)) throw new Error('bad control frame');
    if (b.length < off + 4 + len) return false;
    const mask = b.subarray(off, off + 4);
    const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
    this.buf = b.subarray(off + 4 + len);

    if (op === 0x8) { this.close(1000); return false; }
    if (op === 0x9) { this._frame(0xA, payload); return true; }
    if (op === 0xA) { this.alive = true; return true; }
    if (op === 0x1 || op === 0x2) {
      if (this.frag) throw new Error('unexpected data frame');
      if (fin) this._emit(op, payload);
      else { this.frag = [payload]; this.fragOp = op; this.fragLen = len; }
      return true;
    }
    if (op === 0x0) {
      if (!this.frag) throw new Error('unexpected continuation');
      this.fragLen += len;
      if (this.fragLen > this.max) throw new Error('too big');
      this.frag.push(payload);
      if (fin) { const full = Buffer.concat(this.frag); const o = this.fragOp; this.frag = null; this._emit(o, full); }
      return true;
    }
    throw new Error('bad opcode');
  }

  _emit(op, payload) {
    this.alive = true;
    if (op === 0x1) this.emit('message', payload.toString('utf8'));
    else this.emit('binary', payload);
  }

  _frame(op, payload) {
    if (this.closed && op !== 0x8) return;
    const len = payload.length; let h;
    if (len < 126) { h = Buffer.alloc(2); h[1] = len; }
    else if (len < 65536) { h = Buffer.alloc(4); h[1] = 126; h.writeUInt16BE(len, 2); }
    else { h = Buffer.alloc(10); h[1] = 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(len, 6); }
    h[0] = 0x80 | op;
    if (this.socket.destroyed) return;
    if (this.socket.writableLength > (1 << 20)) return this.terminate();
    this.socket.write(Buffer.concat([h, payload]));
  }

  send(msg) {
    if (this.closed) return;
    this._frame(0x1, Buffer.from(typeof msg === 'string' ? msg : JSON.stringify(msg)));
  }

  sendBinary(buf) { if (!this.closed) this._frame(0x2, buf); }

  close(code = 1000) {
    if (this.closed) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code);
    this._frame(0x8, p);
    this.closed = true;
    try { this.socket.end(); } catch {}
    setTimeout(() => this.terminate(), 2000).unref();
    this._end();
  }

  terminate() { this.closed = true; try { this.socket.destroy(); } catch {} this._end(); }

  _end() {
    if (this._ended) return;
    this._ended = true; this.closed = true;
    clearInterval(this.hb);
    this.emit('close');
  }
}

function upgrade(req, socket, opts) {
  const key = req.headers['sec-websocket-key'];
  const up = String(req.headers.upgrade || '').toLowerCase();
  if (up !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); socket.destroy(); return null;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  return new WSConn(socket, opts);
}

function reject(socket, status, msg) {
  try { socket.write(`HTTP/1.1 ${status} ${msg}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch {}
  socket.destroy();
}

module.exports = { upgrade, reject, WSConn };
