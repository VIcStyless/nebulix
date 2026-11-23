'use strict';
// Tiny crash-safe JSON persistence (no dependencies). Tables live in memory and are flushed atomically.
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
    this.t = new Map(); this.logs = new Map(); this.dirty = new Set();
    this.timer = null; this.chain = Promise.resolve();
  }
  _file(name) { return path.join(this.dir, name + '.json'); }
  _lfile(name) { return path.join(this.dir, 'logs', name + '.json'); }
  _read(file, def) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
      if (e.code !== 'ENOENT') {
        console.error('[store] could not read', file, e.message);
        try { fs.copyFileSync(file, file + '.corrupt-' + Date.now()); } catch {}
      }
      return def;
    }
  }
  table(name, def = {}) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('bad table name');
    if (!this.t.has(name)) this.t.set(name, this._read(this._file(name), def));
    return this.t.get(name);
  }
  touch(name) { this.dirty.add('t:' + name); this._sched(); }
  log(name) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('bad log name');
    if (!this.logs.has(name)) this.logs.set(name, this._read(this._lfile(name), []));
    return this.logs.get(name);
  }
  touchLog(name) { this.dirty.add('l:' + name); this._sched(); }
  _sched() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush().catch((e) => console.error('[store] flush failed', e)); }, 250);
    this.timer.unref && this.timer.unref();
  }
  flush() {
    this.chain = this.chain.then(async () => {
      const keys = [...this.dirty]; this.dirty.clear();
      for (const k of keys) {
        const kind = k[0]; const name = k.slice(2);
        const file = kind === 't' ? this._file(name) : this._lfile(name);
        const data = JSON.stringify(kind === 't' ? this.t.get(name) : this.logs.get(name));
        const tmp = file + '.tmp';
        await fs.promises.writeFile(tmp, data);
        await fs.promises.rename(tmp, file);
      }
    });
    return this.chain;
  }
  flushSync() {
    const keys = [...this.dirty]; this.dirty.clear();
    for (const k of keys) {
      const kind = k[0]; const name = k.slice(2);
      const file = kind === 't' ? this._file(name) : this._lfile(name);
      const data = JSON.stringify(kind === 't' ? this.t.get(name) : this.logs.get(name));
      try { fs.writeFileSync(file + '.tmp', data); fs.renameSync(file + '.tmp', file); } catch (e) { console.error('[store] sync flush failed', e.message); }
    }
  }
}

module.exports = Store;
